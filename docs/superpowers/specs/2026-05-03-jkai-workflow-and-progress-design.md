# JKAI Builder ↔ Workflows + Build Progress Pill — Design

**Date:** 2026-05-03
**Status:** Approved (user said "go")

## Problem

Two adjacent gaps in the autonomous builder:

1. **Workflows are siloed from builds.** The builder LLM can already see most workflow site-tools (via the existing pi tool-bridge — `workflow_list`, `workflow_run`, `workflow_create`, `workflow_get_run` all exist), but: runs are fire-and-forget so the builder can't wait on a result; finished runs don't push results back into a build; no way to mark "primary" workflows for a build; no way for the user to manually trigger a workflow from the build UI in a way that lands in the build's context.
2. **Builds run for ~20 min with no thread-side feedback.** When a build is kicked off from a `/jkai` conversation, the only feedback is the initial assistant message. The user has to navigate to `/jkai/builds/<id>` to see progress.

## In scope

All five workflow capabilities the user picked (consume past runs, await-trigger existing, author new, push-back from completed runs, manual trigger from UI) plus the chat-side build progress pill. Hybrid workflow discovery (all visible, primary set gets prominent grounding). Single build per conversation. Persistent pill that re-attaches on conversation reload.

## Architecture

Three layers stacked on the existing build orchestrator + workflow engine:

### Layer 1 — Builder ↔ workflow tooling (capabilities i, ii, iii, v)

- **Reuse existing site-tools.** The pi tool-bridge already exposes `workflow_*` tools to the builder. No new pi extension needed.
- **Add `awaitMs` parameter to `workflow_run`.** When set (e.g. `awaitMs: 300_000`), the tool polls `workflowRuns.status` until it's `completed`/`failed`/`cancelled` or the timeout elapses, then returns the run + `nodeExecutions` payload (same shape as `workflow_get_run`). Default: fire-and-forget (back-compat).
- **Attached workflows on builds.** New column `jkai_builds.attached_workflow_ids text[] not null default '{}'`. At kickoff (chat or `/jkai/builds/new`), user can pick a primary set; builder system prompt gets a "Primary workflows" grounding block listing each attached workflow's name, description, trigger node type, and input schema. Non-attached workflows remain discoverable via `workflow_list`.
- **Capability v (manual trigger from build UI).** Build sidebar gets a "Workflows" panel listing attached workflows; per-row "Run now" button POSTs to a new `/api/jkai/builds/[id]/run-workflow` endpoint that triggers the workflow and queues a `pending_workflow_deliveries` row pointed at this build (so the result lands in the next iteration's prompt — same delivery path as capability iv).

### Layer 2 — Push-back delivery (capability iv)

- **New table `build_workflow_subscriptions(build_id, workflow_id, created_at)`.** Composite PK on (build_id, workflow_id).
- **New tools `workflow_subscribe(buildId, workflowId)` / `workflow_unsubscribe(buildId, workflowId)`.** The builder LLM calls these mid-iteration; user can also seed subscriptions from the build sidebar.
- **Delivery queue: new table `pending_workflow_deliveries(id, build_id, workflow_id, run_id, output, created_at, consumed_at)`.**
- **Listener: `src/lib/jkai/workflow-deliveries.ts` registers an `events.on('workflow_completed', ...)` handler at orchestrator startup.** When a run completes, look up subscriptions, write a delivery row per subscribed build. Manual UI trigger (capability v) writes deliveries directly without going through subscriptions.
- **Iteration prompt injection.** `executor.ts` fetches unconsumed deliveries before each iteration; if any, prepends a "📨 Workflow results since last iteration" block to the user prompt and marks them consumed in the same transaction. Cap to last 10 deliveries to keep prompts bounded.

### Layer 3 — Build progress pill in chat

- **`jkai_builds.conversation_id text references jkai_conversations(id) on delete set null`.** Plumbed at kickoff.
- **Stage events.** Orchestrator emits a structured `stage` log via `emitLog(buildId, 'stage', JSON.stringify({stage, iteration?, total?, previewUrl?}))`. New stages: `planning`, `awaiting_plan_approval`, `iterating`, `running_tests`, `promoting`, `completed`, `failed`, `paused`. The pill consumes these. Preview availability flips when `checkServeConfig` confirms the project server is healthy on `<port>` — emits `stage` with `previewUrl: "http://homeserv:<port>"`.
- **`<BuildPill />` component (`src/lib/components/jkai/BuildPill.svelte`).** Opens an EventSource on `/api/jkai/builds/[id]/stream`, derives stage label + preview URL from the latest `stage` event (or falls back to recent log heuristics). Two display variants:
  - **`variant="inline"`** — rendered as a special chat message at kickoff time; persists in conversation history; transitions to a final-state chip on completion ("✓ Build completed in 23m — open preview" with link).
  - **`variant="sticky"`** — fixed banner above the composer, only mounted while build status is `running`/`paused`/`awaiting_plan_approval`/`awaiting_iter_approval`. Auto-collapses (unmounts) on terminal status; the inline message's final state is the durable record.
- **Reattach on load.** `/api/jkai/conversations/[id]/+server.ts` (the conversation-detail endpoint already exists) returns an `activeBuild` field — the most recent `jkaiBuilds` row for this conversation that's not in a terminal status — alongside the existing payload. Chat page mounts the sticky pill when `activeBuild` is non-null.
- **conversationId at kickoff.** Chat composer's build-create flow passes `conversationId` in the POST body to `/api/jkai/builds`. The `build_create` site-tool likewise reads `ctx.conversationId` (already in tool ctx) and forwards it.

## Data model changes

```sql
-- 1. Conversation linkage
ALTER TABLE jkai_builds
  ADD COLUMN conversation_id text REFERENCES jkai_conversations(id) ON DELETE SET NULL;
CREATE INDEX jkai_builds_conversation_id_idx ON jkai_builds(conversation_id);

-- 2. Attached primary workflows
ALTER TABLE jkai_builds
  ADD COLUMN attached_workflow_ids text[] NOT NULL DEFAULT '{}';

-- 3. Subscriptions (push-back routing)
CREATE TABLE build_workflow_subscriptions (
  build_id text NOT NULL REFERENCES jkai_builds(id) ON DELETE CASCADE,
  workflow_id text NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (build_id, workflow_id)
);

-- 4. Delivery queue
CREATE TABLE pending_workflow_deliveries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  build_id text NOT NULL REFERENCES jkai_builds(id) ON DELETE CASCADE,
  workflow_id text NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  output jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);
CREATE INDEX pending_workflow_deliveries_unconsumed_idx
  ON pending_workflow_deliveries(build_id) WHERE consumed_at IS NULL;
```

## API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/jkai/builds` (existing) | Accepts new `conversationId`, `attachedWorkflowIds` body fields |
| POST | `/api/jkai/builds/[id]/run-workflow` | Manual trigger from build UI; body `{ workflowId, input? }`; queues delivery on completion |
| POST | `/api/jkai/builds/[id]/subscribe-workflow` | Body `{ workflowId }` (manual seed) |
| DELETE | `/api/jkai/builds/[id]/subscribe-workflow` | Body `{ workflowId }` |
| GET | `/api/jkai/conversations/[id]` (existing) | Returns extra `activeBuild` field |

New tools registered in the `workflows` site-toolset:
- `workflow_subscribe({ buildId, workflowId })`
- `workflow_unsubscribe({ buildId, workflowId })`
- `workflow_run` (existing) gains `awaitMs?: number` parameter

## File touch list

**Schema / DB**
- `src/lib/db/schema.ts` — three additions

**Builder server-side**
- `src/lib/jkai/orchestrator.ts` — emit structured `stage` events at every state transition
- `src/lib/jkai/executor.ts` — inject pending deliveries + attached-workflow grounding into prompt
- `src/lib/jkai/prompt.ts` — `buildAttachedWorkflowGrounding(workflowIds)` helper
- `src/lib/jkai/workflow-deliveries.ts` (new) — listener + queue helpers
- `src/lib/jkai/index.ts` (or whichever boots orchestrator) — register listener at startup

**Workflow site-tools**
- `src/lib/workflows/site-tools/tools/workflows.ts` — `awaitMs` on `workflow_run`, new `workflow_subscribe` / `workflow_unsubscribe`

**API**
- `src/routes/api/jkai/builds/+server.ts` — accept new body fields
- `src/routes/api/jkai/builds/[id]/run-workflow/+server.ts` (new)
- `src/routes/api/jkai/builds/[id]/subscribe-workflow/+server.ts` (new)
- `src/routes/api/jkai/conversations/[id]/+server.ts` — include `activeBuild`

**Chat UI**
- `src/lib/components/jkai/BuildPill.svelte` (new)
- `src/lib/components/jkai/ChatArea.svelte` — render inline pill messages + mount sticky pill
- `src/routes/jkai/+page.svelte` — pass `activeBuild` from page data to ChatArea

**Build UI**
- `src/lib/components/jkai/builds/AttachedWorkflowsPanel.svelte` (new)
- `src/routes/jkai/builds/[id]/+page.svelte` — mount the panel
- `src/routes/jkai/builds/new/+page.svelte` — multi-select for attached workflows at create time

## Stage event payload

Type: `stage` log entry, content is JSON-encoded:

```ts
type StageEvent = {
  stage: 'planning' | 'awaiting_plan_approval' | 'iterating' | 'running_tests'
       | 'promoting' | 'awaiting_iter_approval' | 'paused' | 'completed' | 'failed';
  iteration?: number;       // current iteration number when stage = iterating | running_tests | awaiting_iter_approval
  totalEstimate?: number;   // milestone count when known
  previewUrl?: string | null; // populated when project server health-check passes
  failureKind?: string;
  message?: string;
};
```

The pill picks the most recent `stage` event from the SSE stream and renders accordingly.

## Pill display rules

- **Stage label** — derived from latest stage event:
  - `planning` → "Planning"
  - `awaiting_plan_approval` → "Plan ready — awaiting approval"
  - `iterating` → "Iteration N" (with milestone-progress sub-label if available)
  - `running_tests` → "Iteration N — running tests"
  - `promoting` → "Promoting"
  - `awaiting_iter_approval` → "Iteration N complete — awaiting approval"
  - `paused` → "Paused"
  - `completed` → "✓ Completed in {duration}"
  - `failed` → "× Failed: {failureKind}"
- **Preview link** — shown only when latest stage event has a non-null `previewUrl`.
- **Build link** — sticky banner has secondary "Open build" link to `/jkai/builds/<id>`. Inline message kickoff text is itself a link.

## Out of scope (explicitly)

- Multiple concurrent builds per conversation.
- Migrating existing builds to retroactively gain `conversationId` linkage.
- Per-conversation workflow allowlists separate from per-build attachments.
- Authoring workflow drafts that aren't persisted (we go straight to real workflow rows; the spec calls for the user to be able to keep them — `workflow_create` already does this).

## Test strategy

- Unit: stage-event derivation, delivery queue (subscribe → emit run-completed → row appears → executor consumes → marks consumed), `awaitMs` polling timeout.
- Integration: `npm run check` + manual smoke (kick off a build from chat, verify pill appears + reattaches after reload, attach a workflow, manually trigger from build UI, verify result lands in next iteration's prompt).
- No production deploy until user reviews the breakdown.

## Risk

- **Heavy delivery payloads.** Workflow outputs can be large; cap injected prompt deliveries to first 4 KB per delivery, and store the full payload only in the delivery row (LLM can call `workflow_get_run` for full detail).
- **Subscription leak.** If a build hits a terminal status, deliveries stop being consumed. Mitigation: in the listener, skip writing deliveries for builds whose status is `completed`/`failed`/`paused` (subscriptions stay; resume on resume).
- **`awaitMs` blocking the iteration past pi's wall-clock cap.** `workflow_run` polls inside the pi tool call, which counts against the iteration deadline. Cap `awaitMs` server-side to 10 minutes and document that long workflows should run unawaited + subscribe.
