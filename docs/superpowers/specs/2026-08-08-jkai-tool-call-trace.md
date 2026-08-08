# jkai tool-call trace — a full-page, table-ified view of a turn's call chain

**Date:** 2026-08-08
**Status:** building
**Kick-off:** "on jkai, when the model is thinking / calling tools you can explore the details of the
particular call by clicking on details where it returns the raw JSON of a call. I want the ability to
click on the block and open the chain of calls in a new tab, where those calls are prettified /
table-ified where possible. this should allow a user, if interested, to decompose and analyse the
series of calls in detail" → then "go with 1, crack on" (Full autonomy grade).

## Problem

The chat's `details` toggle (`ChatArea.svelte:2334-2363` live, `:2447-2487` on a finished reply) shows
one step's `args` and `result` as raw JSON via `JsonBlock`. There is no way to see the *chain* — the
ordered series of calls, their durations, which failed, what each one actually did — and no way to get
it out of the chat column, which is ~600px wide and interleaved with prose.

**The blocking constraint:** on the live Hermes engine the chain is not persisted anywhere in Postgres.

- `handleWithHermes` writes exactly five metadata keys (`chatNodeId`, `usage`, `attachments`,
  `fileRefs`, `researchRefs`, `workflowRefs`) — `+server.ts:816-834`. No `toolSteps`.
- `job.toolSteps` is initialised `[]` (`job-store.ts:471`) and **never written on the Hermes branch** —
  the only writes in the repo are in the dormant legacy `handleWithLoop` (`+server.ts:1198-1203`).
- Verified against the production DB: 950 assistant rows, 120 with `metadata.toolSteps`, **most recent
  2026-05-14** (the Hermes cutover). Zero in the last 45 days.
- So today, reloading a thread loses the tool activity entirely — the `<details class="tool-activity">`
  block does not render at all for any Hermes-era message.

A new tab that re-read the database would therefore be blank. Persistence is not optional here.

## Approach

Record the chain server-side in `handleWithHermes`, store one row per turn, and render it on a new
owner-only page that the chat links to with `target="_blank"`.

### Where the data comes from

Both tool-event sources already converge on `publishJobEvent` inside `handleWithHermes`:

1. the in-process MCP bus subscriber (`+server.ts:432-462`) — **full untruncated `args` on `started`,
   full untruncated `result` on `completed`**;
2. Hermes' own `tool` frames for non-bus tools (`+server.ts:702-728`) — pre-capped by the Python
   adapter at 600 chars/value, 25 keys (`~/.hermes-jkai/extensions/jkai_platform/adapter.py:430-450`).

A recorder observes the `JobEvent`s at those two sites. This is the same lifecycle and the same shape
as the existing `turnAttachments` / `turnFileRefs` / `turnWorkflowRefs` accumulators in that function —
precedent followed, not invented.

The recorder adds what the live stream throws away: **server-side timestamps**, so every step gets a
real `durationMs`, and the chain gets a wall-clock span. That is the single most useful column for
"decompose and analyse" and it exists nowhere today.

### Storage

One new table, `jkai_tool_traces`, one row per turn:

- `id` = the `jobId` (already minted at turn start, already held by the client as `currentJobId`)
- `conversationId`, `workflowId`, `messageId` (back-filled after the assistant row is inserted)
- denormalised counters: `stepCount`, `errorCount`, `durationMs`, `model`, `provider`, `costUsd`
- `steps` jsonb — the capped chain

Caps (in `$lib/jkai/tool-trace.ts`, enforced before the write): 300 steps, 4 000 chars per string leaf,
100 array elements, 60 object keys, depth 8, 400 KB total. Over-cap values are replaced by a marked
`{ __truncated__: true, … }` node rather than dropped, so the page can say *what* it is not showing.

### Addressing — why `jobId`, not `messageId`

The DB row id of an assistant message is **never sent to the client during a turn**: the Hermes branch
publishes `done` at `+server.ts:778/796` and inserts the row afterwards at `:840-846`, returning the id
only to server scope. `msg.id` for a live bubble is a client-side `crypto.randomUUID()`
(`ChatArea.svelte:1865`) and is discarded on reload.

`jobId` is available on both sides from the moment the turn starts. So:

- live, on `done` → the result carries `traceId`, the client stamps it on the final message;
- reloaded → `metadata.traceId` on the assistant row.

The trace row is written **before** `done` is published, so the link can never point at a 404.

### The page — `/jkai/trace/[traceId]`

Owner-gated for free by `hooks.server.ts:519-533` (all of `/jkai` is owner-only; layout loads add
nothing but hub metrics).

Shell copied from `/jkai/improvement` + `/jkai/doctor`, which share a byte-identical `.wrap` +
`.page-hdr` + `.kicker` + `.sub`. Tables use the `/jkai` `.tablewrap` + bare `<table>` convention from
`jkai/intel/entities/+page.svelte:529-578` — **not** `.nm-table`, which lives in `admin.css` and is not
loaded under `/jkai`.

Content:

1. **Header** — turn summary: step count, failures, wall-clock span, model, cost.
2. **Chain table** — one row per call: `#`, status, category chip, tool, summary, duration, a bar
   showing when the call sat inside the turn, size of args/result. Sortable by column; a row expands
   in place (the `admin/ops/live` `<td colspan>` idiom) to show prettified args/result.
3. **Table-ification where possible** — a result whose payload is an array of uniform objects renders
   as a real table (columns = union of keys) instead of JSON. This is the "table-ified where possible"
   part of the ask; anything else falls back to `JsonBlock`.
4. **Sub-agent chains** — `delegate_task` steps nest their children's own calls.
5. **Copy / download** the whole trace as JSON.

## Files to touch

| File | Why |
|---|---|
| `src/lib/jkai/tool-trace.ts` | NEW — types, `createTraceRecorder()`, capping. Pure, no DB, no SvelteKit. |
| `src/lib/jkai/tool-trace.test.ts` | NEW — vitest over the recorder: correlation, durations, caps, sub-agents. |
| `src/lib/db/schema.ts` | Add `jkaiToolTraces`. |
| `src/routes/api/workflows/orchestrator/chat/+server.ts` | Instantiate the recorder, observe at the two publish sites, persist before `done`, back-fill `messageId`, stamp `metadata.traceId`. |
| `src/routes/jkai/trace/[traceId]/+page.server.ts` | NEW — load the trace (by trace id, falling back to message id). |
| `src/routes/jkai/trace/[traceId]/+page.svelte` | NEW — the viewer. |
| `src/lib/components/jkai/ChatArea.svelte` | NEW-TAB link beside the existing `details` affordance, live + reloaded. |

**Verification:** `npx vitest run src/lib/jkai/tool-trace.test.ts` → recorder green; `npm run check` → 0
errors; then on homeserv send a real jkai turn that calls ≥2 tools, confirm a `jkai_tool_traces` row,
open `/jkai/trace/<id>` and screenshot; then deploy via CI and re-verify on production.

## Decision Log

| # | Fork | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|---|
| 1 | Where the chain comes from | (a) persist server-side; (b) hand the client's in-memory chain to the new tab via localStorage | **(a)** — explicitly confirmed by John ("go with 1") | (b) only ever works for turns still on screen in the current session, and nothing is linkable. The chain is gone on reload today. | Yes |
| 2 | Storage shape | (a) one row per turn with a jsonb `steps` array; (b) a row per step; (c) reinstate `metadata.toolSteps` on the message | **(a)** | (c) bloats every conversation load — the GET selects `metadata` for every message in the thread. (b) is better for future aggregate queries but is two tables and more code for a page that always reads a whole chain at once. | Yes — (b) can be derived from (a) later |
| 3 | Trace identity | (a) `jobId`; (b) assistant `messageId` | **(a)** | The message id does not exist client-side during a turn and never reaches the browser until the next reload. `jobId` exists on both sides from turn start. `messageId` is stored too, so a lookup by either works. | Yes |
| 4 | When the row is written | (a) once at end of turn; (b) incrementally, debounced, so a mid-turn trace is live | **(a)** | Simpler, one write per turn. Mid-turn the chain is already fully visible inline in the chat — the analysis use case is a finished chain. Written *before* `done` so the link is never dead. | Yes |
| 5 | Truncation | (a) hard byte cap, drop payloads; (b) structure-preserving deep cap with explicit markers | **(b)** | A trace whose point is forensic analysis must say what it is hiding. Markers keep the shape table-ifiable. | Yes |
| 6 | Does the in-chat `details` block change? | (a) leave it, add a link; (b) replace it with the new page | **(a)** | The inline view is right for a glance; the ask was explicitly for an *additional* new-tab view. | Yes |
| 7 | Restore `metadata.toolSteps` for the in-chat disclosure on reload? | (a) yes, as part of this; (b) no, out of scope | **(b)** | Real bug (reloaded threads lose all tool activity, plus build pills and artifacts) but a separate one; folding it in would widen the blast radius of this change. Recorded as a follow-up. | n/a |

## Follow-ups (not in this change)

- Reloaded threads lose `<details class="tool-activity">`, `BuildPill` deep-links, artifacts, and
  `promote_ephemeral_tool` addressing, because `metadata.toolSteps` is dead on the Hermes branch. The
  trace table now holds the data needed to fix that.
- `/admin/ops/tool-usage` has no per-tool error rates because the Hermes SQLite store tag-wraps tool
  results. `jkai_tool_traces.errorCount` + per-step `status` gives Postgres-side error rates.
- `convIdFromUserId` (`hermes-sessions.ts:57-61`) cannot correlate canvas chats (session id has no
  `_chat_` segment); the trace row's `workflowId` covers that gap.
