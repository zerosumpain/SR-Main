# Workflow Statistics Nodes — Design Spec

## Overview

Add three new canvas node types that surface statistics and edit history for the workflow a canvas represents. The nodes are display-only — they don't participate in the DAG — and share a single time-period filter that lives in the canvas toolbar.

The three nodes together cover: run counts, per-node timing, failure rates, runs over time, duration over time, and structural edit history. A new lightweight audit log table feeds the edit-history panel.

## Scope

**In:**
- Three new node types: `stats-summary`, `stats-trends`, `stats-per-node`
- New `'stats'` visual `NodeKind`
- `workflow_audit_log` table + write hooks at all existing workflow mutation points
- Three stats API endpoints (one per node type), all scoped to the canvas's workflow
- Shared time-filter dropdown in the canvas toolbar, URL-bound
- Row-click highlight in the per-node table

**Out:**
- Full workflow versioning (no `workflow_versions` snapshot table). Explicitly deferred — the audit log covers the user's stated need.
- Stats nodes being part of the execution DAG (they are display-only)
- Cross-canvas or org-wide stats (scope is always a single canvas/workflow)
- Export to CSV/JSON

## Architecture

### Node registration (`src/lib/canvas/adapter.ts`)

Add a new `NodeKind` `'stats'`:

```ts
export type NodeKind =
  | 'input' | 'llm' | 'parse' | 'output' | 'intel' | 'agent'
  | 'chat' | 'trigger' | 'inspector' | 'stats';
```

Register three entries under a new `CANVAS_NODE_GROUPS` entry `'Observability'`:

```ts
{ type: 'stats-summary', label: 'Stats · summary', kind: 'stats',
  group: 'Observability',
  description: 'Headline counters, sparkline, recent runs, and edit history.',
  defaultConfig: { size: { w: 300, h: 280 } } },

{ type: 'stats-trends', label: 'Stats · trends', kind: 'stats',
  group: 'Observability',
  description: 'Runs over time (stacked) and run duration (p50 / p95) over time.',
  defaultConfig: { size: { w: 520, h: 360 } } },

{ type: 'stats-per-node', label: 'Stats · per-node', kind: 'stats',
  group: 'Observability',
  description: 'Table of every node with run count, success rate, avg / p95 duration, last error.',
  defaultConfig: { size: { w: 420, h: 400 } } },
```

Extend `mapTypeToKind()` to return `'stats'` for those three types. Add a muted accent colour for the `stats` kind in `KIND_COLOR`.

Sizes persist via the existing `node.config.size` pattern used by Chat and Inspector — no new persistence code needed. Stats nodes are resizable via `resizableSize()`; extend the chat/inspector resize handler to cover `kind === 'stats'`.

### Display-only enforcement

Stats nodes must not participate in workflow execution:

- **Runtime:** In the executor (`src/lib/workflows/`), skip nodes whose type starts with `stats-`. They never run, never block downstream execution, never appear in `node_executions`.
- **Edge creation:** In the canvas `POST .../edges` route, reject edges whose source or target is a stats node (400 `"Stats nodes are display-only"`).
- **Canvas UI:** Disable handle-drag from/to stats nodes. Reuse the existing pattern used for Inspector edges if any; otherwise just a `data-kind="stats"` check in the edge-drag handlers.

## Shared Time Filter

### URL state

- Query param: `?period=<preset>`
- Presets (stored as string literals): `24h`, `this-week`, `last-week`, `30d`, `last-month`, `all`
- Default: `30d` (used when param is absent or invalid)
- Canvas page page.svelte reads via `$page.url.searchParams.get('period')`; writes via `goto(...)` with `{ replaceState: true, keepFocus: true, noScroll: true }`

### Dropdown location

In `hifi-toolbar > .toolbar-right` (alongside the Run button). Conditional render:

```svelte
{#if viewNodes.some((n) => n.kind === 'stats')}
  <TimeFilter value={period} onchange={(v) => gotoPeriod(v)} />
{/if}
```

The `TimeFilter` component lives at `src/lib/canvas/stats/TimeFilter.svelte`. It renders a `<select>` styled to match the toolbar pills.

### Period → window resolution

Server-side helper `resolvePeriod(period)` returns `{ from: Date, to: Date, granularity: 'hour'|'day'|'week' }`:

| preset | from | to | granularity |
|---|---|---|---|
| `24h` | `now - 24h` | `now` | `hour` |
| `this-week` | start of current ISO week | `now` | `day` |
| `last-week` | start of previous ISO week | start of current ISO week | `day` |
| `30d` | `now - 30d` | `now` | `day` |
| `last-month` | first of previous calendar month | first of current calendar month | `day` |
| `all` | earliest `workflow_runs.startedAt` for workflow | `now` | `day` or `week` (see below) |

For `all`, if the span exceeds 90 days, granularity is `week`; otherwise `day`.

Timezone: UTC for all bucketing. (We can revisit if users ask for local-time buckets later.)

## Audit Log

### Schema (Drizzle migration)

```ts
export const workflowAuditLog = pgTable('workflow_audit_log', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: text('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  entity: text('entity').notNull(),     // 'workflow' | 'node' | 'edge' | 'trigger' | 'schedule'
  entityId: text('entity_id'),          // node/edge id where relevant; null otherwise
  action: text('action').notNull(),     // 'create' | 'delete' | 'rename' | 'config' | 'update'
  details: jsonb('details').default(sql`'{}'::jsonb`),
                                        // { field?, old?, new?, label?, nodeType? }
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
```

Index: `(workflow_id, at desc)` via `index('workflow_audit_log_workflow_at_idx')`.

### Helper

`src/lib/canvas/audit.ts` exports:

```ts
export async function recordAudit(args: {
  workflowId: string;
  entity: 'workflow' | 'node' | 'edge' | 'trigger' | 'schedule';
  entityId?: string | null;
  action: 'create' | 'delete' | 'rename' | 'config' | 'update';
  details?: Record<string, unknown>;
}): Promise<void>;
```

Write failures are logged but never thrown — the audit log must not break mutation paths.

### Write points

All existing workflow mutation endpoints add a single `recordAudit()` call after a successful DB write:

| Endpoint | Entity | Action | Details |
|---|---|---|---|
| `POST /api/workflows/:id/nodes` | `node` | `create` | `{ nodeType, label }` |
| `PATCH /api/workflows/:id/nodes/:nodeId` (label change) | `node` | `rename` | `{ old, new }` |
| `PATCH /api/workflows/:id/nodes/:nodeId` (config change) | `node` | `config` | `{ field, old, new }` — **one audit row per changed top-level `config.*` field** |
| `DELETE /api/workflows/:id/nodes/:nodeId` | `node` | `delete` | `{ nodeType, label }` |
| `POST /api/workflows/:id/edges` | `edge` | `create` | `{ from, to, fromLabel, toLabel }` |
| `DELETE /api/workflows/:id/edges/:edgeId` | `edge` | `delete` | `{ from, to, fromLabel, toLabel }` |
| `PATCH /api/workflows/:id` (name/description) | `workflow` | `rename` | `{ field, old, new }` |
| `PATCH /api/workflows/:id` (trigger) | `trigger` | `update` | `{ old, new }` |
| `POST/PATCH/DELETE /api/workflows/:id/schedules/...` | `schedule` | matching | `{ cron?, enabled? }` |

**Explicitly skipped:**
- `PATCH .../nodes/:nodeId` where only `position` changed (`position` diff ignored)
- `PATCH .../nodes/:nodeId` where only `config.size` changed (resize of chat/inspector/stats nodes)
- Any runtime state (runs, node_executions, healing events)

The position/size exclusion is enforced in each PATCH route: diff the incoming patch against the stored node, emit audit entries only for fields outside the `{position, config.size}` exclusion set.

## Stats API

Three endpoints, one per node type. All routes under `src/routes/api/canvas/[slug]/stats/`.

### Shared response envelope

Every endpoint returns:

```ts
{
  window: { from: string; to: string; preset: string; granularity: 'hour'|'day'|'week' };
  data: { /* endpoint-specific */ };
}
```

### `GET /api/canvas/[slug]/stats/summary?period=`

```ts
data: {
  counters: {
    runs: number;
    success: number;
    failed: number;
    healing: number;
    successRate: number; // 0..1
    avgDurationMs: number | null;
  };
  sparkline: Array<{ bucket: string; count: number }>; // same granularity as trends
  recentRuns: Array<{
    id: string;
    status: 'completed' | 'failed' | 'running' | 'healing' | 'pending';
    startedAt: string;
    durationMs: number | null;
  }>; // newest 5
  recentEdits: Array<{
    at: string;
    entity: string;
    entityId: string | null;
    action: string;
    details: Record<string, unknown>;
  }>; // newest 5
}
```

SQL sketch: one query for counters over `workflow_runs` filtered by workflow + window; one for sparkline buckets; one for `recentRuns`; one for `recentEdits` joining on nothing (just `workflow_audit_log` filtered).

### `GET /api/canvas/[slug]/stats/trends?period=`

```ts
data: {
  buckets: Array<{
    t: string;        // ISO timestamp at start of bucket
    runs: { success: number; failed: number; healing: number };
    durationMs: { p50: number | null; p95: number | null; avg: number | null };
  }>;
}
```

`p50` / `p95` via `percentile_cont(0.5|0.95) WITHIN GROUP (ORDER BY duration_ms)` grouped by `date_trunc(granularity, started_at)`. Healing runs counted with status `'failed'` if the final run ended failed; with status `'success'` if healing succeeded. (Healing is tracked in `workflow_runs.healingHistory` — exact mapping to be settled during implementation; the conservative choice is: final `workflow_runs.status` determines `success`/`failed`, and `healing` is the count of runs with non-empty `healingHistory`.)

Empty buckets are still present in the array (zero-filled) so the chart x-axis is continuous.

### `GET /api/canvas/[slug]/stats/per-node?period=`

```ts
data: {
  nodes: Array<{
    nodeId: string;
    label: string;
    type: string;
    runs: number;
    success: number;
    failed: number;
    avgMs: number | null;
    p95Ms: number | null;
    lastError: { at: string; message: string } | null;
  }>;
}
```

Built from `node_executions` joined to `workflow_nodes` (for `label`/`type`), filtered by workflow + window on `node_executions.startedAt`. Stats nodes themselves (type starts with `stats-`) are excluded from the result.

Nodes with zero executions in the window are still included, with zero counts, so users can see "this node never ran in this window".

## Rendering

New directory: `src/lib/canvas/stats/`

```
src/lib/canvas/stats/
├── TimeFilter.svelte       // toolbar dropdown
├── SummaryNode.svelte       // stats-summary
├── TrendsNode.svelte        // stats-trends
├── PerNodeNode.svelte       // stats-per-node
├── useStats.svelte.ts       // tiny fetch helper shared by all three
└── format.ts                // ms → human, dates → short, etc.
```

### `useStats.svelte.ts`

Svelte 5 rune-based helper. Given a `period` string and an endpoint slug (`'summary' | 'trends' | 'per-node'`), returns a reactive object with `{ data, loading, error, refresh() }`. Internally uses `$effect` to refetch on `period` change and on external `refresh()` calls.

### Page integration (`+page.svelte`)

Render each stats node in its own dedicated `{#if n.kind === 'stats'}` branch of the node loop, keyed by `n.type`:

```svelte
{#if n.type === 'stats-summary'}
  <SummaryNode {n} {period} {workflowId} onrowclick={scrollToNode} />
{:else if n.type === 'stats-trends'}
  <TrendsNode {n} {period} {workflowId} />
{:else if n.type === 'stats-per-node'}
  <PerNodeNode {n} {period} {workflowId} onrowclick={scrollToNode} />
{/if}
```

The period prop comes from the derived URL param. Each node is wrapped in the same draggable/resizable scaffold already used for chat and inspector nodes.

### Charts

`layerchart` (already a dependency, used in `SparklineStrip.svelte`):

- **Sparkline (summary):** `Chart > Svg > Area + Spline`
- **Runs over time (trends):** `Chart > Svg > Bars` with `stackBy: 'status'`
- **Duration over time (trends):** `Chart > Svg > Spline` for p50, `Spline` for p95 (dashed), `Line` for avg (faint)
- All axes and tooltips use layerchart defaults; theme colours come from existing CSS variables (`--accent`, `--text-primary`, `#c44` for failed, `#ffcf40` for healing).

### Per-node table

Plain `<table>` with sortable column headers. Style matches existing admin tables (reuse `src/routes/admin/agent/*` table styles — lift shared CSS into `stats-table.css` if needed, otherwise inline).

Row click emits `onrowclick(nodeId)`. The parent page scrolls the canvas to centre the target node and adds a class `flash` for 800ms that pulses the node outline (CSS only, `@keyframes`).

### Refresh semantics

- Each node fetches on mount.
- Each node refetches whenever `period` changes.
- A `refresh()` handler is called from the parent after a run completes (reuse the existing invalidation signal in the canvas page).
- Each node renders a small `⟳` button in its header for manual refresh.
- No free-running polling.

## Data Flow

```
User changes period in toolbar
  → goto('?period=X', { replaceState })
  → $page.url updates
  → period $derived rerenders
  → each stats node's useStats helper re-fetches its endpoint
  → component re-renders

User clicks Run
  → existing run flow
  → on run completion: canvas invalidates + emits 'run-settled' signal
  → stats nodes call refresh()

User edits workflow (add/remove/rename node, edit config, add/remove edge)
  → existing mutation path
  → recordAudit() called in endpoint
  → next stats-summary fetch includes the new edit in recentEdits
```

## Error handling

- Stats endpoints: if the workflow doesn't exist, return 404. If the period is invalid, treat as `30d` (don't 400 — user URLs in the wild shouldn't break the page).
- Fetch failures in a stats node: show a compact error strip inside the node with a retry button. The canvas and other nodes are unaffected.
- Audit writes that fail: log and continue. The user's edit still succeeds.

## Testing

- **Unit:** `resolvePeriod()` given each preset at fixed reference times → expected `{from, to, granularity}`.
- **Unit:** diff helper for node PATCH that decides which fields go to the audit log (exclude `position`, `config.size`).
- **Integration (Vitest + real DB):**
  - Seed a workflow with a few runs and node_executions across timestamps, call each stats endpoint with each preset, assert shape + counts.
  - Trigger each mutation endpoint, verify `workflow_audit_log` row written with correct `entity`/`action`/`details`.
  - Verify edge-create endpoint rejects edges touching stats nodes.
  - Verify executor skips stats nodes (workflow with a stats node between two regular nodes runs both regular nodes; stats node has no `node_executions` row).
- **Manual:** add each of the three stats nodes to the sample canvas, change period, run workflow, observe refreshes. Check audit log populates when you rename a node / edit config / add an edge.

## Migration / rollout

1. Ship schema migration for `workflow_audit_log` (additive, zero risk).
2. Ship audit-log write hooks with a feature flag (env var `CANVAS_AUDIT_ENABLED`, default on) — cheap safety net if hooks misbehave.
3. Ship executor + edge-validation changes for stats nodes.
4. Ship node registration + components + API endpoints.
5. No backfill: audit log starts empty; `all`-period charts work from existing `workflow_runs`/`node_executions` data (unchanged).

## Open questions

None remaining at design time. Implementation-time choices (exact SQL for healing classification, table CSS reuse vs inline) are deferred to the plan.
