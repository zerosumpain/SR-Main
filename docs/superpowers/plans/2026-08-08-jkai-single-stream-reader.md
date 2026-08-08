# jkai Single Stream Reader — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every jkai reply land under the message it answers, permanently, by giving each chat exactly one stream reader that hands turns off to waiting jobs in order — instead of every job racing its own subscriber.

**Architecture:** Hermes already emits turns strictly in sequence on one per-chat stream. Today each SvelteKit job opens its own SSE subscriber and drains whatever is in the shared queue, so a turn whose job detached leaks its frames into the next job. Replace N subscribers with one long-lived reader per chat that dispatches frames to the head of a FIFO queue of jobs and advances on each turn boundary.

**Tech Stack:** SvelteKit (adapter-node, single process), TypeScript, Vitest; Hermes gateway plugin in Python (aiohttp + asyncio) at `~/.hermes-jkai/extensions/jkai_platform/`.

## Global Constraints

- **Never run `scripts/deploy.sh` by hand.** Merge to `master`; CI deploys. A hand-rolled deploy once clobbered the production `.env` (33-hour outage).
- **Never use `gh pr merge --auto`** on SR-Main — it merges immediately and cancels in-flight CI. Block on the run conclusion, then `gh pr merge <N> --squash`.
- **Gate before every commit that touches source:** `NODE_OPTIONS=--max-old-space-size=8192 npm run gate`. Do not `source .env` first.
- **Building on homeserv clobbers `~/strange_rambling_svelte/build/`**, which the always-on `strange-rambling-svelte.service` (port 5173) serves. After any build: `systemctl --user restart strange-rambling-svelte`. Never kill a build mid-run — a truncated adapter write leaves `build/index.js` missing and the service crash-loops.
- **This checkout is shared with other sessions.** Stage explicit paths. Never `git reset --hard`. Check `git rev-parse --abbrev-ref HEAD` before you start and restore it when you finish. Local `master` has been observed stale — branch from `origin/master`.
- **Plugin edits need a gateway restart:** `systemctl --user restart jkai-hermes`. This briefly takes chat down on homeserv *and* production (the VPS points at `homeserv.tail668b8c.ts.net:18790`).
- **Commit the Hermes config repo separately** — `~/.hermes-jkai/` is its own git repo (`zerosumpain/homeserv-hermes-jkai`). It carries unrelated skill edits made by jkai itself; stage only your files.
- End commit messages with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## Background: the bug, and the fix that failed

**Symptom.** You send a message; the reply answers your *previous* message, timestamped 0–2s after you hit send. Once it slips it never resynchronises.

**Cause.** `adapter._outbound` is one queue per `chat_id`, drained by whichever SSE subscriber is attached. Frames carry no usable turn identity. `cancelForScope` (`chat/+server.ts:213`) cancels the previous SvelteKit job on every new message but never tells Hermes, so the old turn keeps running and its frames sit in the queue for the next job — which renders them, persists them, reads that turn's `finalize` as its own completion, and closes in milliseconds.

**Production evidence (2026-08-08).** Job `ac0d631b` was created for *"update the memory and the toolchain…"*, saved the text *"Let me verify it's actually in the file…"* (the reply to the previous message, *"add it"*), and recorded `duration_ms = 0`. Five consecutive turns behaved this way. The agent answered every message correctly — only the pairing was wrong.

**What was already tried and does NOT work.** SR-Main #150 + `homeserv-hermes-jkai@6550248` stamp `metadata.turn_id` on frames, set in `handle_inbound`. It fails because **arrival ≠ execution**: Hermes queues a message behind a busy session, so turn B's `handle_inbound` sets the current turn while turn A is still generating, and A's answer gets stamped B. Verified live:

```
21:27:25.4   B arrives   → _current_turn := B
21:27:25.841 turn A ENDS → A's answer emitted, stamped B
21:27:25.921 turn B runs — INSIDE A's session task
```

A `ContextVar` fails too and inverts the error: B is drained and executed inside A's own task, so B's reply would inherit A's context. **Do not attempt either again.** The tagging is harmless as shipped (it relabels rather than loses frames) and this plan removes it in Task 6.

---

## The invariant this design rests on

> The Nth turn-completion frame on a chat's stream corresponds to the Nth message POSTed to that chat.

If true, head-of-queue dispatch is correct by construction and no frame tagging is needed.

**It is NOT yet verified.** `handle_inbound` (adapter.py) awaits `self._session_tasks.get(session_key)` and then enqueues `finalize`. When B is queued behind A, both `handle_inbound` calls may be awaiting the *same* drain task, so both could finalize at nearly the same moment, in either order. **Task 1 exists solely to settle this**, and Task 2 branches on the answer. Do not skip Task 1 and do not assume the invariant.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/jkai/chat-reader.ts` *(new)* | One long-lived reader per `chat_id`. Owns the single `openStream` generator, holds the FIFO of waiting turns, dispatches frames to the head, advances on turn boundary. No Hermes protocol knowledge beyond "what ends a turn". |
| `src/lib/jkai/chat-reader.test.ts` *(new)* | Unit tests over an injected fake frame source — no network, no Hermes. |
| `src/routes/api/workflows/orchestrator/chat/+server.ts` | `handleWithHermes` claims a turn from the reader instead of calling `openStream` itself; stops superseding on the Hermes path. |
| `src/lib/jkai/hermes-frames.ts` | Delete `frameBelongsToTurn` (Task 6). |
| `~/.hermes-jkai/extensions/jkai_platform/adapter.py` | Remove arrival-based tagging; fix the 300s finalize cap (Task 5). |

`chat-reader.ts` takes its frame source as a constructor argument so every test runs against a fake. That is the only way this is testable without a live gateway.

---

### Task 1: Characterise the real frame stream

No production code. This task answers the invariant question and its output decides Task 2's shape.

**Files:**
- Create: `scripts/trace-chat-frames.mjs`

**Interfaces:**
- Produces: a written finding recorded in this plan under "Task 1 result", stating whether one turn-completion frame arrives per message, in order.

- [ ] **Step 1: Write a script that tails one chat's raw frames**

```javascript
// scripts/trace-chat-frames.mjs
// Usage: node scripts/trace-chat-frames.mjs <chatId>
// Prints one line per frame: elapsed_ms kind message_id turn_id content_preview
// Reads HERMES_BRIDGE_SECRET + HERMES_PLATFORM_URL from .env.
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
);

const chatId = process.argv[2];
if (!chatId) { console.error('usage: node scripts/trace-chat-frames.mjs <chatId>'); process.exit(1); }

// Mirrors mintBridgeToken in src/lib/mcp/auth.ts — read that file and copy the
// exact payload shape and signing before running; do not guess it.
const scope = { sessionId: '', kind: 'canvas_chat', kindId: chatId, expiresAt: Date.now() + 600_000 };
const payload = Buffer.from(JSON.stringify(scope)).toString('base64url');
const sig = createHmac('sha256', env.HERMES_BRIDGE_SECRET).update(payload).digest('base64url');
const token = `${payload}.${sig}`;

const base = env.HERMES_PLATFORM_URL ?? 'http://127.0.0.1:18790';
const res = await fetch(`${base}/platforms/jkai/out?chat_id=${encodeURIComponent(chatId)}`, {
  headers: { 'Bridge-Token': token },
});
if (!res.ok) { console.error(`stream returned ${res.status}`); process.exit(1); }

const t0 = Date.now();
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '';
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) !== -1) {
    const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data:'));
    buf = buf.slice(i + 2);
    if (!line) continue;
    const f = JSON.parse(line.slice(5).trim());
    console.log(
      `${String(Date.now() - t0).padStart(7)}ms  ${f.kind.padEnd(9)}  ${String(f.message_id).slice(-12)}  ` +
      `turn=${String(f.metadata?.turn_id ?? '-').slice(-8)}  ${JSON.stringify(String(f.content).slice(0, 40))}`,
    );
  }
}
```

- [ ] **Step 2: Verify the token mints correctly before relying on the trace**

Read `src/lib/mcp/auth.ts` and confirm `mintBridgeToken`'s payload shape and signing match the script. Fix the script to match the source — **do not** adjust the source to match the script.

Run: `node scripts/trace-chat-frames.mjs test-token-check`
Expected: the process connects (no `stream returned 403`). A 403 means the token shape is wrong; fix it before continuing.

- [ ] **Step 3: Run the overlap experiment against a real chat**

In terminal 1, create a conversation and start the trace:

```bash
cd ~/strange_rambling_svelte
CONV=$(curl -s -X POST http://127.0.0.1:5173/api/jkai/conversations \
  -H 'Content-Type: application/json' -d '{"title":"stream trace"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "$CONV"
node scripts/trace-chat-frames.mjs "chat_$CONV" | tee /tmp/frames.txt
```

In terminal 2, send a slow message then a fast one 6s later (homeserv's loopback is `AUTH_BYPASS`ed, so no session is needed):

```bash
curl -s -X POST http://127.0.0.1:5173/api/workflows/orchestrator/chat \
  -H 'Content-Type: application/json' \
  -d "{\"message\":\"Count the files in /home/john/strange_rambling_svelte/src/lib/jkai using a terminal command.\",\"conversationId\":\"$CONV\"}"
sleep 6
curl -s -X POST http://127.0.0.1:5173/api/workflows/orchestrator/chat \
  -H 'Content-Type: application/json' \
  -d "{\"message\":\"What is 2 plus 2? Answer with just the number.\",\"conversationId\":\"$CONV\"}"
```

- [ ] **Step 4: Answer the invariant question in writing**

From `/tmp/frames.txt`, record in this file under "Task 1 result":

1. How many `finalize` frames arrived, and at what elapsed times?
2. Did **exactly one** arrive per message, in send order?
3. Did any content frame arrive *after* the first `finalize` that belonged to the first turn?

**Decision gate:**
- **Exactly one finalize per message, in order** → Task 2 uses `finalize` as the turn boundary. Proceed as written.
- **Anything else** (two finalizes together, out of order, or content after finalize) → the stream cannot self-delimit turns. **Stop and do Task 2b instead**, which adds an explicit boundary frame to the plugin. Do not try to infer boundaries heuristically from timing — that is how the previous attempt failed.

- [ ] **Step 5: Commit the trace tool**

```bash
git add scripts/trace-chat-frames.mjs docs/superpowers/plans/2026-08-08-jkai-single-stream-reader.md
git commit -m "jkai: frame-trace tool for characterising a chat's outbound stream"
```

**Task 1 result:** _(fill in — this is a required deliverable, not a note)_

---

### Task 2: The reader, with a fake frame source

Pure logic, no network. This is the whole fix; everything after it is wiring.

**Files:**
- Create: `src/lib/jkai/chat-reader.ts`
- Test: `src/lib/jkai/chat-reader.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export interface ChatFrame { kind: string; content: string; message_id: string; metadata?: Record<string, unknown> | null }
  export type FrameSource = (signal: AbortSignal) => AsyncIterable<ChatFrame>;
  export interface TurnHandle {
    /** Frames for THIS turn, in order. Ends when the turn completes. */
    frames(): AsyncIterable<ChatFrame>;
    /** Abandon this turn's output without disturbing the reader or later turns. */
    release(): void;
  }
  export function getChatReader(chatId: string, source: FrameSource): ChatReader;
  export interface ChatReader {
    /** Enqueue a turn. Frames are delivered once every earlier turn has completed. */
    claimTurn(jobId: string): TurnHandle;
    /** Test/shutdown only. */
    close(): void;
    readonly queueDepth: number;
  }
  export function __resetChatReadersForTest(): void;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/jkai/chat-reader.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { getChatReader, __resetChatReadersForTest, type ChatFrame } from './chat-reader';

afterEach(() => __resetChatReadersForTest());

/** A source you push frames into by hand, so tests control interleaving exactly. */
function controllable() {
  const queue: ChatFrame[] = [];
  let notify: (() => void) | null = null;
  let closed = false;
  return {
    push(f: ChatFrame) { queue.push(f); notify?.(); },
    end() { closed = true; notify?.(); },
    source: async function* () {
      for (;;) {
        while (queue.length) yield queue.shift()!;
        if (closed) return;
        await new Promise<void>((r) => { notify = r; });
      }
    },
  };
}
const text = (c: string): ChatFrame => ({ kind: 'send', content: c, message_id: 'm' });
const done = (): ChatFrame => ({ kind: 'finalize', content: '', message_id: 'f' });

async function collect(it: AsyncIterable<ChatFrame>): Promise<string[]> {
  const out: string[] = [];
  for await (const f of it) if (f.kind === 'send') out.push(f.content);
  return out;
}

describe('ChatReader', () => {
  it('gives each turn only its own frames', async () => {
    const c = controllable();
    const reader = getChatReader('chat_1', c.source);
    const a = reader.claimTurn('job-A');
    const b = reader.claimTurn('job-B');

    const aText = collect(a.frames());
    const bText = collect(b.frames());

    c.push(text('answer to A')); c.push(done());
    c.push(text('answer to B')); c.push(done());
    c.end();

    expect(await aText).toEqual(['answer to A']);
    expect(await bText).toEqual(['answer to B']);
  });

  it('keeps the pairing when the first turn is released mid-flight', async () => {
    // THE PRODUCTION BUG. Job A is superseded and walks away; A's remaining
    // frames must still be consumed and discarded, and B must get only its own.
    const c = controllable();
    const reader = getChatReader('chat_1', c.source);
    const a = reader.claimTurn('job-A');
    const b = reader.claimTurn('job-B');
    const bText = collect(b.frames());

    c.push(text('partial A'));
    a.release();
    c.push(text('rest of A')); c.push(done());
    c.push(text('answer to B')); c.push(done());
    c.end();

    expect(await bText).toEqual(['answer to B']);
  });

  it('delivers to a turn claimed after frames are already flowing', async () => {
    const c = controllable();
    const reader = getChatReader('chat_1', c.source);
    const a = reader.claimTurn('job-A');
    const aText = collect(a.frames());
    c.push(text('hello')); c.push(done());
    const b = reader.claimTurn('job-B');
    const bText = collect(b.frames());
    c.push(text('second')); c.push(done());
    c.end();
    expect(await aText).toEqual(['hello']);
    expect(await bText).toEqual(['second']);
  });

  it('buffers frames that arrive before any turn is claimed', async () => {
    const c = controllable();
    const reader = getChatReader('chat_1', c.source);
    c.push(text('early'));
    const a = reader.claimTurn('job-A');
    const aText = collect(a.frames());
    c.push(done());
    c.end();
    expect(await aText).toEqual(['early']);
  });

  it('returns the same reader for a chat id and a fresh one after close', () => {
    const c = controllable();
    const first = getChatReader('chat_1', c.source);
    expect(getChatReader('chat_1', c.source)).toBe(first);
    first.close();
    expect(getChatReader('chat_1', c.source)).not.toBe(first);
  });

  it('ends every waiting turn if the source dies', async () => {
    const c = controllable();
    const reader = getChatReader('chat_1', c.source);
    const a = reader.claimTurn('job-A');
    const b = reader.claimTurn('job-B');
    const aText = collect(a.frames());
    const bText = collect(b.frames());
    c.push(text('partial')); c.end();
    expect(await aText).toEqual(['partial']);
    expect(await bText).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/jkai/chat-reader.test.ts`
Expected: FAIL — `Failed to resolve import "./chat-reader"`.

- [ ] **Step 3: Implement the reader**

Write `src/lib/jkai/chat-reader.ts` satisfying the interface above. Required behaviour, all covered by the tests:

- A module-level `Map<string, ChatReader>`; `getChatReader` creates on miss. One `for await` loop over `source(signal)` per reader, started on construction.
- `claimTurn` appends to a FIFO. Frames go to the head only.
- A turn-completion frame completes the head turn and pops to the next. **Use whatever Task 1 established as the boundary** — `finalize` if the invariant held, the Task 2b marker if not.
- `release()` marks the head as abandoned but **does not** pop it and **does not** close the stream: the reader keeps consuming and discarding until that turn's boundary, then advances. This is what stops a superseded turn leaking into the next.
- Frames arriving with an empty queue go to a small bounded buffer (cap 500, drop oldest with a `console.warn`) handed to the next claimant.
- Source end or throw: end every queued turn's iterable and remove the reader from the map.
- No `$state` anywhere — this is a plain module, not a component.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/jkai/chat-reader.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/chat-reader.ts src/lib/jkai/chat-reader.test.ts
git commit -m "jkai: per-chat stream reader that hands turns to jobs in order"
```

---

### Task 2b: Explicit turn boundary in the plugin — ONLY if Task 1's gate failed

Skip entirely if Task 1 showed one ordered `finalize` per message.

**Files:**
- Modify: `~/.hermes-jkai/extensions/jkai_platform/adapter.py` (`_handle_inbound`)
- Test: `~/.hermes-jkai/extensions/jkai_platform/tests/test_turn_boundary.py`

The boundary must be emitted by the code that *executes* a turn, never by the code that *receives* a message — that distinction is exactly what broke the previous attempt. Find where the gateway signals that an agent turn has finished producing output for a chat (start from `gateway/run.py`'s `Suppressing normal final send` log line, which fires once per completed turn) and emit a `turn_end` frame there. Then use `kind === 'turn_end'` as the boundary in Task 2, keeping `finalize` handling for backwards compatibility.

Write the plugin tests first, run `~/hermes-agent/venv/bin/python -m pytest tests/ -q` (expect the new test to fail), implement, re-run, then `systemctl --user restart jkai-hermes`.

---

### Task 3: Route `handleWithHermes` through the reader

**Files:**
- Modify: `src/routes/api/workflows/orchestrator/chat/+server.ts` (`handleWithHermes`, around the `sendMessage` at :716 and the `for await` at :743)

**Interfaces:**
- Consumes: `getChatReader`, `TurnHandle` from Task 2.

- [ ] **Step 1: Claim the turn before sending the message**

The claim must happen **before** `await client.sendMessage(...)`, and the two must not interleave across concurrent requests for the same chat — otherwise the queue order stops matching the order Hermes received the messages. Add a per-chat promise chain (a small `Map<string, Promise<void>>` mutex in this module) wrapping *claim then send* as one critical section.

```ts
const reader = getChatReader(chatId, (signal) =>
  client.openStream({ chatId, kind, kindId, sessionId }, { signal }));
const turn = await withChatLock(chatId, async () => {
  const handle = reader.claimTurn(jobId);
  await client.sendMessage({ chatId, text: message, kind, kindId, sessionId });
  return handle;
});
```

- [ ] **Step 2: Consume the turn's frames instead of the raw stream**

Replace `for await (const frame of client.openStream({...}, { signal }))` with `for await (const frame of turn.frames())`. Leave the entire loop body unchanged — the text accumulator, tool-frame adaptation, sub-agent frames, attachment extraction and finalize handling all still apply.

- [ ] **Step 3: Release the turn when the job stops caring**

In the `finally` that currently ends the stream, call `turn.release()` instead of aborting the shared stream. The reader is shared — **aborting it would kill every other job's turn on that chat.** Keep `abortController` for the job's own bookkeeping, but it must no longer be the stream's abort signal.

- [ ] **Step 4: Verify the gate**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npm run gate`
Expected: public-routes unchanged, font-sizes OK, `svelte-check` 0 errors, all tests pass, build ✓.
Then: `systemctl --user restart strange-rambling-svelte`

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/workflows/orchestrator/chat/+server.ts
git commit -m "jkai: consume the shared chat reader instead of a per-job subscriber"
```

---

### Task 4: Stop superseding the previous turn on the Hermes path

With the reader in place, a superseded turn no longer needs cancelling — its frames are consumed and discarded in order, and it persists its own reply correctly.

**Files:**
- Modify: `src/routes/api/workflows/orchestrator/chat/+server.ts:213`

- [ ] **Step 1: Remove the supersede on the Hermes branch only**

Delete the `cancelForScope({ workflowId, conversationId }, 'Superseded by new request')` call at :213 (inside `handleWithHermes`). **Leave :1127 alone** — that one is in `handleWithLoop`, where the in-process engine genuinely needs it.

- [ ] **Step 2: Confirm the watchdog still reaps genuinely stuck jobs**

Read `src/lib/workflows/chat/job-store.ts` `startWatchdog`. Confirm a job that never receives frames is still terminated by `IDLE_TIMEOUT_MS`. If removing the supersede leaves jobs alive indefinitely, add an explicit `job.status = 'superseded'` marker rather than reinstating the cancel.

- [ ] **Step 3: Gate and commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npm run gate
systemctl --user restart strange-rambling-svelte
git add src/routes/api/workflows/orchestrator/chat/+server.ts
git commit -m "jkai: let a superseded turn finish instead of truncating it"
```

---

### Task 5: Fix the plugin's 300-second finalize cap

`adapter.py:1269` does `await asyncio.wait_for(asyncio.shield(task), timeout=300)` and then enqueues `finalize` **regardless**. The task is shielded, so a turn longer than five minutes keeps running while its completion frame has already gone out — which under the new design hands the stream to the next turn mid-flight. John's turns routinely exceed 5 minutes (a production turn ended at exactly 5:00 on 2026-08-08).

**Files:**
- Modify: `~/.hermes-jkai/extensions/jkai_platform/adapter.py`
- Test: `~/.hermes-jkai/extensions/jkai_platform/tests/test_turn_tagging.py` (extend)

- [ ] **Step 1: Write a failing test that a slow turn finalizes only once, after it finishes**

```python
@pytest.mark.asyncio
async def test_a_slow_turn_finalizes_only_after_it_completes(adapter, monkeypatch):
    monkeypatch.setattr('jkai_platform.adapter.TURN_WAIT_TIMEOUT_SECONDS', 0.2)
    # Drive handle_inbound with a session task that outlives the old 300s cap
    # analogue, then assert exactly one finalize frame and that it is last.
```

Fill the body in against the real `handle_inbound`; the assertion that matters is **one** `finalize`, emitted after the task completes.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ~/.hermes-jkai/extensions/jkai_platform && ~/hermes-agent/venv/bin/python -m pytest tests/ -q`

- [ ] **Step 3: Raise the cap and align it with the gateway**

Replace the bare `300` with a module constant `TURN_WAIT_TIMEOUT_SECONDS`, defaulted to just above Hermes' own `agent.gateway_timeout` (1800s in `~/.hermes-jkai/config.yaml` — read it, don't assume). On timeout, log loudly and emit the finalize as today; the point is that it should now be genuinely unreachable rather than routine.

- [ ] **Step 4: Run the tests and restart**

Run: `~/hermes-agent/venv/bin/python -m pytest tests/ -q` → all pass.
Then: `systemctl --user restart jkai-hermes`

- [ ] **Step 5: Commit the plugin repo**

```bash
cd ~/.hermes-jkai
git add extensions/jkai_platform/adapter.py extensions/jkai_platform/tests/
git commit -m "Finalize a turn when it actually ends, not at a 5-minute cap"
git push origin main
```

---

### Task 6: Remove the failed turn-tagging

Only after Tasks 2–5 are green. The reader makes tagging unnecessary, and leaving arrival-based tags in place invites someone to trust them.

**Files:**
- Modify: `src/lib/jkai/hermes-frames.ts` (delete `frameBelongsToTurn`), `src/lib/jkai/hermes-frames.test.ts` (delete its describe block), `src/routes/api/workflows/orchestrator/chat/+server.ts` (delete the filter, the `foreignFrames` counter, both `turnId:` arguments), `src/lib/jkai/hermes-client.ts` (delete `turnId` from `SendMessageRequest` and `turn_id` from the body)
- Modify: `~/.hermes-jkai/extensions/jkai_platform/` — delete `_current_turn`, its `_enqueue` stamping, the `turn_id` parameter on `handle_inbound`, the `turn_id` read in `http_server.py`, and `tests/test_turn_tagging.py`

- [ ] **Step 1: Delete site-side tagging, run the gate**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npm run gate` → green.

- [ ] **Step 2: Delete plugin-side tagging, run the plugin tests, restart**

Run: `~/hermes-agent/venv/bin/python -m pytest tests/ -q` → green. Then `systemctl --user restart jkai-hermes`.

- [ ] **Step 3: Commit both repos**

---

### Task 7: Prove it on the real thing

A green unit suite does not prove this fixed. The bug only appears against a live gateway.

**Files:**
- Create: `scripts/test-chat-overlap.mjs`

- [ ] **Step 1: Write the overlap test as a script**

It must: create a conversation; POST a slow message; wait 6s; POST a fast one; poll until both assistant rows exist; then read the rows in `created_at` order and assert that the reply following each user message actually answers **that** message. Assert on content: the slow message's reply contains a file count, the fast one's is `4`.

- [ ] **Step 2: Run it against homeserv**

Run: `node scripts/test-chat-overlap.mjs`
Expected: PASS. The known-bad output — which is what this whole plan exists to prevent — looks like this:

```
21:27:19  user       Count the files in .../src/lib/jkai …
21:27:25  user       What is 2 plus 2? …
21:27:25  assistant  💻 terminal: "find /home/john/…"
21:27:27  assistant   **173** files in .../src/lib/jkai.4     ← both answers, one bubble, wrong message
```

- [ ] **Step 3: Run it three times in a row**

This is a race. One pass is not evidence. Three consecutive passes, then vary the gap (2s, 6s, 20s).

- [ ] **Step 4: Ship it**

```bash
git add scripts/test-chat-overlap.mjs
git commit -m "jkai: overlap regression test for turn-to-reply pairing"
git push -u origin <branch>
gh pr create --title "jkai: one stream reader per chat, so replies pair with their questions" --body "..."
until [ "$(gh run list --branch <branch> --limit 1 --json conclusion --jq '.[0].conclusion')" != "" ]; do sleep 45; done
gh run list --branch <branch> --limit 1 --json conclusion --jq '.[0].conclusion'   # must be "success"
gh pr merge <N> --squash
```

- [ ] **Step 5: Verify on production**

After CI reports `Build + deploy (VPS): success`, confirm `build/.deploy-sha` on the VPS is newer than the merge, then run the same overlap by hand in the real UI at `https://strangeramblings.com/jkai`: send something slow, send a second message while it's still working, and read the thread. Update memory `reference_jkai_chat_turn_desync.md` from **UNFIXED** to fixed, with the date and PR number.

---

## Escape hatch, if this goes wrong mid-flight

`/admin/ops/engine` has a chat-engine toggle. Switching to the in-repo `generalChat` engine avoids this bug entirely — that path awaits the reply in-process and writes rows in order. Cost: no terminal, file editing, patching, skills, delegation, web search or browser (~54% of tool calls by volume); every site toolset still works. `general-chat.ts` has been untouched since 2026-07-19, so treat it as an experiment rather than a proven fallback.

## Self-review notes

- Every task ends with a runnable command and an expected result.
- Task 1 gates Task 2's design; Task 2b is the branch if the invariant fails.
- Task 6 deliberately follows the working fix, so tagging is never removed before its replacement is proven.
- Task 7 is the only task that can honestly claim the bug is fixed.
