# Observability — phase 5 design

**Date:** 2026-05-19
**Status:** Draft (awaiting user review)
**Predecessors:** [`docs/superpowers/plans/2026-05-18-observability-foundation.md`](../plans/2026-05-18-observability-foundation.md) — foundation (schema, gateway wrap, SSE, live updates) shipped in commit `81fc638`.

## 1. Scope (what "phase 5" means)

The full remaining slate of the original 5-part observability initiative, in one design:

1. **Existing nodes refresh** — surface cost / tokens in Summary, Trends, Per-Node; Inspector history scrubber; chart-quality lift across all four (hover tooltips, comparison-with-prior-period overlay).
2. **Per-Node drill-down** — row expansion with avg / median / max / p50 / p95 duration + cost trend, all interactive, with inline metric and time-range pickers that override the canvas-wide TimeFilter for that row only.
3. **Run Timeline (Gantt) — new node** — per-run waterfall: every node as a bar on a timeline, with status colour, label, and duration. Recent-runs picker at the top; click any recent run to focus.
4. **Error Explorer — new node** — group failed `node_executions` by error signature, show count / last seen / sparkline / affected nodes; click a group to list runs and jump to the Inspector for the most recent failure.
5. **Cost — new node** — total spend within the period, breakdown by node type / model / time bucket, drill into individual LLM calls.

All five surfaces consume the cost / token columns + the SSE event bus that landed in the foundation. No new schema, no new bus events.

## 2. Non-goals

- Multi-canvas / global observability. Everything stays scoped to one canvas via `workflows.name = canvas:<slug>`.
- Streaming-LLM cost capture. Streaming calls still record null cost; that's a foundation limitation, not phase-5 work.
- Alerting / SLOs / threshold rules. Out of scope here; would be its own sub-project.
- Per-edge dataset volume metrics.
- Cost-aware self-healing (e.g., "downgrade model if spend exceeds X"). Engine remains cost-blind.
- Pricing-table dynamism. Prices stay in `llm-pricing.ts`; refresh from OpenRouter / DB is deferred.

## 3. Architecture overview

Five new server endpoints plus four touched existing endpoints, three new canvas-node types, and one refresh of each of the four existing observability components.

```
                  ┌──────── canvas page (+page.svelte) ───────────────────┐
                  │ shared TimeFilter, shared useCanvasStream (foundation)│
                  │                                                       │
   ┌──────────────┼────────────┬───────────────┬─────────────┬───────────┐│
   ▼              ▼            ▼               ▼             ▼           ▼│
SummaryNode  TrendsNode   PerNodeNode    RunTimelineNode  ErrorNode   CostNode
(refreshed)  (refreshed)  (drill-down)       (new)         (new)       (new)
   │              │            │               │             │           │
   ▼              ▼            ▼               ▼             ▼           ▼
/stats/      /stats/        /stats/       /stats/         /stats/    /stats/
 summary      trends       per-node       run-timeline    errors      cost
  (+cost)    (+cost track)  (+cost cols)    (new)          (new)      (new)
            +/per-node/[id]/series (new)        InspectorBody + history (touched)
```

### 3.1 Existing nodes refresh

**Summary** — five existing counters become eight: + `cost`, `tokens` (input+output), `cache-hit-rate` (cache_read / tokens_input). Sparkline gains a toggle: runs (default) | cost.

**Trends** — adds a third track below runs-over-time and duration-over-time: **cost-over-time** (stacked by model). Existing duration track gains hover tooltips with exact values; runs track gains a translucent prior-period overlay (e.g., when viewing "last 7 days", a faint comparison line for the previous 7 days).

**Per-Node** — adds three columns: `cost` (sum of cost_usd in window), `in→out tokens`, `cache %`. Existing duration columns gain a 24h-sparkline inline.

**Inspector** — gains a history scrubber at the top of the rendered output. A small horizontal strip of dots, one per recent execution (default last 20), labelled with relative time + status colour. Click a dot → that execution's output renders below. The newest dot is auto-selected; live updates push a new dot in as `node.completed` arrives.

### 3.2 Per-Node drill-down

Each row in Per-Node is currently expandable (the existing `caret` cell). Today the expanded panel shows min/max/total in a 4-cell grid. We replace that grid with:

- A **metric tab strip**: `duration · cost · runs · cache`. Tab selection is per-row state.
- A **time-range pill** that defaults to the canvas-wide TimeFilter but exposes its own override (`1h · 6h · 24h · 7d · 30d · all`).
- A **chart canvas** below: `layerchart` line with p50 / p95 bands for duration, single-line for cost / runs / cache. ~ 200 px tall.
- A **summary line**: avg · median · max · p95 for the active metric.

Click outside the row collapses it. Multiple rows can be expanded simultaneously; each has independent metric / time-range state.

### 3.3 Run Timeline (Gantt) — new node

**Type:** `run-timeline` (kind: `stats`, group: `Observability`).

**Defaults:** `{ size: { w: 540, h: 320 } }`, no `defaultConfig` user fields.

**Body:**

- **Run picker** at the top — dropdown of recent runs (last 50) labelled `<relative-time> · <status-dot> · <duration>`.
- **Gantt area** — x-axis is run wall-clock (`0 ms → total duration`), one row per node that executed. Bar colour from status: green / red / amber (healing) / grey (skipped). Bar label = node label (truncated). Bar width = duration. Hover → tooltip with node id, type, duration, error (if any), and cost (if LLM).
- **Click a bar** → opens the Inspector tap into that node (`scrollToNode(nodeId)` + open menu).

**Server**: new endpoint `/api/canvas/[slug]/stats/run-timeline?runId=...` returns `[{ nodeId, label, type, startedAt, completedAt, status, durationMs, costUsd, error }]` for every `node_executions` row in that run.

**Live:** subscribe to `node.started` / `node.completed` / `node.failed` for the focused run's runId; append / update bars in place.

### 3.4 Error Explorer — new node

**Type:** `error-explorer` (kind: `stats`, group: `Observability`).

**Defaults:** `{ size: { w: 420, h: 360 } }`.

**Body:**

- **Header** — single counter: `<N> errors in window` (period filter shared with TimeFilter).
- **Group list** — each group: `<count>×  <error-signature>  <last-seen>  <affected-nodes>`. Sorted by count descending.
- **Click a group** → expands into recent failing executions (last 5): `<run-id-short> · <node-label> · <relative-time> · "open"`. Click "open" → `scrollToNode(nodeId)`.

**Signature**: first 80 chars of the `node_executions.error` string, normalised: collapse whitespace, strip a leading timestamp / level prefix, strip ANSI escapes. Stored per-row; grouped at query time.

**Server**: new endpoint `/api/canvas/[slug]/stats/errors?period=...` returns groups + execution refs.

### 3.5 Cost — new node

**Type:** `cost-summary` (kind: `stats`, group: `Observability`).

**Defaults:** `{ size: { w: 380, h: 320 } }`.

**Body:**

- **Headline** — `$<total>` for the period.
- **Stacked bar** — cost-over-time, stacked by `model` (legend below).
- **Breakdown table** — toggle: `by model · by node-type · by node-label`. Each row: model/type/label, cost, % of total, requests, avg-cost-per-request.
- **Drill** — click a row → list of the 20 most-recent LLM calls for that bucket. Each: `<timestamp> · <node-label> · <tokens-in→out> · $<cost>`. Click → `scrollToNode(nodeId)`.

**Server**: new endpoint `/api/canvas/[slug]/stats/cost?period=...&groupBy=model|node-type|node-label` returns `{ totalUsd, buckets: [...], breakdown: [...] }`.

## 4. Component / file map

### 4.1 New files

```
src/lib/canvas/stats/
  PerNodeDrilldown.svelte    # the row-expansion body (charts + tab strip)
  RunTimelineNode.svelte
  ErrorExplorerNode.svelte
  CostNode.svelte
  errorSignature.ts          # normalise / extract signature from error strings
  costFormat.ts              # $0.0042 → "$0.004", $12 → "$12.00" helpers

src/routes/api/canvas/[slug]/stats/
  per-node/[id]/series/+server.ts   # metric time series for one node
  run-timeline/+server.ts
  errors/+server.ts
  cost/+server.ts

src/lib/canvas/InspectorHistory.svelte   # scrubber strip
```

### 4.2 Touched files

- `src/lib/canvas/adapter.ts` — register three new node types (run-timeline, error-explorer, cost-summary) in the `Observability` group; map their `kind` to `'stats'`.
- `src/routes/jkai/canvas/[slug]/+page.svelte` — render the three new node kinds (mirror existing stats-rendering block); pipe the existing `liveStream` bumps into them.
- `src/lib/canvas/stats/SummaryNode.svelte` — add three counters (cost, tokens, cache-hit-rate); sparkline mode toggle.
- `src/lib/canvas/stats/TrendsNode.svelte` — add cost-over-time track; tooltips on hover; prior-period overlay.
- `src/lib/canvas/stats/PerNodeNode.svelte` — three new columns; replace the expanded grid with `PerNodeDrilldown`.
- `src/lib/canvas/InspectorBody.svelte` — accept a `history` prop; render `InspectorHistory` above the body when provided.
- `src/routes/api/canvas/[slug]/stats/summary/+server.ts` — extend response with cost / tokens / cache-hit aggregates.
- `src/routes/api/canvas/[slug]/stats/per-node/+server.ts` — extend response with cost / tokens / cache aggregates; existing min/max/avg stays.
- `src/routes/api/canvas/[slug]/stats/trends/+server.ts` — add a `costByModel: [{ t, model, costUsd }]` slice.

## 5. Build order (phased within the spec)

This is one design but six implementation phases. Each phase is independently shippable and verifiable.

**P5.1 — Server data layer.** Extend the three existing stats endpoints; add the four new endpoints. No UI work; verified by curl + the existing fixture data.

**P5.2 — Existing-node refreshes.** Plumb the new cost / tokens fields into Summary, Trends, Per-Node (columns + sparklines). Chart facelift (tooltips + prior-period overlay). No drill-down yet.

**P5.3 — Per-Node drill-down.** New `PerNodeDrilldown.svelte`; consumes `/per-node/[id]/series`. Inline metric tab strip + time-range pill.

**P5.4 — Inspector history scrubber.** New `InspectorHistory.svelte`; new server query for last-N executions; integrate into `InspectorBody`.

**P5.5 — Run Timeline node.** Adapter registration; new component; new endpoint; live updates via `node.*` events filtered to the focused runId.

**P5.6 — Error Explorer + Cost nodes.** Both consume their new endpoints. Cost includes the drill-down list. Ship together to close out phase 5.

P5.1 is the unlock for everything else and ships first. P5.2-P5.4 are the "existing refresh" half. P5.5-P5.6 are the "new nodes" half.

## 6. Open interpretive decisions (call out for user review)

These are choices I locked in to avoid asking more questions; flag any that should change.

- **Error signature key** is the first 80 chars of `node_executions.error` after whitespace / ANSI / leading-prefix normalisation. *Alt:* full string hashed.
- **Inspector history depth** is the last 20 executions of the tapped node. *Alt:* configurable per-node; per-run.
- **Cost groupings** are model / node-type / node-label (a node's display label). *Alt:* by provider, by `priceSnapshot`.
- **Prior-period overlay** uses the same-duration window immediately before the current period (e.g., last 7d → prior 7d). *Alt:* same period 1 week ago / 1 month ago.
- **Run Timeline picker** defaults to the most recent run on mount. *Alt:* the most recent failed run if any.
- **Per-Node drill-down state is per-row, ephemeral.** Closing and reopening forgets the chosen metric / time-range. *Alt:* persist per-node-id to the canvas's `config`.

## 7. Risks

- **Per-Node drill-down chart count.** A canvas with 20 nodes, every row expanded, all in distinct time ranges → 20 active SSE subscriptions and 20 `layerchart` instances. Acceptable but watch GPU on the design machine.
- **Error signature drift.** Stack traces vary across deploys (line numbers move). Signatures will fracture across releases; that's a feature, not a bug — but the per-group count resets after a deploy that changes how a node fails. Document this in the node's hover help.
- **Cost reporting accuracy.** Streaming calls remain null-cost. For phase 5 we surface "$X spent (excluding streaming)" rather than pretend the total is complete. Footnote it in the Cost node.

## 8. Roll-back

Every phase is reversible. Schema isn't touched. New endpoints can be removed independently; touched endpoints stay backwards-compatible (added fields are additive). New node types are unregistered by reverting `adapter.ts`. The four existing observability components fall back to their pre-phase-5 shape by reverting their files.
