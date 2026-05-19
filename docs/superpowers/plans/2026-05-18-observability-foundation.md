# Observability foundation — plan

**Date:** 2026-05-18
**Status:** Draft (awaiting user review)
**Scope:** Sub-project 1 of a 5-part observability initiative. This spec covers the *foundation* layer only — schema columns for LLM cost/tokens, central capture via the LLM gateway, and an SSE stream for live telemetry. UI features that consume this data (cost charts, Inspector history, Run Timeline, Error Explorer) ship in later sub-projects.

## 1. Goal

Make per-execution LLM cost/token data available, and replace the manual `⟳` refresh on the four canvas observability nodes (Inspector, Stats · Summary, Stats · Trends, Stats · Per-node) with a live SSE stream. **No new UI features** — same charts, same data, just populated + live.

## 2. Non-goals

- Surfacing cost or tokens in any chart. The columns are written but no UI reads them yet. (Sub-project 3.)
- Inspector execution-history scrubber. (Sub-project 3.)
- Run Timeline / Gantt node. (Sub-project 4.)
- Error Explorer node. (Sub-project 5.)
- Cost capture for non-LLM nodes (scraper, file ops, etc.). Out of scope; LLM only.
- Cross-process delivery (LISTEN/NOTIFY, Redis pub/sub). The workflow engine runs in the same Node process as SvelteKit; an in-process `EventEmitter` is sufficient. Cross-process is the upgrade path if/when the engine becomes a sidecar.

## 3. Architecture

Three components, in build order:

```
┌──── LLM-using node executor ────┐
│  await callLLM(client, ...)     │ ── usage rolled up via async-local
│                                  │    storage into the active node-
│                                  │    execution record
└──────────────┬───────────────────┘
               ▼
       node_executions row
       (tokens_input, tokens_output,
        cache_read_tokens,
        reasoning_tokens, cost_usd,
        provider, model,
        price_snapshot)
               ▼
       db update → emit(observability-bus,
                        'node.completed', {...})
               ▼
       SSE handler subscribes,
       fans events out to all
       open canvas tabs for that slug
               ▼
       Browser EventSource → useCanvasStream store
       → four observability nodes auto-invalidate
```

### 3.1 Wrapping the LLM gateway

`src/lib/jkai/llm-client.ts` currently returns a raw `OpenAI` client. We wrap the returned client so that `chat.completions.create(...)` is intercepted:

1. Before the call: nothing.
2. After the call: read `response.usage` (`prompt_tokens`, `completion_tokens`, plus provider-specific extensions for cache/reasoning tokens), look up the per-token price for `(provider, model)` from a small inline price table, compute `cost_usd`, and append the record to an **AsyncLocalStorage** context keyed by the current `nodeExecutionId`.

The wrapper is the *only* place that knows about pricing. Each node executor stays oblivious — it just calls the client normally.

**Provider-specific usage extraction:**
- OpenAI/OpenRouter: `usage.prompt_tokens`, `usage.completion_tokens`, `usage.prompt_tokens_details.cached_tokens` (when present).
- z.ai (GLM): same OpenAI-compatible shape; reasoning tokens may surface as `usage.completion_tokens_details.reasoning_tokens`.
- Anthropic via OpenRouter: same OpenAI-compatible shape; cache fields normalised by OpenRouter.

If a field is absent, write `null` (not `0`) so charts can distinguish "no data" from "zero".

### 3.2 Async-local execution context

`src/lib/workflows/execution-context.ts` (new file) exports:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

interface ExecutionContext {
  nodeExecutionId: string;
  runId: string;
  workflowId: string;
  llmCalls: LLMCallRecord[];   // accumulated by the gateway wrapper
}

export const executionContext = new AsyncLocalStorage<ExecutionContext>();
```

The engine runs each node inside `executionContext.run({...}, () => executor.execute(...))`. The gateway wrapper reads the current context and pushes to `llmCalls`. When the node finishes, the engine drains the array and writes a single row to `node_executions` with the summed totals + a price_snapshot (the prices that were used).

If a node makes multiple LLM calls (e.g., deep-research, intel-query), the per-execution row holds the **sum** of all calls. Per-call breakdown is not stored (yagni).

### 3.3 SSE stream

`src/routes/api/canvas/[slug]/stream/+server.ts` (new) returns `text/event-stream`.

On connect:
1. **Auth check** — same Google OAuth session guard as the existing `/stats/*` endpoints.
2. **Resolve the canvas** — `workflows.name = 'canvas:' + slug`. 404 if missing.
3. **Snapshot** — push one event:
   ```
   event: snapshot
   data: {
     activeRuns: [{ runId, startedAt, currentNodeId }],
     recentRuns: [last 5 from the last 24h],
     lastEditAt: <iso>
   }
   ```
4. **Subscribe** — register a listener on the new `observability-bus` (see below) filtered by `workflowId`. Each event is serialised as:
   ```
   event: <type>
   data: <json>
   ```
5. **Heartbeat** — every 15 s push `:ping` so proxies don't close the connection.
6. **Cleanup** — on client disconnect (`request.signal.aborted` or write failure), unsubscribe.

### 3.4 New observability event bus

`src/lib/workflows/observability-bus.ts` (new file) — separate from the existing `event-bus.ts` (which carries cross-workflow trigger events). A second `EventEmitter` with `setMaxListeners(200)` keeps semantic spaces clean and avoids accidentally chaining a node-completion into a workflow-trigger.

Events emitted by the engine (`run-helpers.ts`, `scheduler.ts`, `engine-resume.ts`):

| Event             | Payload                                                     | Emitted from              |
|-------------------|-------------------------------------------------------------|---------------------------|
| `run.started`     | `{ workflowId, runId, trigger, startedAt }`                 | run-helpers / scheduler   |
| `run.completed`   | `{ workflowId, runId, status, completedAt, durationMs }`    | run-helpers / scheduler   |
| `run.failed`      | `{ workflowId, runId, error, completedAt }`                 | run-helpers / scheduler   |
| `node.started`    | `{ workflowId, runId, nodeId, startedAt }`                  | engine inner loop         |
| `node.completed`  | `{ workflowId, runId, nodeId, completedAt, durationMs, costUsd, tokensInput, tokensOutput }` | engine inner loop         |
| `node.failed`     | `{ workflowId, runId, nodeId, error, completedAt }`         | engine inner loop         |
| `audit.edit`      | `{ workflowId, entity, action, at }`                        | wherever workflowAuditLog is written |

All events carry `workflowId` so the SSE handler can filter cheaply.

### 3.5 Client-side live store

`src/lib/canvas/stats/useCanvasStream.svelte.ts` (new):

```ts
export function useCanvasStream(slug: () => string) {
  let snapshot = $state<SnapshotData | null>(null);
  let lastEvent = $state<{ type: string; data: unknown; at: number } | null>(null);

  $effect(() => {
    const s = slug();
    if (!s) return;
    const es = new EventSource(`/api/canvas/${s}/stream`);
    es.addEventListener('snapshot', (e) => { snapshot = JSON.parse(e.data); });
    for (const t of ['run.started','run.completed','run.failed',
                     'node.started','node.completed','node.failed','audit.edit']) {
      es.addEventListener(t, (e) =>
        lastEvent = { type: t, data: JSON.parse(e.data), at: Date.now() });
    }
    return () => es.close();
  });

  return { get snapshot() { return snapshot; }, get lastEvent() { return lastEvent; } };
}
```

Each observability node subscribes via the existing `useStats` hook, which currently re-fetches when `refreshKey()` changes. We replace `refreshKey` with a `bumpKey` derived from `lastEvent` filtered by relevance:

- **SummaryNode / TrendsNode**: bump on any `run.*` or `audit.edit`.
- **PerNodeNode**: bump on any `node.*` or `run.*`.
- **Inspector**: bump on `node.completed` / `node.failed` for the node it taps (read inspector's wired-upstream node id from the canvas state).

The existing `useStats` re-fetch logic is unchanged — we just feed it a new bump signal. This keeps the refactor blast radius small.

## 4. Phases & checklist

The plan is one PR, four phases, in order:

### Phase 1 — Schema + execution-context plumbing

- [ ] Migration `0NNN_node_executions_cost_columns.sql` (or via `drizzle-kit push`) adds:
  - `tokens_input INT NULL`
  - `tokens_output INT NULL`
  - `cache_read_tokens INT NULL`
  - `reasoning_tokens INT NULL`
  - `cost_usd NUMERIC(12,6) NULL`
  - `provider TEXT NULL`
  - `model TEXT NULL`
  - `price_snapshot JSONB NULL`
- [ ] Update `src/lib/db/schema.ts` `nodeExecutions` table definition to match.
- [ ] Create `src/lib/workflows/execution-context.ts` with `AsyncLocalStorage`-backed context.
- [ ] In `src/lib/workflows/engine.ts`'s per-node loop, wrap each `executor.execute(...)` in `executionContext.run({ nodeExecutionId, runId, workflowId, llmCalls: [] }, ...)`.
- [ ] On successful node completion, write the rolled-up usage onto the `node_executions` row alongside the existing `outputData`/`completedAt` update in `run-helpers.ts` and `scheduler.ts`.
- [ ] Verify: run any LLM-using workflow (e.g., a canvas with one `chat` node). Confirm the `node_executions` row has non-null cost/tokens. Confirm a `code-execute` or `file-store` row has nulls (non-LLM).

### Phase 2 — LLM gateway wrapper

- [ ] New file `src/lib/jkai/llm-pricing.ts` — exports `priceFor(provider, model): { input: number; output: number; cacheRead?: number; reasoning?: number } | null` plus a small hard-coded table for the providers/models actually in use (z.ai GLM family, OpenAI gpt-4o/gpt-4o-mini, Anthropic claude-* via OpenRouter, OpenRouter passthroughs we recognise). Unknown model → return null and cost stays null.
- [ ] Modify `src/lib/jkai/llm-client.ts::getLLMClient` to wrap the returned OpenAI client:
  - Use a Proxy or a thin manual wrapper around `client.chat.completions.create`.
  - After the call resolves, extract usage, compute cost via `priceFor`, push to the current `executionContext` (no-op if context absent — keeps non-engine callers like `/jkai` chat unaffected).
- [ ] Verify: same workflow as Phase 1, confirm columns now populated with real values, not zeros. Run a workflow with a stale/unknown model id — confirm columns are null but row is still written.

### Phase 3 — Observability event bus + SSE endpoint

- [ ] New file `src/lib/workflows/observability-bus.ts` — `EventEmitter` + typed `emit()` / `on()` helpers + the seven event types from §3.4.
- [ ] Wire `emit()` calls in:
  - `run-helpers.ts` — `run.started` (after the initial insert), `run.completed` / `run.failed` (in the engine `.then` / `.catch`).
  - `scheduler.ts` — same three for scheduled triggers.
  - `engine.ts` per-node loop — `node.started` (before execute), `node.completed` / `node.failed` (after).
  - `engine-resume.ts` — `node.completed` / `node.failed` for resumed nodes.
  - Any audit-log writer (search `db.insert(workflowAuditLog)` for sites) — `audit.edit`.
- [ ] New route `src/routes/api/canvas/[slug]/stream/+server.ts`:
  - Auth guard mirrors `/stats/summary/+server.ts`.
  - Resolves workflow by `canvas:${slug}` (use the same helper).
  - Builds snapshot via two small queries (active runs + recent runs + last edit).
  - Subscribes to `observability-bus`, filters by `workflowId`, writes events to the SSE stream.
  - Sends `:ping\n\n` every 15 s.
  - Tears down on `request.signal` abort or write throw.
- [ ] Verify: open `curl -N http://localhost:5173/api/canvas/<slug>/stream` and trigger a run from the UI; confirm the snapshot arrives first then `run.started → node.started → node.completed → run.completed` events stream in.

### Phase 4 — Client-side live store + node refactor

- [ ] New file `src/lib/canvas/stats/useCanvasStream.svelte.ts` per §3.5.
- [ ] At the canvas page level (`src/routes/jkai/canvas/[slug]/+page.svelte`), instantiate `useCanvasStream(() => canvas.slug)` once and derive per-node bump signals from `stream.lastEvent`.
- [ ] Pass the derived bump signals into `SummaryNode` / `TrendsNode` / `PerNodeNode` in place of `refreshKey`.
- [ ] Delete the manual `refreshKey` state and any UI that increments it (audit `+page.svelte` for `refreshKey++` sites). The `⟳` button on each stats node still works — it calls `stats.refresh()` directly, no global key needed.
- [ ] Inspector: subscribe to `node.completed` / `node.failed` for its tapped upstream node id. When fired, re-fetch the upstream node's latest execution and re-render. (No new history scrubber — just live latest.)
- [ ] Verify: open the canvas in two browser tabs. Trigger a run from tab A. Confirm tab B's Summary counters, sparkline, Trends bars, Per-node table, and any wired Inspector update without manual refresh.

## 5. Verification (end-to-end)

These are the gates before declaring the foundation done. Run them all on `homeserv` against a real canvas with at least one LLM node.

1. **Schema** — `\d node_executions` shows the eight new columns, all nullable.
2. **Cost capture** — execute a canvas with one `chat` node; confirm `cost_usd`, `tokens_input`, `tokens_output`, `provider`, `model`, `price_snapshot` are non-null on its `node_executions` row. Pick a row from a `code-execute` or `data-store` node and confirm those columns are null.
3. **Stale model** — temporarily set a `chat` node's model to a string `priceFor` won't recognise. Run. Confirm the row writes with tokens populated but cost_usd null (no crash, no zero-cost lie).
4. **SSE shape** — curl the stream endpoint, trigger a run, confirm the seven event types stream in order with valid JSON payloads.
5. **Live UI** — two tabs, run from one, confirm the other reflects the run in real time without `⟳`.
6. **No regression** — open a canvas with no current activity; the four observability nodes still load their initial data via the existing REST endpoints.

## 6. Risks & open questions

- **AsyncLocalStorage in SvelteKit routes:** the LLM gateway is also used by `/api/workflows/orchestrator/chat` and other non-engine callers. The wrapper must gracefully no-op when no execution context is present (we already plan to). Worth a once-over to be sure no caller depends on a specific request-scoped storage that collides.
- **Pricing accuracy:** the inline price table will drift. Document it as best-effort; surface "unknown model → null cost" as a debuggable signal rather than a hidden zero. A future sub-project can pull prices from `app_settings` instead.
- **Event volume on long runs:** a 50-node workflow emits ~100 events. SSE handles this trivially. No coalescing needed.
- **Re-emit on resume:** an `awaiting_human` node that resumes should emit `node.completed` once, not twice. Make sure `engine-resume.ts` and the inner loop don't double-fire on the same `nodeExecutionId`.

## 7. Roll-forward / roll-back

- **Roll forward** is the schema migration + four touched code areas. Reversible via `drizzle-kit push` after dropping the columns; no destructive data loss in the columns since they're additive nullable.
- **Roll back** of the SSE endpoint is a single-file revert; the four observability nodes still work without it because they retain the existing REST endpoints for initial paint. The `⟳` button remains functional.
