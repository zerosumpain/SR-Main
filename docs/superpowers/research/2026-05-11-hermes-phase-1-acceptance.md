# Hermes Phase 1 Acceptance Log

This file records the actual commands run and observed outputs during
Phase 1 verification. Each scenario maps to the design spec's section 7.1
acceptance grid. Mirrors the Phase 0 log format.

---

## Environment

- **Hermes tag**: v0.13.0 (2026.5.7), commit `498bfc7b`
- **Hermes profile**: `~/.hermes-jkai/`
- **Plugin**: `~/.hermes-jkai/extensions/jkai_platform/` (symlinked from `~/.hermes-jkai/plugins/jkai_platform/`)
- **systemd unit**: `jkai-hermes.service` (user) — `active`, port 18790 bound to 127.0.0.1
- **SvelteKit worktree HEAD pre-acceptance**: `29ce984c`
- **Dev server**: `npm run dev -- --port 5174` (homeserv)
- **DB**: PostgreSQL @ `localhost:5433/strange_rambling`
- **Flag**: `JKAI_HERMES_CANVAS_CHAT=1` set temporarily during scenario runs; reverted before commit. Soak begins with manual flip.

---

## Pre-acceptance fixes

Three independent blockers were discovered during the first scenario run and
fixed before the acceptance grid could proceed. None of them is a regression
from Phase 0 — they are integration bugs surfaced by routing a real model
turn through the platform adapter for the first time.

### Fix 1 — Bypass DM pairing for the jkai platform

**Symptom (from Task 12 smoke + first run of S1):**

```
hermes[…]: WARNING gateway.run: Unauthorized user: sess_anon_wf_test_smoke (jkai) on jkai
```

Hermes' DM-pairing flow (`gateway/pairing.py`) gates every inbound message
on a per-platform approved-users file in `~/.hermes-jkai/pairing/`. Unknown
users get a one-time 8-character pairing code that the bot owner approves
via `hermes pairing approve <platform> <code>`. For Telegram / WhatsApp /
Slack that's appropriate — the platform itself can't authenticate the
sender to Hermes. For jkai it's pure friction: SvelteKit has already
authenticated the user via Auth.js Google OAuth, and the inbound HTTP
endpoint validates `HERMES_BRIDGE_SECRET` on every call.

**Fix (`~/.hermes-jkai/extensions/jkai_platform/__init__.py`):**

Added `allow_all_env="JKAI_ALLOW_ALL_USERS"` to the `ctx.register_platform(...)`
call. This is the same mechanism Hermes already exposes for `DISCORD_ALLOW_ALL_USERS`,
`TELEGRAM_ALLOW_ALL_USERS`, etc. (gateway/run.py:4660 — read from
`PlatformEntry.allow_all_env` and short-circuits `_is_user_authorized` when
truthy).

**Companion change (`~/.hermes-jkai/.env`):**

```
JKAI_ALLOW_ALL_USERS=true
```

**Verification (`~/.hermes-jkai/logs/agent.log`):**

```
inbound message: platform=jkai user=jkai chat=2552bb62-… msg='Add a manual-trigger node.'
```

No `Unauthorized user` warning, no pairing-code DM. Subsequent scenarios all
auth-pass through this path.

### Fix 2 — Guard `request.transport.is_closing()` against `None`

**Symptom (agent.log, 20260511_193955):**

```
File "/home/john/.hermes-jkai/plugins/jkai_platform/http_server.py", line 112,
    in _handle_outbound_sse
    while not request.transport.is_closing():
              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AttributeError: 'NoneType' object has no attribute 'is_closing'
```

`aiohttp.web.Request.transport` becomes `None` after the peer closes the
connection — observed when the SvelteKit consumer disconnected mid-stream.

**Fix (`~/.hermes-jkai/extensions/jkai_platform/http_server.py`):**

```python
while request.transport is not None and not request.transport.is_closing():
    …
```

### Fix 3 — Route inbound messages through `BasePlatformAdapter.handle_message`

**Symptom:** Every scenario hung at `status=running` indefinitely. Hermes
logged `response ready: chat=… time=42.8s response=378 chars` but the SSE
stream only received the home-channel notice — never the actual model reply.

**Root cause:** `JkaiPlatformAdapter.handle_inbound` was awaiting
`self._message_handler(event)` directly. That short-circuits the framework:
`BasePlatformAdapter._process_message_background` (base.py:2765) is what
takes the handler's return value and delivers it via `self._send_with_retry`
→ `self.send(...)`. Calling the handler directly drops the response on the
floor — every other platform (Telegram/Discord/Slack) goes through the
framework path via `self.handle_message(event)`.

**Fix (`~/.hermes-jkai/extensions/jkai_platform/adapter.py`):**

1. `handle_inbound` now calls `self.handle_message(event)` (the
   BasePlatformAdapter framework entry point at base.py:2616).
2. After the framework spawns its background processing task, our
   `handle_inbound` awaits the per-session task (with a 300s timeout) so
   every `adapter.send` frame is enqueued *before* we mark the turn done.
3. Once the session task completes, we enqueue a synthetic `finalize` frame
   so the SvelteKit SSE consumer's `for await … break-on-finalize` loop
   terminates cleanly. Content is empty — the actual reply text has
   already been delivered via prior `send` frames.

**Companion change** in
`src/routes/api/workflows/orchestrator/chat/+server.ts` so the SvelteKit
side correctly uses the accumulated `partialResponse` for the final
`message` field (since the finalize frame intentionally carries no content):

```ts
case 'finalize':
  // The jkai adapter emits a synthetic `finalize` with empty content
  // once `handle_message` finishes — actual reply text already
  // delivered via prior `send` frames.
  return [];
…
if (frame.kind === 'finalize') {
  const finalMessage = frame.content || job.partialResponse || '';
  job.result = { success: true, workflow: null, message: finalMessage };
  publishJobEvent(jobId, { type: 'done', result: job.result as Record<…> });
  break;
}
```

Plus a `finalize: bool = False` kwarg on `edit_message` so the base class's
streaming path (`base.py:1468` passes `finalize` as keyword-only) doesn't
TypeError when streamed responses re-enter Phase 1.5.

**Verification:**

```
$ python3 /tmp/probe2.py
POST status: 202, body: {"accepted": true, "chat_id": "probe-pong-2"}
Opening SSE …
status=200
SSE: event: send
SSE: data: {"kind":"send","chat_id":"probe-pong-2","content":"pong.","…}
SSE: event: finalize
SSE: data: {"kind":"finalize","chat_id":"probe-pong-2","content":"","metadata":{"reason":"turn_complete"},…}
```

`send` followed by `finalize` — exactly the contract the SvelteKit
consumer expects.

---

## Scenario 1 — Single-tool

**Prompt:** `Add a manual-trigger node.`

**Workflow:** `e95af13f-0191-444d-8d37-5acfbe7f8544` (`canvas:hermes-s1`,
created empty for this scenario).

**Job id:** `91484eca-a4e8-4095-8455-4de53cea59de`

**Wall-clock:** ~50 s (model: glm-5.1 via z.ai).

**Tool calls (from final-response narration; tool_calls not captured in
`toolSteps` because the Hermes branch doesn't emit them — Phase 1.5):**

1. `skill_view("jkai-canvas")` — loaded the skill so the model knew the
   workflows-tools contract.
2. `mcp_jkai_workflow_list` — orient (because the agent didn't know which
   canvas was the current one).
3. `mcp_jkai_workflow_inspect` — confirm canvas is empty.
4. `mcp_jkai_workflow_add_node` — add the trigger.

**DB write:**

```sql
SELECT id, type, label FROM workflow_nodes WHERE workflow_id='e95af13f-…';
                  id                  |  type   |     label
--------------------------------------+---------+----------------
 103b4659-e2f4-4767-a373-c0b808ba8cfa | trigger | Manual trigger
```

**Final SSE message:**

> Added the trigger node. The canvas now has 1 node. What should it feed into?

**Result:** **PASS** — one `workflow_add_node` lands, node appears in DB,
SSE finalize fires.

---

## Scenario 2 — Multi-tool

**Prompt:** `Add a scrape node and wire it to the existing summariser.`

**Workflow:** `ab3a699f-bd36-42d5-90c5-2dcc8fd6ebda` (`canvas:hermes-s2`),
pre-seeded with an `llm-call` node labelled `summariser`.

**Job id:** `6d04f406-eb00-49ae-b102-1bf54da21237`

**Wall-clock:** ~65 s.

**Tool calls** (narrated by the final response — `workflow_inspect`,
`workflow_list_node_types`, two `workflow_add_node` calls, one
`workflow_add_edge`).

**DB writes:**

```sql
SELECT id, type, label FROM workflow_nodes WHERE workflow_id='ab3a699f-…';
                  id                  |      type      |    label
--------------------------------------+----------------+-------------
 874e2a41-1ab8-427f-8ef7-bca3b8095d07 | llm-call       | summariser     -- pre-seed
 a2a1651f-5e49-42eb-99b1-1020f8fec9ef | stealth-scrape | Scrape page    -- new

SELECT id, source_node_id, target_node_id FROM workflow_edges WHERE workflow_id='ab3a699f-…';
 3eb0e8d7-… | a2a1651f-… (scrape) | 874e2a41-… (summariser)   -- new
```

**Final SSE message:**

> Done. The scrape node (`stealth-scrape`) is wired into the summariser:
> **Scrape page** → **summariser**. … Want me to fix that, or lint first?

**Result:** **PASS** — multi-tool sequence (`inspect → list_node_types →
add_node → add_edge`), both node and edge writes land.

---

## Scenario 3 — Sustained

**Prompt:** `Build me a workflow that scrapes example.com daily and emails
me a summary.`

**Workflow:** `ef715d3d-af7b-4764-a2cb-5a52726b20c6` (`canvas:hermes-s3`,
fresh empty).

**Job id:** `9cbab7ba-f0b3-40a8-98af-efff098b646c`

**Wall-clock:** ~110 s.

**Tool sequence (from the narrated final response):**

```
workflow_list_node_types
workflow_create                 # initial attempt failed — see deviation below
workflow_list
workflow_update_metadata        # renamed canvas to canvas:example-daily-scraper
workflow_update_metadata        # idempotent second call
workflow_add_node               # scrape
workflow_add_node               # summarize (×2)
workflow_add_node               # email
workflow_update_metadata
workflow_add_node               # final trigger config attempt
workflow_add_edge               # scrape → summarize
workflow_add_edge               # summarize → email
workflow_lint
workflow_update_node            # fixed email template ({{response}} not {{summary}})
workflow_lint
workflow_lint                   # clean
workflow_inspect
```

**DB writes:**

```sql
SELECT id, type, label FROM workflow_nodes WHERE workflow_id='ef715d3d-…';
                  id                  |    type    |       label
--------------------------------------+------------+--------------------
 db78c4fb-… | web-scrape | Scrape example.com
 59e89f4e-… | llm-call   | Summarize Content
 0d5c44bd-… | email      | Email Summary

SELECT id, source_node_id, target_node_id FROM workflow_edges WHERE workflow_id='ef715d3d-…';
 6136d9a7-… | scrape → summarize
 4122abb3-… | summarize → email
```

**Deviations from the spec expectation:**

- Spec said `finalize_workflow` should fire at the end — that tool does not
  exist in the SvelteKit MCP server (no `finalize_workflow` among the 22
  registered tools). The natural terminator here was `workflow_lint`
  returning clean.
- The model did *not* call `workflow_add_schedule`, so the daily-cron
  ("0 8 * * *") it narrated in the final message has no Postgres backing.
  This is a model-prompt issue (the skill doesn't mandate scheduling) and
  is a candidate Phase 1.5 follow-up.
- The model's first `workflow_create` attempt appears to have failed
  silently (`Let me build it manually` in the narration) — followed by
  `workflow_update_metadata` on the already-existing canvas. End result is
  correct (a renamed canvas with three nodes + two edges); it would be
  cleaner to investigate why `workflow_create` reported failure to the
  agent. Tracked as Phase 1.5 follow-up.

**Result:** **PASS** — multi-turn sustained tool use over 100+ s, full
pipeline (scrape → summarize → email) built, linted clean.

---

## Scenario 4 — Out-of-scope token (MCP)

**Goal:** confirm `/api/mcp` rejects requests with the wrong bearer token.

**Invalid bearer:**

```
$ curl -i -X POST http://127.0.0.1:5174/api/mcp \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -H 'Authorization: Bearer wrong-secret' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",…}'

HTTP/1.1 200 OK
content-type: application/json
…
{"jsonrpc":"2.0","id":1,"error":{"code":-32001,
  "message":"unauthorized: invalid or missing bearer token"}}
```

**Missing bearer:**

```
$ curl -i -X POST http://127.0.0.1:5174/api/mcp \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",…}'

…
{"jsonrpc":"2.0","id":1,"error":{"code":-32001,
  "message":"unauthorized: invalid or missing bearer token"}}
```

**Valid bearer sanity check:**

```
$ curl -X POST http://127.0.0.1:5174/api/mcp \
    -H 'Authorization: Bearer <HERMES_BRIDGE_SECRET>' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
{ … result.tools count: 22 … }
```

**Result:** **PASS** — invalid and missing bearer both return JSON-RPC
`-32001 unauthorized: invalid or missing bearer token`. Valid bearer
returns the full 22-tool inventory. (Note: HTTP status is `200 OK` per
MCP Streamable HTTP — error is in the JSON-RPC envelope, not the HTTP
status code. This matches the MCP spec.)

---

## Scenario 5 — Concurrency (3 canvases in flight)

**Workflows:**

- `W1 = ff1126ce-a132-4090-a0b0-7daf3e6c18fd` (`canvas:hermes-s5-1`, empty)
- `W2 = 890e9b44-eea5-4592-8200-8bd4d0c943bf` (`canvas:hermes-s5-2`, empty)
- `W3 = 4547a7c1-a0bc-4d96-ac4f-d413a29c6cec` (`canvas:hermes-s5-3`, empty)

**Method:** fired 3 POSTs to `/api/workflows/orchestrator/chat` back-to-back
(serial fire, ~100 ms apart) — same prompt (`Add a manual-trigger node.`),
each scoped to a different workflowId and a different conversationId.

**Wall-clock per turn (from agent.log):**

- W1: ~102 s (slowest — saw a 2.4s retry mid-run, see `attempt 1/3` log)
- W2: ~61 s
- W3: ~62 s

**Per-workflow `adapter.send` trace (relevant lines from agent.log):**

```
20:24:37  send  chat=890e9b44 content_len=45 'Added the trigger…'
20:24:50  send  chat=4547a7c1 content_len=32 'workflow_add_node…'
20:24:54  send  chat=890e9b44 content_len=182 'The canvas already has a trigger…'
20:24:56  send  chat=4547a7c1 content_len=113 'Done. Added a second Manual Trigger…'
20:25:04  send  chat=ff1126ce content_len=130 'I need to check the current canvas…'
20:25:10  send  chat=ff1126ce content_len=98 'I see there's a dedicated manual-trigger…'
20:25:16  send  chat=ff1126ce content_len=74 'Canvas is empty — adding…'
20:25:22  send  chat=ff1126ce content_len=74 'Added the Manual Trigger node…'
20:25:36  send  chat=ff1126ce content_len=214 'There's already a Manual Trigger node…'
```

Every `adapter.send` chat_id matches the workflow it was created for — no
cross-talk.

**DB state after:**

- W1 ended with 1 `manual-trigger` node.
- W2 ended with 1 `trigger` (manual) node.
- W3 ended with 2 `manual-trigger` nodes (model added one, then on a
  re-entrant call added a second before being told there's a one-trigger
  rule — model behaviour, not a concurrency bug).

**Caveat:** the SvelteKit job-store `deleteJob(jobId)` after first GET-with-
done returns `404` on subsequent polls, which my poll loop misread as
`error`. Re-querying `workflow_nodes` confirms all three turns completed
successfully; the agent.log confirms `response ready` for all three with
distinct `time=` measurements.

**Result:** **PASS** — three independent sessions ran concurrently, each
delivered to its own chat_id, no Postgres cross-contamination, no SSE
frame mis-routing.

---

## Summary

| # | Scenario | Result | Notes |
|---|---|---|---|
| 1 | Single-tool | **PASS** | `workflow_add_node` lands in DB |
| 2 | Multi-tool | **PASS** | `inspect → list_node_types → add_node → add_edge`; node + edge in DB |
| 3 | Sustained | **PASS** | ~16 tool calls across one turn; complete pipeline built |
| 4 | Out-of-scope token | **PASS** | `-32001` on invalid/missing bearer |
| 5 | Concurrency (3-way) | **PASS** | no cross-talk; per-session isolation confirmed in agent.log |

---

## Carry-overs to Phase 1.5

1. **`toolSteps` not populated on the Hermes branch.** The legacy
   `handleWithLoop` path calls `onToolProgress` for each MCP tool call and
   populates `job.toolSteps[]`, which the canvas UI's tool-call drawer
   reads. The Hermes branch doesn't have a hook into Hermes' per-tool
   lifecycle — tool progress is currently only visible via Hermes' own
   inline narration (`⚙️ mcp_jkai_workflow_add_node...`) embedded in the
   chat content. A proper fix would parse those narration markers in the
   adapter and emit `tool_progress` JobEvents, or (cleaner) get Hermes to
   surface a structured tool-call lifecycle frame via the platform
   adapter. Track as Phase 1.5 task: "Hermes tool-call frames →
   `toolSteps`".

2. **Home-channel notice fires on first message per chat.**
   `_deliver_platform_notice` sends a "📬 No home channel is set for Jkai"
   bubble before the real response. For a chat-style canvas this is
   confusing UX. Fixes available: set `JKAI_HOME_CHANNEL=<some_value>` in
   `~/.hermes-jkai/.env` to suppress, OR open a PR upstream to skip the
   notice for `Platform.JKAI`. Track as Phase 1.5.

3. **`workflow_create` apparent failure mid-Scenario-3.** Hermes narrated
   "Let me build it manually" after a `workflow_create` attempt. Worth a
   focused investigation — was the call rejected for missing required
   fields? The MCP server should return a clearer error if so.

4. **Schedule not auto-created from natural-language "daily".** Scenario
   3 narrated a daily 8AM cron but didn't call `workflow_add_schedule`.
   Either the skill needs to instruct on scheduling tools more
   forcefully, or `workflow_create` should accept a `schedule` shorthand.

5. **`/api/mcp` returns HTTP 200 with JSON-RPC error in the body.** This
   matches the MCP Streamable HTTP spec but the Task 14 expected outcome
   said "403". Not a bug — clarifying the expected outcome going forward.

6. **`SvelteKit job-store deleteJob` after first done-poll** confuses
   batched polling tools (my poll loop hit 404 / `?` status after the
   job's first reading-with-result). Behaviour is intentional but worth
   surfacing in docs.

7. **`edit_message(..., finalize=True)` not yet wired to a streaming
   finalize frame.** The base contract passes `finalize` as a kwarg on
   the last edit of a streamed response. Our adapter accepts it but
   doesn't propagate it. Acceptable for now (streaming is disabled by
   default and the per-turn synthetic finalize covers the common case);
   surface this when streaming is re-enabled.

---

## Staging the soak

Phase 1 acceptance is **complete on the flag-on path** with the three
pre-acceptance fixes applied. The soak is now turnkey:

### Procedure for John (flip the flag, restart, watch)

1. Confirm Hermes is running:
   ```bash
   systemctl --user is-active jkai-hermes.service   # → active
   ss -tlnp | grep 18790                            # → 127.0.0.1:18790 LISTEN
   ```

2. Confirm SvelteKit is on 5173 (always-on systemd service) AND it has the
   `HERMES_BRIDGE_SECRET` env var set with the same value as
   `~/.hermes-jkai/.env`. After merging the worktree to `master` and
   deploying, the prod env at `/opt/strange-rambling-svelte/.env` must
   contain:
   ```
   HERMES_BRIDGE_SECRET=fb9bd7e856829e15f939e07a4ce58d94916b1f5d9bbfc5c4bf0d7c42cb057365
   ```
   (rotate before going public).

3. Flip the flag (the only manual action for the soak):
   ```bash
   # In the deployed .env (NOT in the worktree):
   JKAI_HERMES_CANVAS_CHAT=1
   ```

4. Restart the SvelteKit service so it picks up the env change:
   ```bash
   systemctl --user restart strange-rambling-svelte.service   # or scripts/deploy.sh
   ```

5. Open `/jkai/canvas/<any-workflow>` and start chatting. The canvas chat
   is now Hermes-driven.

### What to watch during soak

- **Server-side dev console** (`/tmp/hermes-phase1-dev.log` or wherever
  prod logs land) for any `[hermes-chat] Job failed` lines.
- **Hermes agent log** at `~/.hermes-jkai/logs/agent.log` for
  `response ready` events — every canvas turn should produce one.
- **Adapter send log** — should fire with a `content_len > 0` for every
  turn. A turn with only `adapter.send: content_len=27 preview='📚 skill_view: …'`
  followed by no further sends indicates a model loop / tool failure.
- **Postgres**: spot-check that `workflow_nodes` / `workflow_edges` are
  growing as expected when you chat ("add a node X" should produce a
  matching row within a minute).

### Latency baseline (from this acceptance run)

- Single-tool turn: 30–50 s
- Multi-tool turn (2–4 tools): 60–70 s
- Sustained 10+ tool turn: 100–110 s

This is glm-5.1 via z.ai. OpenRouter / Anthropic configurations will be
faster (per Phase 0 smoke: openrouter ~4.5s, anthropic ~15s for the same
"pong" turn). The Phase 1 plan said "latency within ±20% of baseline" —
the legacy ReAct loop is harder to benchmark per-turn, but the per-tool
latency at this stage is dominated by model wall-time, not orchestrator
overhead. Acceptance for the soak should look at the *delta* from week-
over-week canvas usage, not the absolute numbers.

### When to declare the soak passed

Per spec Phase 1 exit criteria:
- One full calendar week (7 days) with `JKAI_HERMES_CANVAS_CHAT=1` in
  prod.
- No canvas regressions reported (compared to the previous week's flag-off
  behaviour).
- No fatal Hermes crashes that take down `jkai-hermes.service` (the
  systemd unit auto-restarts; an excess of restart events in `journalctl
  --user -u jkai-hermes` would count as a regression).
- Latency p95 within +20% of the flag-off week.

When all four hold, proceed to Task 14 Step 3 (delete `loop.ts` + the
`handleWithLoop` branch) and Step 5 (tag `hermes-phase-1-complete`).

---

## Final acceptance

*(Placeholder — to be filled in after the one-week soak passes.)*

- Scenario 1 (single-tool): PASS — transcript at <line ref>
- Scenario 2 (multi-tool): PASS — transcript at <line ref>
- Scenario 3 (sustained): PASS — transcript at <line ref>
- Scenario 4 (out-of-scope token 403): PASS — audit log entry at <ref>
- Scenario 5 (3-way concurrent canvases): PASS — no cross-talk observed
- One-week soak: ___
- loop.ts deleted at commit ___

Phase 1 complete. Phase 2 (Pi-runner / build loop) can begin.
