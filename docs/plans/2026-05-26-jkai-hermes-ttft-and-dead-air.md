# jkai ↔ Hermes TTFT & Dead-Air Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut perceived time-to-first-token by ~350ms and eliminate the 5s–180s dead-air windows during model thinking and tool execution in the jkai ↔ Hermes streaming pipeline.

**Architecture:** Surgical fixes across three repos — drop stacked batch windows (Hermes `stream_consumer`, jkai_platform SSE handler, browser canvas), then add the missing signals (thinking-token bridge, TTFT instrumentation, tool-preparing/tool-progress events). Each phase is independently shippable and revertable.

**Tech Stack:** Python (Hermes core + plugin), TypeScript/Svelte 5 (jkai canvas UI), aiohttp SSE, EventSource, pytest, vitest.

**Repos touched:**
- `/home/john/hermes-agent/` — upstream Hermes (Python); local clone, no auto-deploy
- `/home/john/.hermes-jkai/` — Hermes plugin + config (`zerosumpain/homeserv-hermes-jkai`); commit per memory's "keep deployment repos updated" rule
- `/home/john/strange_rambling_svelte/` — jkai UI + server (`zerosumpain/SR-Main`); deploy via `~/strange_rambling_svelte/scripts/deploy.sh`

**Hermes restart:** Phases 1, 4, 6 modify Hermes Python — after each, restart Hermes with whatever the user normally uses (gateway service / `hermes` CLI). Note the PID lock at `/home/john/.hermes-jkai/gateway.lock`.

**SvelteKit dev-env gotcha:** `npm run check` needs `NODE_OPTIONS=--max-old-space-size=8192`.

---

## Phase 0: Baseline & Tooling (do this once, before Phase 1)

**Files:**
- Read-only inspection; no edits.

The goal is to capture before-numbers so phases 1–3 are measurably better, not just vibes.

- [ ] **Step 1: Open the canvas chat with DevTools Network panel recording.**

In the browser:
1. Open `http://homeserv:5173/jkai/canvas/<any-existing-chat>` (or create a new chat).
2. Open DevTools → Network tab → check "Preserve log" and "Disable cache".
3. Filter: `EventStream` (to isolate SSE).

- [ ] **Step 2: Send three test messages and record TTFT visually.**

Type "Hi, what time is it?" three times (one at a time). For each, use a stopwatch (phone, `date +%s.%N`) to measure from Enter-press to first visible character. Note the times.

Expected baseline: ~300–500ms TTFT on the home network with z.ai GLM.

- [ ] **Step 3: Send one prompt that triggers a tool call and one that triggers thinking.**

Tool prompt: "list files in my home directory" (forces `terminal` or similar tool).
Thinking prompt: "solve this step by step: a train leaves Boston at 60mph…" (forces reasoning on `glm-5-turbo` or thinking-enabled model).

Record:
- Tool: time from Enter to "tool drawer appears" + duration of "Running tool…" with no progress.
- Thinking: time from Enter to first visible character (will be silent for the whole reasoning duration).

- [ ] **Step 4: Save baseline numbers to a scratch note.**

Create `~/strange_rambling_svelte/docs/plans/2026-05-26-jkai-hermes-ttft-baseline.md` and paste the numbers. We will re-measure after each phase.

No commit needed — this file is scratch and gitignored if needed.

---

## Phase 1: Flush-on-first-delta in Hermes stream consumer

**Files:**
- Modify: `/home/john/hermes-agent/gateway/stream_consumer.py` (add `first_delta_immediate` config field + plumb through run loop)
- Test: `/home/john/hermes-agent/tests/gateway/test_stream_consumer_first_delta.py` (new)

**Background:** `StreamConsumerConfig.edit_interval` defaults to 0.25s (gateway/config.py:345). The consumer's `run()` loop at line 458 only flushes when `elapsed >= self._current_edit_interval` — so the first delta waits up to 250ms before the user sees anything, even when no other deltas are queued. We want first-delta-flushed-immediately, then 250ms coalescing for subsequent deltas (Telegram rate-limit safety preserved).

- [ ] **Step 1: Write the failing test.**

Create `/home/john/hermes-agent/tests/gateway/test_stream_consumer_first_delta.py`:

```python
"""Verify flush-on-first-delta behavior in GatewayStreamConsumer."""
import asyncio
import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from gateway.stream_consumer import GatewayStreamConsumer, StreamConsumerConfig


class FakeAdapter:
    def __init__(self):
        self.sent: list[tuple[float, str]] = []
        self.edits: list[tuple[float, str]] = []
        self._start = time.monotonic()

    async def send(self, *, chat_id, content, **kw):
        self.sent.append((time.monotonic() - self._start, content))
        return MagicMock(success=True, message_id="m1")

    async def edit_message(self, *, chat_id, message_id, content, finalize=False, **kw):
        self.edits.append((time.monotonic() - self._start, content))
        return MagicMock(success=True, message_id="m1")


@pytest.mark.asyncio
async def test_first_delta_flushes_immediately():
    """The first delta must reach the adapter within ~50ms regardless of edit_interval."""
    adapter = FakeAdapter()
    cfg = StreamConsumerConfig(edit_interval=0.25, first_delta_immediate=True)
    consumer = GatewayStreamConsumer(adapter, "chat-1", cfg)

    task = asyncio.create_task(consumer.run())
    await asyncio.sleep(0.01)  # let run() warm up

    consumer.on_delta("Hello")
    await asyncio.sleep(0.08)  # well under the 250ms edit_interval

    # First chunk should have been sent immediately (within ~50ms of on_delta).
    assert len(adapter.sent) == 1, f"expected first delta to flush, got sent={adapter.sent}"
    assert "Hello" in adapter.sent[0][1]
    assert adapter.sent[0][0] < 0.15, f"first delta took {adapter.sent[0][0]:.3f}s, expected <0.15s"

    consumer.finish()
    await task


@pytest.mark.asyncio
async def test_subsequent_deltas_still_batch():
    """After the first delta, subsequent deltas should batch per edit_interval."""
    adapter = FakeAdapter()
    cfg = StreamConsumerConfig(edit_interval=0.2, first_delta_immediate=True)
    consumer = GatewayStreamConsumer(adapter, "chat-1", cfg)

    task = asyncio.create_task(consumer.run())
    await asyncio.sleep(0.01)

    consumer.on_delta("A")
    await asyncio.sleep(0.05)  # first flushed
    # Now hammer with 5 more deltas in 30ms
    for c in "BCDEF":
        consumer.on_delta(c)
        await asyncio.sleep(0.005)

    # Within the edit_interval window, we should see ≤2 edits, not 5
    await asyncio.sleep(0.05)
    assert len(adapter.edits) <= 2, f"expected batching, got edits={adapter.edits}"

    consumer.finish()
    await task
```

- [ ] **Step 2: Run the test — expect it to fail.**

```bash
cd /home/john/hermes-agent
python -m pytest tests/gateway/test_stream_consumer_first_delta.py -v
```

Expected: ImportError or AttributeError on `first_delta_immediate` config field.

- [ ] **Step 3: Add the config field.**

Edit `/home/john/hermes-agent/gateway/stream_consumer.py` — locate the `StreamConsumerConfig` dataclass at line 49–75 and add a new field at the end of the class:

```python
    # When True, the very first delta of a response is flushed to the adapter
    # immediately on arrival (bypassing edit_interval batching) so users see
    # the first character with minimal TTFT. Subsequent deltas still coalesce
    # per edit_interval. Default True — flush-on-first-delta is universally
    # a UX win; platforms with strict rate limits still get the coalescing
    # behavior after the first chunk.
    first_delta_immediate: bool = True
```

- [ ] **Step 4: Plumb the flag into the run loop.**

Open `/home/john/hermes-agent/gateway/stream_consumer.py` and find the flush condition at line 458 (the `elapsed >= self._current_edit_interval` check inside `run()`). Identify how `_already_sent` is set — that's the signal that "first send has happened."

Change the flush condition so the *first* time deltas are non-empty and `_already_sent is False`, we skip the elapsed-time check. Apply this minimal edit:

Find the existing condition (approximate; verify exact text after reading lines 440–480):

```python
                        (elapsed >= self._current_edit_interval
```

Wrap it with the immediate-first-delta gate:

```python
                        (
                            (self.cfg.first_delta_immediate and not self._already_sent)
                            or elapsed >= self._current_edit_interval
```

The closing parens may need adjustment depending on the surrounding boolean structure; read 20 lines around the condition first and integrate cleanly.

- [ ] **Step 5: Run the tests — expect them to pass.**

```bash
cd /home/john/hermes-agent
python -m pytest tests/gateway/test_stream_consumer_first_delta.py -v
```

Expected: both tests PASS.

- [ ] **Step 6: Run the existing stream_consumer test suite — nothing should regress.**

```bash
cd /home/john/hermes-agent
python -m pytest tests/gateway/ -v -k stream_consumer
```

Expected: all green. If any test fails, the issue is likely test assertions that asserted the OLD behavior (no first-delta flush). Inspect — if they assert specific batch boundaries, update them; if they assert correctness invariants, the fix is wrong.

- [ ] **Step 7: Restart Hermes locally and verify with a live message.**

```bash
# Kill the running gateway (if any). The lockfile lives at:
cat /home/john/.hermes-jkai/gateway.pid
kill $(cat /home/john/.hermes-jkai/gateway.pid) 2>/dev/null || true
# Restart however the user normally does — e.g. `hermes gateway` or via systemd.
```

Then in browser, send a fresh chat message at `http://homeserv:5173/jkai/canvas/<chat>` and confirm visually that the first character appears noticeably faster. Compare against the Phase 0 baseline.

- [ ] **Step 8: Commit (Hermes repo).**

```bash
cd /home/john/hermes-agent
git checkout -b ttft/flush-on-first-delta
git add gateway/stream_consumer.py tests/gateway/test_stream_consumer_first_delta.py
git commit -m "feat(stream_consumer): flush-on-first-delta to cut perceived TTFT

The first delta of any streamed response now bypasses edit_interval
batching and flushes immediately. Subsequent deltas still coalesce per
edit_interval so rate-limited platforms (Telegram, Discord) keep their
safety margin. Cuts ~0–250ms of perceived TTFT on jkai canvas chat.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Push/PR decision deferred — for jkai use, local commit is enough until the user decides whether to upstream.)

---

## Phase 2: Replace SSE poll with asyncio.Event in jkai_platform

**Files:**
- Modify: `/home/john/.hermes-jkai/extensions/jkai_platform/adapter.py` (add per-chat `asyncio.Event`, set on enqueue)
- Modify: `/home/john/.hermes-jkai/extensions/jkai_platform/http_server.py:147–171` (replace `asyncio.sleep(0.05)` with `await event.wait()`)
- Test: `/home/john/.hermes-jkai/extensions/jkai_platform/tests/test_http_server_event_drain.py` (new)

**Background:** `http_server.py:171` does `await asyncio.sleep(0.05)` between drain passes — frames sit in the queue for up to 50ms after enqueue before reaching the HTTP response. Converting to an event-driven wake-up removes that jitter for free.

- [ ] **Step 1: Add per-chat event registry to the adapter.**

Read `/home/john/.hermes-jkai/extensions/jkai_platform/adapter.py` around line 150 (the `_outbound: dict[str, list[OutboundFrame]]` declaration). Add a sibling dict:

```python
        self._outbound: dict[str, list[OutboundFrame]] = {}
        # Per-chat asyncio.Event signalled whenever a frame is enqueued.
        # The SSE handler in http_server.py awaits this instead of polling,
        # cutting drain jitter from ~0–50ms to ~0ms.
        self._outbound_signals: dict[str, asyncio.Event] = {}
```

- [ ] **Step 2: Signal the event whenever a frame is enqueued.**

Locate the `_enqueue` helper in `adapter.py` (search for `def _enqueue`). Add the event-set at the end:

```python
    def _enqueue(self, frame: OutboundFrame) -> None:
        self._outbound.setdefault(frame.chat_id, []).append(frame)
        ev = self._outbound_signals.get(frame.chat_id)
        if ev is not None:
            ev.set()
```

- [ ] **Step 3: Expose an accessor for the SSE handler.**

Add a method on `JkaiPlatformAdapter` (somewhere near `drain_outbound`):

```python
    def get_or_create_outbound_signal(self, chat_id: str) -> asyncio.Event:
        """Return the wake-up Event for ``chat_id``, creating it on first use.

        The SSE handler in http_server awaits this event so it wakes the
        instant a frame arrives instead of polling every 50ms.
        """
        ev = self._outbound_signals.get(chat_id)
        if ev is None:
            ev = asyncio.Event()
            self._outbound_signals[chat_id] = ev
        return ev

    def clear_outbound_signal(self, chat_id: str) -> None:
        """Drop the per-chat Event when the SSE subscriber exits."""
        self._outbound_signals.pop(chat_id, None)
```

- [ ] **Step 4: Write the failing test for the event-driven drain.**

Create `/home/john/.hermes-jkai/extensions/jkai_platform/tests/test_http_server_event_drain.py`:

```python
"""SSE drain wakes on event, not on poll interval."""
import asyncio
import time

import pytest

from extensions.jkai_platform.adapter import JkaiPlatformAdapter, OutboundFrame


@pytest.mark.asyncio
async def test_enqueue_wakes_drain_waiter():
    adapter = JkaiPlatformAdapter({"bridge_secret": "x" * 32, "http_port": 0})
    ev = adapter.get_or_create_outbound_signal("chat-1")

    # Start a "drain" task that waits on the event
    drained = []
    async def fake_drain():
        await ev.wait()
        drained.extend(adapter.drain_outbound("chat-1"))

    task = asyncio.create_task(fake_drain())
    await asyncio.sleep(0.005)  # let task park on the event

    t0 = time.monotonic()
    adapter._enqueue(OutboundFrame(
        kind="send", chat_id="chat-1", message_id="m1",
        content="hi", metadata={},
    ))
    await asyncio.wait_for(task, timeout=0.05)
    elapsed = time.monotonic() - t0

    assert len(drained) == 1
    assert elapsed < 0.02, f"event wake should be near-instant, got {elapsed:.3f}s"
```

- [ ] **Step 5: Run the test — expect it to pass.**

```bash
cd /home/john/.hermes-jkai
python -m pytest extensions/jkai_platform/tests/test_http_server_event_drain.py -v
```

Expected: PASS (we already added the supporting methods to the adapter).

- [ ] **Step 6: Update the SSE handler to use the event.**

Open `/home/john/.hermes-jkai/extensions/jkai_platform/http_server.py` and find the drain loop at lines 147–171. Replace the poll-sleep at line 171 with an event-wait, and reset the event after each drain:

```python
    # Wake-up event signalled by adapter._enqueue. Replaces the 50ms poll.
    signal = adapter.get_or_create_outbound_signal(chat_id)

    try:
        while request.transport is not None and not request.transport.is_closing():
            frames = adapter.drain_outbound(chat_id)
            for frame in frames:
                frame_dict: dict = {
                    "kind": frame.kind,
                    "chat_id": frame.chat_id,
                    "message_id": frame.message_id,
                    "content": frame.content,
                    "metadata": frame.metadata,
                    "ts": frame.ts,
                }
                attachment = getattr(frame, "attachment", None)
                if attachment is not None:
                    frame_dict["attachment"] = attachment
                payload = json.dumps(frame_dict)
                await resp.write(f"event: {frame.kind}\n".encode("utf-8"))
                await resp.write(f"data: {payload}\n\n".encode("utf-8"))
            # Event-driven wake-up. Falls back to 1s tick so we still notice
            # transport.is_closing() on quiet streams (no frames, no client).
            signal.clear()
            try:
                await asyncio.wait_for(signal.wait(), timeout=1.0)
            except asyncio.TimeoutError:
                pass
    except (asyncio.CancelledError, ConnectionResetError):
        pass
    finally:
        if subscribers.get(chat_id) is current_task:
            subscribers.pop(chat_id, None)
        adapter.clear_outbound_signal(chat_id)
```

Note the 1s safety timeout: keeps the dead-peer detection loop running for chats with long quiet periods. This is invisible to the user (no frames = no work to flush).

- [ ] **Step 7: Run the full jkai_platform test suite.**

```bash
cd /home/john/.hermes-jkai
python -m pytest extensions/jkai_platform/tests/ -v
```

Expected: all green. If `test_http_server.py` asserts specific poll behavior, update it.

- [ ] **Step 8: Restart Hermes and verify with live chat.**

Same restart steps as Phase 1 Step 7. Send a chat message and confirm the first character still appears fast (now Phase 1 + Phase 2 stack: should be ~50ms faster than after Phase 1 alone).

- [ ] **Step 9: Commit (hermes-jkai repo).**

```bash
cd /home/john/.hermes-jkai
git checkout -b ttft/event-driven-sse-drain
git add extensions/jkai_platform/adapter.py \
        extensions/jkai_platform/http_server.py \
        extensions/jkai_platform/tests/test_http_server_event_drain.py
git commit -m "perf(jkai_platform): event-driven SSE drain replaces 50ms poll

The outbound SSE handler now blocks on a per-chat asyncio.Event signalled
by adapter._enqueue, instead of asyncio.sleep(0.05) polling. Removes
0–50ms of jitter between frame enqueue and HTTP write. Falls back to a
1s safety wake-up so dead-peer detection still runs on quiet streams.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin ttft/event-driven-sse-drain
```

Per memory's "keep deployment repos updated" rule.

---

## Phase 3: Flush-on-first-token in the browser canvas

**Files:**
- Modify: `/home/john/strange_rambling_svelte/src/routes/jkai/canvas/[slug]/+page.svelte:620–643` (flush-immediately-then-batch logic)
- Test: manual visual + DevTools timing (no unit test — the existing setTimeout is timing-dependent UI behavior, hard to assert in vitest without flake)

**Background:** `STREAM_FLUSH_MS = 50` causes the UI to buffer the first token for up to 50ms even when no batching is needed (one-token-in, one-render-out has no markdown-reflow cost). Fix: render the first token of each in-flight reply immediately, then batch subsequent tokens.

- [ ] **Step 1: Read the current flush logic in context.**

```bash
# Read lines 600–680 to see the surrounding state declarations
```

Use the Read tool with `offset=600, limit=80` on `/home/john/strange_rambling_svelte/src/routes/jkai/canvas/[slug]/+page.svelte`. Note the names of:
- `STREAM_FLUSH_MS`
- `pendingStreamDeltas` (Map<bubbleId, string>)
- `streamingReplies` (the reactive state holding live bubble content)
- `flushStreamDeltas` (the function the setTimeout calls)
- `queueStreamDelta` (the caller that adds to `pendingStreamDeltas`)

These names are used below — if any differ in the actual code, substitute the real names.

- [ ] **Step 2: Add a per-bubble "has rendered first token" flag.**

Inside the canvas component script block, near the other stream-buffering state:

```typescript
  // Bubbles that have already rendered their first token — these are eligible
  // for normal 50ms batching. Bubbles not in this set get an immediate flush
  // on the first token they receive (TTFT win).
  let bubblesWithFirstTokenRendered = new Set<string>();
```

- [ ] **Step 3: Patch `queueStreamDelta` to flush-immediately-then-batch.**

Locate the existing `queueStreamDelta` function near line 635. Replace it with:

```typescript
  function queueStreamDelta(bubbleId: string, delta: string) {
    const prev = pendingStreamDeltas.get(bubbleId) ?? '';
    pendingStreamDeltas.set(bubbleId, prev + delta);

    if (!bubblesWithFirstTokenRendered.has(bubbleId)) {
      // First token for this bubble — flush synchronously so the user sees
      // the first character as soon as it arrives, no setTimeout wait.
      bubblesWithFirstTokenRendered.add(bubbleId);
      flushStreamDeltas();
      return;
    }

    if (flushTimer == null) {
      flushTimer = setTimeout(flushStreamDeltas, STREAM_FLUSH_MS);
    }
  }
```

(Variable name `flushTimer` is illustrative — substitute whatever the current code uses to track the pending setTimeout handle.)

- [ ] **Step 4: Clear the per-bubble flag when a reply completes.**

Find where `streamingReplies` is finalized into the persistent `messages` array (likely on a `done` JobEvent). At that finalisation point, also clear the bubble's entry from `bubblesWithFirstTokenRendered`:

```typescript
      bubblesWithFirstTokenRendered.delete(progressId);
```

Otherwise the Set grows unbounded across a long-lived chat session. (Not a perf issue per se — strings are GC'd when the chat closes — but it's clean.)

- [ ] **Step 5: Type-check.**

```bash
cd /home/john/strange_rambling_svelte
NODE_OPTIONS=--max-old-space-size=8192 npm run check
```

Expected: no new errors. If there are existing errors unrelated to this change, leave them.

- [ ] **Step 6: Restart dev server and verify visually.**

```bash
# In the project dir:
npm run dev
# Server listens on port 5173 — visit http://homeserv:5173/jkai/canvas/<chat>
```

Send a message. Observe that the first character appears near-instantly (compared to Phase 0 baseline + Phases 1–2 already deployed on the Hermes side).

- [ ] **Step 7: Commit (strange_rambling_svelte).**

```bash
cd /home/john/strange_rambling_svelte
git checkout -b ttft/canvas-flush-on-first-token
git add src/routes/jkai/canvas/'[slug]'/+page.svelte
git commit -m "perf(canvas): flush first token immediately, batch the rest

Per-bubble guard set tracks whether the bubble has rendered its first
token. The first call to queueStreamDelta for a fresh bubble flushes
synchronously; subsequent calls fall back to the 50ms setTimeout batch.
Eliminates 0–50ms of TTFT on the browser side.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Ship to production.**

Per memory's "Always deploy" rule for strange_rambling_svelte:

```bash
git push
~/strange_rambling_svelte/scripts/deploy.sh
```

Verify live at `https://strangeramblings.com/jkai/canvas/<chat>` per memory's deployment verification discipline.

---

## Phase 4: Thinking-token bridge (Hermes → jkai_platform → canvas)

**Files:**
- Modify: `/home/john/hermes-agent/acp_adapter/events.py:189–202` (route thinking through the platform adapter, not just ACP)
- Modify: `/home/john/.hermes-jkai/extensions/jkai_platform/adapter.py` (add `thinking` OutboundFrame kind + `send_thinking` method)
- Modify: `/home/john/strange_rambling_svelte/src/routes/api/workflows/orchestrator/chat/+server.ts:82–111` (adapt `thinking` frame → new JobEvent)
- Modify: `/home/john/strange_rambling_svelte/src/lib/workflows/chat/job-store.ts:38–60` (add `thinking` JobEvent variant)
- Modify: `/home/john/strange_rambling_svelte/src/lib/components/jkai/ChatArea.svelte` (render collapsible Reasoning panel)
- Test (Python): `/home/john/.hermes-jkai/extensions/jkai_platform/tests/test_thinking_frame.py`
- Test (TS): `/home/john/strange_rambling_svelte/src/lib/jkai/hermes-client.test.ts` (extend existing)

**Background:** Hermes' `make_thinking_cb` emits to ACP only — jkai never sees thinking tokens. For models with extended reasoning (Claude thinking, GLM-5 reasoning), the user stares at "Thinking…" for up to 3 minutes. We bridge the callback through `jkai_platform` as a new `thinking` frame, surface it as a `thinking` JobEvent, and render it in a collapsed Reasoning panel that lives next to the assistant bubble.

**UX decision needed up front:** Should the Reasoning panel be expanded by default or collapsed? **Recommendation: collapsed, with a single-line preview of the latest thinking line.** This matches Claude.ai's UX. If the user wants expanded-by-default we'll flip a boolean.

### Phase 4a: Hermes side — emit thinking via the platform adapter

- [ ] **Step 1: Locate the thinking callback wire-up.**

Read `/home/john/hermes-agent/acp_adapter/events.py` lines 180–210. Confirm `make_thinking_cb` signature. Then grep to find where the AIAgent's `thinking_callback` is wired up for the jkai platform:

```bash
grep -rn "thinking_callback\|make_thinking_cb" /home/john/hermes-agent /home/john/.hermes-jkai 2>/dev/null | grep -v __pycache__
```

This will reveal whether `jkai_platform/adapter.py` already constructs an `AIAgent` (in which case we add the callback there) or whether it goes through a shared `gateway/run.py` path. Adjust the rest of this phase based on what you find.

- [ ] **Step 2: Add `send_thinking` to `JkaiPlatformAdapter`.**

In `/home/john/.hermes-jkai/extensions/jkai_platform/adapter.py`, near `send`/`edit_message`, add:

```python
    async def send_thinking(self, chat_id: str, text: str,
                            *, message_id: str | None = None,
                            metadata: dict | None = None) -> None:
        """Emit a thinking-delta frame for live reasoning display.

        Unlike `send`/`edit_message`, thinking frames are not associated with
        the assistant bubble — they render in a separate collapsible panel.
        ``text`` is the CUMULATIVE thinking so far (per Hermes thinking_cb
        contract); we compute the tail delta here so the UI can append.
        """
        mid = message_id or f"think:{chat_id}"
        clean = (text or "").strip()
        if not clean:
            return
        prev = self._last_sent_by_message.get(mid, "")
        if clean.startswith(prev):
            delta = clean[len(prev):]
        else:
            # Revision — overwrite (rare; thinking is normally append-only)
            delta = clean
        self._last_sent_by_message[mid] = clean
        if not delta:
            return
        self._enqueue(OutboundFrame(
            kind="thinking",
            chat_id=chat_id, message_id=mid, content=delta,
            metadata=metadata or {},
        ))
```

- [ ] **Step 3: Wire the thinking callback from AIAgent → adapter.**

Wherever the AIAgent is constructed for jkai (likely in `adapter.py` or the gateway run loop — Step 1 will have told you), set `thinking_callback` so each fired delta calls `self.send_thinking(chat_id, text)`. Sketch:

```python
        # In adapter.handle_inbound, when constructing AIAgent for this chat:
        def _thinking_cb(text: str) -> None:
            # Hermes fires thinking_callback from a worker thread — schedule
            # the async send onto our loop.
            asyncio.run_coroutine_threadsafe(
                self.send_thinking(chat_id, text), self._loop,
            )

        agent.thinking_callback = _thinking_cb
```

If the agent is constructed inside `gateway/run.py` instead, the wiring goes there and `self._loop` becomes the gateway's loop. Adjust to fit.

- [ ] **Step 4: Write the failing test (Python side).**

Create `/home/john/.hermes-jkai/extensions/jkai_platform/tests/test_thinking_frame.py`:

```python
"""Thinking deltas surface as `thinking` OutboundFrames with tail-delta semantics."""
import asyncio
import pytest

from extensions.jkai_platform.adapter import JkaiPlatformAdapter


@pytest.mark.asyncio
async def test_thinking_emits_tail_delta():
    adapter = JkaiPlatformAdapter({"bridge_secret": "x" * 32, "http_port": 0})

    await adapter.send_thinking("c1", "Let me think")
    await adapter.send_thinking("c1", "Let me think about this carefully.")

    frames = adapter.drain_outbound("c1")
    assert len(frames) == 2
    assert frames[0].kind == "thinking"
    assert frames[0].content == "Let me think"
    assert frames[1].content == " about this carefully."
    assert frames[1].kind == "thinking"


@pytest.mark.asyncio
async def test_thinking_skips_redundant_empty_delta():
    adapter = JkaiPlatformAdapter({"bridge_secret": "x" * 32, "http_port": 0})
    await adapter.send_thinking("c1", "Hello")
    await adapter.send_thinking("c1", "Hello")  # identical — no delta
    frames = adapter.drain_outbound("c1")
    assert len(frames) == 1
```

- [ ] **Step 5: Run Python tests.**

```bash
cd /home/john/.hermes-jkai
python -m pytest extensions/jkai_platform/tests/test_thinking_frame.py -v
```

Expected: PASS.

### Phase 4b: SvelteKit side — receive thinking frame, render panel

- [ ] **Step 6: Add the `thinking` JobEvent variant.**

In `/home/john/strange_rambling_svelte/src/lib/workflows/chat/job-store.ts`, find the `JobEvent` type union (around line 38–60) and add:

```typescript
  | { type: 'thinking'; delta: string; messageId?: string }
```

- [ ] **Step 7: Update `adaptFrameToCanvasSse` to translate the new frame.**

In `/home/john/strange_rambling_svelte/src/routes/api/workflows/orchestrator/chat/+server.ts` around line 82–111, find the switch over `frame.kind`. Add:

```typescript
    if (frame.kind === 'thinking') {
      return [{
        type: 'thinking' as const,
        delta: frame.content,
        messageId: frame.message_id,
      }];
    }
```

- [ ] **Step 8: Add the `SseFrame` kind in the client type.**

In `/home/john/strange_rambling_svelte/src/lib/jkai/hermes-client.ts`, locate the `SseFrame` type or wherever the `kind` union is declared. Add `'thinking'` to the allowed values.

- [ ] **Step 9: Write the failing TS test for the adapter.**

Open `/home/john/strange_rambling_svelte/src/lib/jkai/hermes-client.test.ts` and add a test (alongside the existing ones — check the file's test pattern first):

```typescript
import { describe, it, expect } from 'vitest';
import { adaptFrameToCanvasSse } from '$lib/jkai/hermes-client'; // or wherever

describe('adaptFrameToCanvasSse — thinking frame', () => {
  it('emits a thinking JobEvent with the delta', () => {
    const events = adaptFrameToCanvasSse({
      kind: 'thinking',
      chat_id: 'c1',
      message_id: 'think:c1',
      content: 'reasoning step',
      metadata: {},
      ts: Date.now(),
    });
    expect(events).toEqual([
      { type: 'thinking', delta: 'reasoning step', messageId: 'think:c1' },
    ]);
  });
});
```

NB: `adaptFrameToCanvasSse` may live in `+server.ts` rather than `$lib`. If so, either move it to `$lib/jkai/sse-adapter.ts` and re-export from `+server.ts` (cleaner), or write the test against the `+server.ts` route handler. Prefer the move-to-lib refactor — it keeps logic testable.

- [ ] **Step 10: Run the TS test.**

```bash
cd /home/john/strange_rambling_svelte
npx vitest run src/lib/jkai/hermes-client.test.ts
```

Expected: PASS (after implementing Steps 6–8).

- [ ] **Step 11: Render the Reasoning panel in ChatArea.**

In `/home/john/strange_rambling_svelte/src/lib/components/jkai/ChatArea.svelte`, locate where `tool_start`/`tool_result`/`heartbeat` events are handled (around line 700+, per the earlier analysis). Add a sibling handler:

```typescript
    if (data.type === 'thinking') {
      const id = data.messageId ?? `think:${progressId}`;
      const prev = thinkingByBubble.get(progressId) ?? { text: '', expanded: false };
      thinkingByBubble.set(progressId, { ...prev, text: prev.text + data.delta });
      thinkingByBubble = thinkingByBubble;  // Svelte 5: trigger reactivity
      // Optional: clear the heartbeat since we now have live evidence of progress
      heartbeat = null;
    }
```

Add a per-message state map near the existing `subAgents` declaration:

```typescript
  let thinkingByBubble = new Map<string, { text: string; expanded: boolean }>();
```

Then in the message rendering template, near the bubble for `progressId`, add (Svelte syntax — adapt to the surrounding template):

```svelte
{#if thinkingByBubble.has(message.id)}
  {@const t = thinkingByBubble.get(message.id)!}
  <details class="reasoning-panel" open={t.expanded}>
    <summary class="reasoning-summary">
      <span class="reasoning-label">Reasoning</span>
      <span class="reasoning-preview">{t.text.split('\n').at(-1)?.slice(0, 80) ?? ''}</span>
    </summary>
    <pre class="reasoning-body">{t.text}</pre>
  </details>
{/if}
```

Add minimal styles (match the `.nm-sec` design language per the SR design memory):

```css
  .reasoning-panel {
    margin: 4px 0;
    padding: 8px 12px;
    border: 1px solid var(--nm-border);
    border-radius: 6px;
    background: var(--nm-bg-soft);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.85em;
  }
  .reasoning-summary {
    cursor: pointer;
    display: flex;
    gap: 8px;
    color: var(--nm-text-dim);
  }
  .reasoning-label { font-weight: 600; }
  .reasoning-preview {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .reasoning-body {
    margin-top: 8px;
    white-space: pre-wrap;
    color: var(--nm-text);
  }
```

Verify against the actual design tokens used in `/admin/files` per the SR design memory before committing — these var names are illustrative.

- [ ] **Step 12: Clear thinking state when the reply finalises.**

Wherever `streamingReplies` gets finalised into `messages`, also keep the thinking panel — but stop accumulating into it. Since the thinking is already stored in `thinkingByBubble` keyed by `progressId`, no action needed unless you want it persisted across page reload (out of scope for this phase).

- [ ] **Step 13: Run check + visual test.**

```bash
cd /home/john/strange_rambling_svelte
NODE_OPTIONS=--max-old-space-size=8192 npm run check
npm run dev
```

In the browser, send a prompt that triggers thinking ("solve step by step…"). Confirm the Reasoning panel appears under the bubble and streams thinking tokens live. Click to expand/collapse.

- [ ] **Step 14: Commit (each repo separately).**

```bash
# Hermes
cd /home/john/hermes-agent
git add acp_adapter/events.py
git commit -m "feat(thinking): route thinking deltas through platform adapter

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

# Hermes-jkai
cd /home/john/.hermes-jkai
git add extensions/jkai_platform/adapter.py extensions/jkai_platform/tests/test_thinking_frame.py
git commit -m "feat(jkai_platform): emit thinking frames for live reasoning display

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin HEAD

# SvelteKit
cd /home/john/strange_rambling_svelte
git add src/routes/api/workflows/orchestrator/chat/+server.ts \
        src/lib/workflows/chat/job-store.ts \
        src/lib/jkai/hermes-client.ts \
        src/lib/jkai/hermes-client.test.ts \
        src/lib/components/jkai/ChatArea.svelte
git commit -m "feat(jkai canvas): render live reasoning panel from Hermes thinking

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
~/strange_rambling_svelte/scripts/deploy.sh
```

Verify live per deployment-verification discipline.

---

## Phase 5: TTFT instrumentation

**Files:**
- Create: `/home/john/strange_rambling_svelte/src/lib/jkai/ttft-metrics.ts` (browser-side timing collection)
- Modify: `/home/john/strange_rambling_svelte/src/lib/components/jkai/ChatArea.svelte` (call `mark()` at send + first-token)
- Modify: `/home/john/hermes-agent/agent/chat_completion_helpers.py:1401` (surface `_diag["first_chunk_at"]` to a log)
- (Optional) `/home/john/strange_rambling_svelte/src/routes/api/jkai/ttft/+server.ts` (analytics sink)

**Background:** Without measurement, future regressions are invisible. We add browser-side `performance.mark()`s plus a console log so the user (and developers) can see TTFT in DevTools. A future task can pipe these into the existing observability system.

- [ ] **Step 1: Create the metrics helper.**

Write `/home/john/strange_rambling_svelte/src/lib/jkai/ttft-metrics.ts`:

```typescript
/**
 * Lightweight TTFT (time-to-first-token) instrumentation for jkai canvas chat.
 *
 * Usage:
 *   const m = startTtftMark(jobId);
 *   // ... send request ...
 *   m.onFirstToken();  // call this on the first token event for this jobId
 *
 * Logs to console (always) and `performance.measure()` (for DevTools Performance
 * panel). No external telemetry — purely a local diagnostic.
 */
const marks = new Map<string, number>();

export function startTtftMark(jobId: string): { onFirstToken: () => void } {
  const t0 = performance.now();
  marks.set(jobId, t0);
  performance.mark(`ttft:send:${jobId}`);
  return {
    onFirstToken: () => {
      const start = marks.get(jobId);
      if (start == null) return;
      marks.delete(jobId);
      const elapsed = performance.now() - start;
      performance.mark(`ttft:first:${jobId}`);
      try {
        performance.measure(`ttft:${jobId}`, `ttft:send:${jobId}`, `ttft:first:${jobId}`);
      } catch {
        // ignore measurement errors (e.g. mark already cleared)
      }
      // eslint-disable-next-line no-console
      console.log(`[ttft] ${elapsed.toFixed(0)}ms (jobId=${jobId})`);
    },
  };
}
```

- [ ] **Step 2: Wire it into ChatArea.svelte.**

At the point where the message is POSTed to `/api/workflows/orchestrator/chat` (around line 256–264 per the earlier review), capture the mark:

```typescript
import { startTtftMark } from '$lib/jkai/ttft-metrics';

// inside the send handler:
const ttft = startTtftMark(progressId);
// ... existing fetch + EventSource setup ...
```

In the SSE event handler where `type === 'token'` or `type === 'thinking'` (whichever you want to count as "first sign of life"), call:

```typescript
    if (data.type === 'token' && pendingTtft.has(progressId)) {
      pendingTtft.get(progressId)!.onFirstToken();
      pendingTtft.delete(progressId);
    }
```

Add a small Map at the top of the component to hold pending marks per bubble:

```typescript
  let pendingTtft = new Map<string, { onFirstToken: () => void }>();
```

And on send: `pendingTtft.set(progressId, ttft);`

**UX decision:** count `thinking` as first-token-ish (i.e. fire onFirstToken on the first thinking delta too), since users care about "any sign of life." If you only want pure text-token TTFT, gate strictly on `data.type === 'token'`.

- [ ] **Step 3: Verify in DevTools.**

```bash
cd /home/john/strange_rambling_svelte
npm run dev
```

Open the canvas, send a message, check the Console — should see `[ttft] 123ms (jobId=...)`. Open DevTools → Performance → look for `ttft:<jobId>` measures on the timeline.

- [ ] **Step 4: (Optional) Surface Hermes first-chunk timestamp to logs.**

In `/home/john/hermes-agent/agent/chat_completion_helpers.py:1392–1423`, the diagnostic dict already captures `first_chunk_at`. Add a single log line right after it's set:

```python
            if _diag.get("first_chunk_at") is None:
                _diag["first_chunk_at"] = time.monotonic()
                logger.info(
                    "[ttft] first_chunk_at provider=%s elapsed=%.3fs",
                    provider, _diag["first_chunk_at"] - _diag["api_call_start"],
                )
```

This pairs with the browser metric: subtract one from the other to isolate browser-vs-network-vs-LLM latency.

- [ ] **Step 5: Commit (each repo).**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/jkai/ttft-metrics.ts src/lib/components/jkai/ChatArea.svelte
git commit -m "obs(jkai): TTFT instrumentation via performance marks + console log

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
~/strange_rambling_svelte/scripts/deploy.sh

# If Step 4 was done:
cd /home/john/hermes-agent
git add agent/chat_completion_helpers.py
git commit -m "obs(stream): log first-chunk TTFT per LLM call

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Re-measure phases 1–3.**

Repeat Phase 0's measurement steps, this time reading TTFT from the console log instead of stopwatching. Append the numbers to the baseline scratch file as "After phases 1–3" so we have evidence the optimisations actually shipped a win.

---

## Phase 6: `tool_preparing` event + `ctx.emit` progress API

**Files:**
- Modify: `/home/john/hermes-agent/acp_adapter/events.py:114–183` (emit on `tool.preparing` not just `tool.started`)
- Modify: `/home/john/.hermes-jkai/extensions/jkai_platform/adapter.py` (new `tool_preparing` frame kind or reuse `tool_start` with a status flag)
- Modify: `/home/john/strange_rambling_svelte/src/routes/api/workflows/orchestrator/chat/+server.ts:82–111` (adapt `tool_preparing` → JobEvent)
- Modify: `/home/john/strange_rambling_svelte/src/lib/workflows/chat/job-store.ts:38–60` (add `tool_preparing` JobEvent variant)
- Modify: `/home/john/strange_rambling_svelte/src/lib/components/jkai/ChatArea.svelte` (render "Preparing X…" state in tool drawer)
- Modify: long-running site-tools (e.g. `web_extract`, `terminal`) to call `ctx.emit({ note, percent? })` — TBD which tools depending on actual usage
- Test (Python): `/home/john/.hermes-jkai/extensions/jkai_platform/tests/test_tool_preparing.py`
- Test (TS): extend `hermes-client.test.ts`

**Background:** Phase 4 fixed thinking dead-air. This phase fixes tool-arg-construction dead-air ("model is mid-decision but UI shows nothing") and tool-execution dead-air ("tool running for 30s with no progress").

### Phase 6a: tool_preparing event

- [ ] **Step 1: Emit `tool_preparing` from Hermes when the model decides on a tool.**

In `/home/john/hermes-agent/acp_adapter/events.py:114–183`, locate the `tool_progress_cb` callback (only handles `tool.started` currently). Extend it to also handle `tool.preparing` (or whatever event_type AIAgent fires when tool-decision is taken but args aren't finalized — read the AIAgent code to confirm the event_type string):

```python
def make_tool_progress_cb(conn, session_id, loop):
    def _cb(event_type: str, name: str, preview: str, args: dict, **kwargs):
        if event_type == "tool.preparing":
            update = build_tool_preparing(name=name)
            _send_update(conn, session_id, loop, update)
            return
        if event_type == "tool.started":
            # existing logic
            ...
    return _cb
```

Add a builder `build_tool_preparing(name)` in `acp_adapter/tools.py` (mirror `build_tool_start` structure).

**If `tool.preparing` isn't a real AIAgent event_type**, add one — the agent surely has a hook between "model returned a tool_call delta" and "args fully parsed." Find it via:

```bash
grep -rn "tool.started\|tool_progress_cb\|tool_progress_callback" /home/john/hermes-agent/agent/
```

The cheapest path forward is to add the emission inside `chat_completion_helpers.py` at the point the first tool-call delta is detected (likely around the streaming chunk loop near line 1430).

- [ ] **Step 2: Add `tool_preparing` frame on the jkai adapter side.**

In `/home/john/.hermes-jkai/extensions/jkai_platform/adapter.py`, add a method:

```python
    async def send_tool_preparing(self, chat_id: str, *, tool_call_id: str,
                                   tool_name: str) -> None:
        self._enqueue(OutboundFrame(
            kind="tool_preparing",
            chat_id=chat_id, message_id=tool_call_id,
            content="", metadata={"tool": tool_name},
        ))
```

Wire it where the Phase 4 thinking_callback was wired: the AIAgent's tool-progress callback for jkai sessions calls `adapter.send_tool_preparing` on the `tool.preparing` event_type.

- [ ] **Step 3: TS-side adapt + JobEvent + UI.**

In `+server.ts:adaptFrameToCanvasSse`, add:

```typescript
    if (frame.kind === 'tool_preparing') {
      return [{
        type: 'tool_preparing' as const,
        tool: (frame.metadata?.tool as string) ?? 'tool',
        toolCallId: frame.message_id,
      }];
    }
```

In `job-store.ts` JobEvent union: `| { type: 'tool_preparing'; tool: string; toolCallId: string }`.

In `ChatArea.svelte`, before the existing `tool_start` handler, add:

```typescript
    if (data.type === 'tool_preparing') {
      // Insert a placeholder tool row in "preparing" state. The next tool_start
      // for the same toolCallId will upgrade it to "running".
      const newStep: ToolStep = {
        tool: data.tool, args: {}, status: 'preparing',
        toolCallId: data.toolCallId,
      };
      messages = messages.map((m) => {
        if (m.id !== progressId) return m;
        return { ...m, toolSteps: [...(m.toolSteps ?? []), newStep] };
      });
    }
```

Extend `ToolStep` type to allow `status: 'preparing' | 'running' | 'done' | 'error'`. Update the existing `tool_start` handler to find-and-upgrade an existing `preparing` step (by `toolCallId`) instead of always appending.

Add a CSS class for the preparing state — show the tool name with a pulse animation but no args yet:

```css
  .tool-step--preparing { opacity: 0.6; }
  .tool-step--preparing .tool-step-label::after {
    content: ' • preparing…';
    color: var(--nm-text-dim);
  }
```

- [ ] **Step 4: Tests (Python + TS).**

Python: `extensions/jkai_platform/tests/test_tool_preparing.py`:

```python
import pytest
from extensions.jkai_platform.adapter import JkaiPlatformAdapter

@pytest.mark.asyncio
async def test_tool_preparing_emits_frame():
    adapter = JkaiPlatformAdapter({"bridge_secret": "x" * 32, "http_port": 0})
    await adapter.send_tool_preparing("c1", tool_call_id="t1", tool_name="web_extract")
    frames = adapter.drain_outbound("c1")
    assert len(frames) == 1
    assert frames[0].kind == "tool_preparing"
    assert frames[0].metadata["tool"] == "web_extract"
```

TS: extend `hermes-client.test.ts` to cover the new frame kind in `adaptFrameToCanvasSse`. Same pattern as Phase 4 Step 9.

- [ ] **Step 5: Commit (Phase 6a — preparing event only).**

```bash
# All three repos as in Phase 4 Step 14. One commit per repo.
```

### Phase 6b: ctx.emit progress for long-running tools

- [ ] **Step 6: Pick one tool to instrument first as proof-of-concept.**

Recommendation: `web_extract` (memory mentions stealth-scrape proxy workflows that can take 30+s). Find its handler:

```bash
grep -rn "name.*web_extract\|tool.*web_extract" /home/john/strange_rambling_svelte/src/lib/workflows/ /home/john/strange_rambling_svelte/src/lib/mcp/ 2>/dev/null | head
```

- [ ] **Step 7: Verify `ctx.emit` already wires through.**

From the earlier analysis, `/home/john/strange_rambling_svelte/src/lib/mcp/jsonrpc.ts:255–273` already forwards `ctx.emit()` calls to the tool-step bus as `status` JobEvents. Confirm by reading those lines. If the plumbing is in place, the only change needed is calls to `ctx.emit` from the tool handler.

- [ ] **Step 8: Add `ctx.emit` calls inside `web_extract`.**

Inside the tool handler:

```typescript
  ctx.emit({ note: `Fetching ${urls.length} URL(s)…` });
  for (const [i, url] of urls.entries()) {
    ctx.emit({ note: `(${i + 1}/${urls.length}) ${new URL(url).hostname}` });
    const html = await fetchPage(url);
    // ...
  }
  ctx.emit({ note: `Extracting content…` });
```

The actual signature of `ctx.emit` is whatever `/home/john/strange_rambling_svelte/src/lib/mcp/jsonrpc.ts` defines — read and match.

- [ ] **Step 9: Verify visually with a slow extract.**

```bash
npm run dev
# In canvas chat: "extract https://en.wikipedia.org/wiki/SvelteKit and https://example.com"
```

Watch the tool drawer in real time. Each `ctx.emit` should append a status line.

- [ ] **Step 10: Document the pattern + a TODO list.**

Add a brief section to `~/strange_rambling_svelte/docs/jkai-tool-progress.md` (new file) listing:
- The `ctx.emit` API (signature + behaviour)
- A checklist of tools that *should* emit progress: `web_extract` (✓ done), `terminal`, `write_document` (for long writes), browser_vision (for multi-screenshot operations), etc.

This is the seed for future incremental work — don't try to instrument all tools in this PR.

- [ ] **Step 11: Commit (Phase 6b).**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/workflows/.../web_extract.ts  # or wherever the handler lives
git add docs/jkai-tool-progress.md
git commit -m "feat(tools): emit progress notes from web_extract; document ctx.emit pattern

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
~/strange_rambling_svelte/scripts/deploy.sh
```

---

## Final verification

- [ ] **Re-run Phase 0 measurements with all six phases live.**

Capture new TTFT numbers and tool/thinking dead-air durations. Append to the baseline scratch file as "Final".

Expected outcomes:
- Plain text TTFT: ~100–150ms (down from ~300–500ms)
- Thinking dead-air: <1s (down from 60–180s) — the user sees the Reasoning panel light up
- Tool-arg dead-air: <1s — the user sees a "preparing…" pill before args render
- `web_extract` progress: visible per-URL — no more 30s opaque waits

If any number didn't improve, that phase didn't ship correctly — bisect by rolling back commits one phase at a time.

- [ ] **Cleanup: archive the baseline scratch file.**

```bash
mv ~/strange_rambling_svelte/docs/plans/2026-05-26-jkai-hermes-ttft-baseline.md \
   ~/strange_rambling_svelte/docs/plans/2026-05-26-jkai-hermes-ttft-measurements.md
git add ~/strange_rambling_svelte/docs/plans/2026-05-26-jkai-hermes-ttft-measurements.md
git commit -m "docs: capture TTFT measurements before/after the latency pass

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

## Out of scope (for follow-up plans)

- Prompt caching on the Hermes side (Claude `cache_control` on system prompt + tool manifest)
- Switching jkai → Hermes transport to Unix socket
- Async user-message DB write (currently blocks 5–50ms on the critical path)
- Heartbeat cadence reduction from 5s → 2s during active LLM/tool phases
- Sub-agent token persistence (currently `liveTokens` cleared on `subagent_done`)

These were called out in the integration review but deferred to keep this plan focused on the user's stated order of attack.
