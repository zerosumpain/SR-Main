# Orchestrator Heartbeat Redesign

**Date:** 2026-04-27
**Status:** Draft (awaiting user review)
**Owner:** John

## Problem

The current orchestrator heartbeat does one thing — emit a cosmetic "still thinking" line after 25 seconds of silence. In practice this leaves three real problems unsolved:

1. **The heartbeat is invisible most of the time.** During active streaming or tool execution there is no UI cue at all that the orchestrator is healthy, what step it is on, or what the watchdog timers look like.
2. **The orchestrator stalls on long-running tasks and needs manual nudging.** When the LLM returns a text-only response mid-plan, the round loop in `general-chat.ts` (line 838) breaks out and the user has to type "continue" to keep work moving.
3. **Idle time is wasted.** When no job is running, nothing happens. The system could be running self health checks, summarising audit logs, reviewing workflow efficiency, scanning recent chat logs, and surfacing memory-update candidates — but does not.

## Goals

- Make orchestrator state continuously **visible** in the /jkai chat UI, not only during silence.
- Make the labels meaningful: "Waiting on tool: stealth-scrape (48s)" beats "Still thinking…".
- Have the orchestrator **drive itself forward** through multi-step work without manual nudges, while keeping watchdog safety intact.
- Put the orchestrator's idle time to work running scheduled background tasks, with results surfaced in the UI.

## Non-Goals

- Replacing the watchdog. Watchdog timers (180s idle, 600s hard) stay exactly as they are. Heartbeat and self-prod must not mask a real hang.
- Touching workflow-canvas chat or `/jkai/builds`. Phase 1 ships in `/jkai` only.
- Persistent self-prod history. Self-prod state lives in-memory on the job.
- A new "system" conversation. Idle scheduler results go into a dedicated `pulse_events` feed, not the user-visible orchestrator chat history.
- A from-scratch rewrite of `memory-review.ts`. We extend it; we do not replace it.

## Current State Summary

Relevant existing code:

- **`src/lib/workflows/chat/job-store.ts`** — owns `OrchestratorJob`, `startWatchdog`, `startHeartbeat`, the SSE event bus (`publishJobEvent` / `subscribeJob`), and the waiter map (`createWaiter` / `respondToWaiter`).
- **`src/lib/workflows/chat/general-chat.ts`** — the orchestrator main loop. Terminates on no-tool-calls (line 838), plan rejection (line 821), or `MAX_TOOL_ROUNDS` (line 881).
- **`src/lib/workflows/chat/followup-queue.ts`** — per-task background completion tracker. Patterns reused (interval worker, SSE delivery, model resolution) but it is task-scoped and does not become the idle scheduler.
- **`src/lib/workflows/chat/memory-review.ts`** — already runs every 30 minutes, scanning idle conversations and writing to `jkai_memories`. Extended, not replaced.
- **`src/lib/components/jkai/ChatArea.svelte`** — current consumer; renders `heartbeat = { summary, elapsedSec }` only when set, hides on every other event type.
- **`workflow_audit_log`** + **`node_executions`** tables — real source for audit-log digest and workflow-efficiency reviews.

## Architecture Overview

The redesign keeps the umbrella name "heartbeat" but splits it into four named subsystems. There is **no central status aggregator service** — phase derivation lives next to the job (small helper in `job-store.ts`), the pill recomputes phase from the SSE event stream it already subscribes to, and the idle cycler runs on its own.

```
                                  ┌──── consumes per-job SSE (existing channel) ────┐
                                  │                                                  │
┌────────────────────┐    ┌───────┴──────────────────┐   ┌────────────────────────┐
│  Heartbeat Pill    │    │  Self-Prod (Drive Loop)  │   │  Idle Cycler            │
│  (UI, /jkai)       │    │  (job-store + main loop) │   │  (system-level)         │
│                    │    │                          │   │                          │
│  Always visible.   │    │  When LLM ends a round   │   │  When no job running    │
│  Shows phase,      │    │  with text-only mid-     │   │  for >5 min, runs:      │
│  current step,     │    │  plan, injects a         │   │  - health checks        │
│  elapsed, watchdog │    │  synthetic continue.     │   │  - audit-log digest     │
│  countdown. Click  │    │  Cap: 2 prods/job.       │   │  - workflow efficiency  │
│  to expand event   │    │                          │   │  - chat-log review +    │
│  timeline +        │    │                          │   │    memory-update review │
│  background feed.  │    │                          │   │                          │
└─────────┬──────────┘    └──────────────────────────┘   └────────────┬────────────┘
          │                                                            │
          └──────── consumes /api/jkai/pulse SSE (new channel) ────────┘
```

Component A and B both speak through the **existing** per-job SSE channel (`publishJobEvent`). Component C uses a **new** `/api/jkai/pulse` SSE channel for system-level events that are not tied to any single job. The pill subscribes to both: the per-job stream when a job is active, and the pulse stream always.

## Component A — Heartbeat Pill (always-visible status surface)

**Phase:** the typed state of the orchestrator. Computed from the active `OrchestratorJob`:

| Phase           | Trigger                                                        | Pill colour |
|-----------------|----------------------------------------------------------------|-------------|
| `idle`          | No running job for this conversation                           | grey        |
| `thinking`      | LLM call open, no tokens yet, no tool running                  | blue        |
| `streaming`     | `token` events flowing within the last 2s                      | green       |
| `tool`          | A `tool_start` outstanding (no matching `tool_result` yet)     | amber       |
| `awaiting_user` | A waiter is open (plan / clarify / confirm)                    | violet      |
| `stalled`       | `lastEventAt` older than 25s and not `awaiting_user`           | red         |

Phase is **derived**, not stored. Computed on demand from existing `OrchestratorJob` fields plus a new `inflightTool: { name, since } | null` slot updated alongside `tool_start` / `tool_result` publishing.

**Pill content:** phase label, current step (already in `job.currentStep`), seconds since last meaningful event, and a compact countdown to watchdog idle-kill (`max(0, IDLE_TIMEOUT_MS - sinceLastEvent)`).

**Click expansion:** opens a popover with:
- Phase + reason ("Waiting on tool: stealth-scrape since 48s")
- Watchdog status (idle 24s/180s, total 6m/10m)
- Plan progress, if a plan is approved (step X of Y, with the active step bolded)
- Last 20 published events (compact list — type + summary + relative time)
- Recent `pulse_events` (idle-scheduler output, last 5)

**Transport:** the existing per-job SSE stream (`/api/jkai/orchestrator/[jobId]/events`) is the source of truth. The pill subscribes to it and recomputes phase locally from the event stream. No new endpoint, no extra polling — the only new field on the wire is `inflightTool` updates, which slot into the existing `tool_start` / `tool_result` events.

**Heartbeat event shape** (replaces today's `{ summary, elapsedMs }`):

```ts
{
  type: 'heartbeat',
  phase: 'thinking' | 'tool' | 'awaiting_user' | 'stalled',
  currentStep: string | null,
  inflightTool: { name: string; sinceMs: number } | null,
  awaitingWaiter: { kind: 'plan' | 'clarify' | 'confirm'; sinceMs: number } | null,
  elapsedMs: number,           // job-elapsed
  sinceLastEventMs: number,    // for stall detection in UI
  watchdog: { idleMs: number; idleLimitMs: number; totalMs: number; totalLimitMs: number },
}
```

The 5s tick / 25s silence threshold from the current implementation are **kept** — only the payload gets richer. Pill still only re-renders when the heartbeat event arrives or any other job event flows; no client-side timer.

## Component B — Self-Prod (Drive Loop)

**Where it hooks in:** the round-end path in `general-chat.ts` line 838 (`if (!msg.tool_calls || msg.tool_calls.length === 0)`).

**What it does:** instead of unconditionally `break`-ing out and returning `responseText`, it consults a new `shouldSelfProd(job, messages, plan)` decision. If the answer is yes, it pushes a synthetic `user` message ("Continue with the next step…") onto `messages`, increments `job.selfProdCount`, and continues the for-loop. If no, it breaks normally.

**Decision rule** (all must hold):

1. There is an **approved plan** on the job (`job.plan` populated by `plan-phase.ts`) with at least one step not yet marked covered. **Coverage tracking** is best-effort: a step is marked covered when (a) the LLM's `currentStep` was set to that step's id/title via `onProgress`, OR (b) a tool result message contained the step's id or first 30 chars of the title (case-insensitive substring match). String matching is acknowledged as imperfect; the `selfProdCount < 2` cap is the real safety net.
2. `job.selfProdCount < 2` (cap; further stalls fall to the watchdog).
3. The LLM's text response is **not** a question to the user. Heuristic: the **final non-empty line** ends in `?`, OR the message contains any of "should I" / "would you like" / "do you want" / "let me know" / "shall I" — those are genuine pauses awaiting user direction.
4. No waiter is currently open (`!waitersFor(jobId).size`).

If any of these is false, end the round normally. The cap and the question-detector keep this conservative — better to under-prod than to gaslight the model into ignoring genuine stops.

**Synthetic prod content** templates:

- **Plan-aware (default):**
  > The plan still has uncovered steps: <step titles>. Continue with the next step now. If a step is genuinely blocked or no longer applicable, say so and stop; otherwise proceed.

- **Plan-aware, second prod (only fires after first prod failed to advance):**
  > You paused again without finishing. List which step is blocking you, what is needed to unblock it, and either continue or stop with a clear reason.

**State tracking on `OrchestratorJob`:**

```ts
selfProdCount: number;          // 0..2
lastSelfProdAt: number | null;  // for diagnostics
plan: PlanPayload | null;       // already populated post-approval
coveredStepIds: Set<string>;    // updated when a tool result mentions a step id
```

**Out of scope for self-prod:** stalls *during* streaming or tool execution. Those stay watchdog territory — you cannot prod a hung HTTP call by injecting messages.

**Telemetry:** every prod publishes a `self_prod` event on the SSE stream so the pill can render a small "auto-continued" badge (transparency).

## Component C — Idle Cycler (system-level scheduler)

**Module:** new `src/lib/workflows/chat/idle-cycler.ts`.

**When it runs:** the cycler holds a single `setInterval` (60s tick) that is started at app boot via `src/hooks.server.ts`. On each tick:

1. Check `jobs.size` running. If any is running, exit.
2. Check `Date.now() - lastJobCompletedAt < IDLE_QUIET_MS` (default 5 min). If too soon after the last job, exit. (Avoids running heavy AI tasks when the user has just stopped chatting.)
3. Otherwise iterate over scheduled jobs whose `nextRunAt <= now` and run them sequentially (one at a time, never overlapping, immediate-bail if a real job arrives).

**Scheduled jobs (initial set, all configurable via `pulse_settings` table):**

| Kind                    | Cadence | Description                                                                                          | Output severity range |
|-------------------------|---------|------------------------------------------------------------------------------------------------------|-----------------------|
| `health_check`          | 10 min  | Pings: openclaw gateway (`/health`), DB `SELECT 1`, gmail watcher cursor age, scraper sandbox alive  | info / warn / error   |
| `audit_digest`          | 4 hours | Reads last 4h of `workflow_audit_log` + `node_executions`; LLM-summarises anomalies                  | info / warn           |
| `workflow_efficiency`   | 24 hours| Reads last 24h `node_executions`; flags slow nodes (p95 latency outliers), retry-prone nodes         | info / warn           |
| `chat_log_review`       | 6 hours | Scans messages since last review for recurring user feedback / friction patterns                     | info                  |
| `memory_update_review`  | 24 hours| Re-runs `memory-review.ts` extraction across stale conversations + flags potentially-outdated rows   | info / warn           |

Each entry is a function `(ctx) => Promise<PulseEvent[]>`. The cycler calls it, gets a list of events, persists each to `pulse_events`, and broadcasts via SSE so the /jkai pill can show new items.

**Why each cadence:** the AI-powered ones (`audit_digest`, `chat_log_review`, `memory_update_review`) cost real tokens, so they are deliberately spaced out. `health_check` is cheap so it fires often. None of these block on each other.

**LLM model:** existing `resolveDefaultModel('chat')` pattern from `followup-queue.ts`, but the cycler can override with a lightweight model (e.g. flash-tier) for digests. These calls run with no `conversationId`, so `recordConversationUsage` is skipped — the spend lands in admin model-usage telemetry but does not pollute any user conversation's cost view.

**Critical safety:** the cycler refuses to start if `process.env.PULSE_DISABLED === '1'`. This is the deploy/maintenance kill switch. It also refuses to start if `process.env.NODE_ENV === 'test'`.

**Important:** idle work writes to `pulse_events` and the system Slack-style feed in /jkai sidebar — it does **not** insert into `orchestrator_chats` and does not push to `notifySubscribers`. The user sees results when they look at the feed, not as messages in their chat history.

## Component D — Distinguished Silence Reasons

This is largely a UI consequence of Component A. The pill renders distinct labels for the four silence types:

- **Thinking** — LLM call is out, no tokens yet (cold-start of an LLM round)
- **Tool: <name> (Ns)** — a tool started Ns ago and has not returned
- **Awaiting your <plan|clarify|confirm>** — a waiter is open, the orchestrator is paused for user input
- **Stalled** — `lastEventAt` ≥ 25s old and none of the above

The information is already present in the `OrchestratorJob` and waiter map; Component A's job is to surface it; Component D is the wording/visual contract.

## Data Model

New table: `pulse_events`.

```sql
CREATE TABLE pulse_events (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  kind        text NOT NULL,             -- 'health_check' | 'audit_digest' | ...
  severity    text NOT NULL,             -- 'info' | 'warn' | 'error'
  summary     text NOT NULL,             -- one-line headline for the feed
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  at          timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz            -- set when user dismisses from feed
);
CREATE INDEX pulse_events_at_idx ON pulse_events (at DESC);
```

Retention: a sweep inside the cycler deletes rows older than 30 days on each tick (cheap; small table).

New table: `pulse_settings` (singleton row).

```sql
CREATE TABLE pulse_settings (
  id              text PRIMARY KEY DEFAULT 'singleton',
  schedules       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { health_check: { intervalMs, enabled }, ... }
  idle_quiet_ms   integer NOT NULL DEFAULT 300000,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (id = 'singleton')
);
```

The cycler reads the row on each tick (cached for 60s). UI control comes later — initial release ships with hardcoded defaults seeded into the row.

No schema change to `OrchestratorJob` (it's in-memory). New in-memory fields: `selfProdCount`, `lastSelfProdAt`, `plan`, `coveredStepIds`, `inflightTool`.

## Data Flow

**Active job:**

```
client opens /jkai chat
  → POST /api/jkai/orchestrator → createJob() → publishJobEvent('thinking phase')
  → ChatArea subscribes to SSE → renders pill in `thinking` phase
  → general-chat starts streaming → 'token' events → pill flips to `streaming`
  → tool_start published with inflightTool → pill flips to `tool: <name>`
  → tool_result clears inflightTool → pill back to `thinking` or `streaming`
  → LLM returns no tool_calls + plan has uncovered steps → self-prod fires
    → publishJobEvent('self_prod') → pill shows "auto-continued"
    → loop continues, more rounds happen
  → final response → publishJobEvent('done') → pill flips to `idle`
```

**Idle cycler:**

```
60s tick → no jobs running, idleQuiet satisfied
  → run due scheduled jobs sequentially
  → each job returns PulseEvent[]
  → INSERT INTO pulse_events
  → broadcast on a /api/jkai/pulse SSE channel
  → /jkai sidebar feed re-renders new entries
```

## Error Handling

- **Self-prod injection failure:** if the round after a self-prod also returns text-only with the same uncovered steps, the second prod fires (cap = 2). Beyond that, end the loop normally and let the user see the response.
- **Idle cycler exception:** the cycler wraps each scheduled job in try/catch. A failure inserts a `pulse_events` row with `severity='error'` and the error message; the cycler keeps running.
- **Pulse SSE channel disconnects:** the feed reconnects with the standard EventSource `onerror` retry. Backed by the table — re-queries last 50 entries on reconnect.
- **Watchdog still wins:** every termination path in `job-store.ts` already clears the heartbeat interval. New `selfProdCount` lives on the job and is collected with it. Self-prod cannot survive a cancellation.
- **`PULSE_DISABLED=1`:** suppresses the cycler entirely. Existing per-job heartbeat unaffected — that is core safety, not an opt-in feature.

## Testing Plan

**Unit tests (Vitest):**

- `job-store.test.ts` — extend existing tests:
  - `phase` derivation: `thinking` → `streaming` → `tool` → `streaming` → `done`
  - heartbeat payload shape under each phase
  - `selfProdCount` increments correctly, capped at 2
  - watchdog still kills jobs even when self-prod is firing (the critical safety regression test)
- `self-prod.test.ts` — new:
  - prod fires when plan has uncovered steps and reply is non-question
  - prod does **not** fire when reply is a question
  - prod does **not** fire when no plan is present
  - second prod uses the harsher template
  - third prod attempt is suppressed
- `idle-cycler.test.ts` — new:
  - cycler does not run while a job is active
  - cycler honours `idleQuietMs`
  - scheduled jobs run on cadence, results land in `pulse_events`
  - `PULSE_DISABLED=1` halts the cycler
  - exception in one scheduled job does not stop others

**Integration tests:**

- A full /jkai round-trip with a multi-step plan that triggers a self-prod, asserting the synthetic message lands in `messages` and a `self_prod` event reaches the SSE consumer.
- A 6-minute stall test (mocked clock) confirming the watchdog still kills the job at 180s idle even with heartbeats firing every 25s.

**Manual UI verification:**

- Phase transitions visible on the pill across a real chat
- Click-to-expand panel renders timers and event history
- Idle-cycler entries appear in the sidebar feed within 60s of generating one

## Rollout

Single PR, feature-flagged at module load via `PULSE_ENABLED=1` (default off in production until verified). Inside the flag:

1. New event payload shape — backwards-compatible since the consumer is updated in the same PR.
2. Self-prod off-by-default behind `SELF_PROD_ENABLED=1` for the first week even when `PULSE_ENABLED=1`.
3. Idle cycler off-by-default behind `PULSE_CYCLER_ENABLED=1` for the first week.

This three-tier flag set lets us ship the visible Pill first (immediate UX win), turn on self-prod after observing it for a few days, and turn on idle cycler last (most novel behaviour).

## Assumptions (challenge any of these)

1. **Phase 1 is /jkai only.** Workflow canvas chat and `/jkai/builds` get the same treatment in a follow-up.
2. **Self-prod cap = 2.** Conservative; we can raise it once we have data.
3. **Idle quiet window = 5 minutes.** Avoids running token-spending tasks the moment a chat ends.
4. **Idle cycler runs on `homeserv` only.** Same logic as the scraper — runs in the long-lived homeserv process, not on the VPS where SvelteKit is per-request. (If SvelteKit on VPS is the long-lived process for /jkai, this assumption is wrong and the cycler runs there instead. Verify before implementation.)
5. **Pulse events are not sensitive.** Stored unencrypted. Audit-digest summaries may include workflow names but not credentials.
6. **No user-facing settings UI for cycler cadence in v1.** Hardcoded defaults seeded; admin can edit `pulse_settings` row directly via pgweb if needed.
7. **`memory-review.ts` extension is additive.** The existing 30-min interval keeps running; idle cycler only adds a stale-flagging pass on top.
8. **Self-prod synthetic messages stay in-memory only.** They are pushed onto the orchestrator's `messages` array (so the LLM sees them in this round) but are **not** persisted to `orchestrator_chats`. Persisting would pollute future conversation-history reconstruction with fake user messages. Self-prod telemetry is via the `self_prod` SSE event, not via stored chat rows.

## Out of Scope (deliberate)

- Pulse pill on workflow canvas / builds / WhatsApp.
- A user-facing settings page for cycler cadence.
- Cross-conversation memory analytics ("which topics is the user asking about most?"). That's a separate analytics feature.
- Auto-deletion of stale memories. We only flag for review.
- Replacing followup-queue.ts. Distinct concern.

---

## Two-week review (2026-05-11)

> **How to fill this in:** run `scripts/pulse-review.mjs` on the VPS, then paste findings into each subsection.
>
> ```
> ssh johnk@157.180.19.38 \
>   'cd /opt/strange-rambling-svelte && set -a && . ./.env && set +a && node scripts/pulse-review.mjs'
> ```

### Implementation delta vs spec

The shipped implementation diverged from the spec in a few important ways.
Acknowledge these when reading the script output:

| Spec concept | What shipped |
|---|---|
| `pulse_events` table | `heartbeat_pulses` table (joined with `heartbeat_actions`) |
| `pulse_settings` singleton | Per-row `cadence_seconds` + `status` on `heartbeat_actions` |
| `health_check` (10 min) | **Not shipped** — no DB-ping or gmail-cursor-age check |
| `audit_digest` (4 h) | `workflow-review` (30 min) — reviews individual workflow runs, not a digest |
| `workflow_efficiency` (24 h) | **Not shipped** — p95 latency / error-rate query not implemented |
| `chat_log_review` (6 h) | `chat-continuation` (1 min) — live conversation auto-resume (wider scope) |
| `memory_update_review` (24 h) | **Not shipped** — no stale-memory flagging activity |
| `self_prod` inline in `general-chat.ts` | `chat-continuation` heartbeat activity (runs independently) |
| Cap: 2 self-prods / job | Cap: 6 LLM continuations / conversation / day |
| `self_prod` SSE event | `orchestrator_chats` rows with `metadata.heartbeat.activity = 'chat-continuation'` |

The unshipped items (`health_check`, `workflow_efficiency`, `memory_update_review`) are noted in the cadence proposals below as candidates for a follow-up sprint.

---

### Volume / cadence findings

> _To be filled in by John after running `scripts/pulse-review.mjs` — see §2 and §3 of output._

Questions to answer:
- How many total pulses in 14 days? Does it look proportionate to each cadence?
- Any action showing a much higher inter-arrival than configured (engine contention, active-hours window narrower than expected)?
- Are there long gaps (e.g. > 2× configured cadence) that suggest the engine stalled?

**Draft suggestion (not data-driven):** `chat-continuation` at 60 s will dominate volume — expect thousands of ticks. Most should be `ok` (no paused conversations). If the ratio of `fired` to `ok+skipped` is below 1 %, consider raising the cadence to 5 min to reduce DB query pressure. `workflow-review` at 30 min should produce one `fired` row per distinct completed workflow run in any rolling 24 h window; if you rarely run workflows, expect mostly `ok`.

---

### Noise vs signal — which activities had the most low-value rows

> _To be filled in after running the script — see §12 of output._

Questions to answer:
- Which activity has the worst signal% (fired / total)?
- Did `conversation-checkin` fire on real long-running jobs or mostly hit "no long-running jobs"?
- Did `build-progress-check` fire at all? (Only fires when builds are both running and stale.)

**Draft suggestion (not data-driven):** `build-progress-check` and `conversation-checkin` are expected to be near-silent in a low-activity week (both require a job/build to already be running). If signal% for these is 0 or close to 0, they are not causing harm but their ticks are pure noise in the audit log. Consider a 10–15 min cadence instead of 5 min.

---

### chat-continuation effectiveness (spec's "self-prod outcomes")

> _To be filled in after running the script — see §5 of output._

Questions to answer:
- What fraction of fired pulses were `auto-continue` vs `soft-checkin` vs `nudge` vs `cap-nudge`?
- How many distinct conversations were touched? Does that feel right given your usage patterns?
- Did any conversation hit the 6/day LLM cap? If so, did those conversations actually need that many continuations, or was the activity firing spuriously?
- Looking at a few `auto-continue` or `soft-checkin` replies in the chat UI — did the LLM actually make progress, or did it produce hollow "I'll continue…" non-answers?
- The `benign` classifier triggers on phrases like "should I continue / shall I proceed" — are false positives common?

**Draft suggestion (not data-driven):** The 6/day LLM cap is a safety rail, not a target. If several conversations are routinely hitting it, the classifier may be too aggressive at treating pauses as benign. Consider tightening the `BENIGN_CONTINUATION_PATTERNS` list or reducing `maxLlmContinuationsPer24h` to 3 until the false-positive rate is understood. The `maxStaleMinutes = 25` window (default) means the activity catches conversations the user walked away from mid-session; if most auto-continues are on conversations the user already considered done, the window is too wide.

---

### memory_update_review accuracy

> _This activity was not shipped. Filling in from the direct `jkai_memories` snapshot instead — see §11 of output._

Questions to answer:
- Are there memories that are 30+ days old and still marked `active` (`superseded_by IS NULL`)?
- Do any look factually outdated given what you know now?
- Is the total memory count growing, shrinking, or stable?

**Draft suggestion (not data-driven):** The `memory_update_review` activity from the spec was the most clearly missing piece. A minimal version (query `jkai_memories` for rows where `updated_at < NOW() - 60 days` and ask the LLM to flag suspicious ones) could be added as a new handler in `src/lib/heartbeat/activities/` in a small follow-up. Cadence suggestion: once per day, active hours only.

---

### Cadence proposals

> _Fill in the "Data" column after running the script. Override draft suggestions with what you actually see._

| Activity | Current cadence | Draft suggestion (not data-driven) | Data | Decision |
|---|---|---|---|---|
| `chat-continuation` | 60 s | If signal% < 1 %: raise to 5 min. If cap-nudge > 10 % of fired: reduce LLM cap to 3/day. Otherwise keep. | | |
| `conversation-checkin` | 5 min | Raise to 10 min if signal% < 5 % — this only fires during long jobs and the extra frequency adds no value. | | |
| `build-progress-check` | 5 min | Raise to 15 min. Builds are rare; per-build cooldown (10 min) already rate-limits nudges anyway. | | |
| `workflow-review` | 30 min | Reasonable. If you run < 2 workflows/day, raise to 1 h to reduce "no unreviewed runs" ok rows. | | |
| `health_check` | not shipped | Add at 10 min. Even a simple `SELECT 1` + gmail cursor age check would catch DB/auth issues early. | | |
| `memory_update_review` | not shipped | Add at 24 h (active hours). Low cost; high value for long-running personal AI. | | |
| `workflow_efficiency` | not shipped | Lower priority. Add only after `workflow-review` has accumulated enough reviewed runs to notice patterns. | | |
