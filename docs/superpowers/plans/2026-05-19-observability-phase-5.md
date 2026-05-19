# Observability — phase 5 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the full remaining slate of the original 5-part observability initiative — surface cost/tokens in existing observability nodes, add Per-Node drill-down with interactive metric charts, ship Inspector history scrubber, add three new node types (Run Timeline, Error Explorer, Cost).

**Architecture:** Six sequential build phases (P5.1–P5.6). P5.1 lands the server endpoints that unlock everything else. P5.2 surfaces the new data in the existing nodes. P5.3 adds the drill-down. P5.4 adds Inspector history. P5.5 + P5.6 add the three new node types. Every phase is independently shippable.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Drizzle ORM (Postgres 16), `layerchart` for charts, vitest for unit tests. Server-Sent Events from the foundation layer (`useCanvasStream`, `observability-bus`).

**Spec:** [`docs/superpowers/specs/2026-05-19-observability-phase-5-design.md`](../specs/2026-05-19-observability-phase-5-design.md)

---

## File map

### New files
- `src/lib/canvas/stats/errorSignature.ts` — error-string normalisation for grouping
- `src/lib/canvas/stats/costFormat.ts` — money formatters ($0.0042 → "$0.004", $12 → "$12.00")
- `src/lib/canvas/stats/PerNodeDrilldown.svelte` — row-expansion body for Per-Node
- `src/lib/canvas/stats/RunTimelineNode.svelte` — Gantt-style per-run waterfall
- `src/lib/canvas/stats/ErrorExplorerNode.svelte` — grouped failures with drill-in
- `src/lib/canvas/stats/CostNode.svelte` — spend dashboard with breakdown
- `src/lib/canvas/InspectorHistory.svelte` — scrubber strip above Inspector body
- `src/routes/api/canvas/[slug]/stats/per-node/[id]/series/+server.ts`
- `src/routes/api/canvas/[slug]/stats/run-timeline/+server.ts`
- `src/routes/api/canvas/[slug]/stats/errors/+server.ts`
- `src/routes/api/canvas/[slug]/stats/cost/+server.ts`
- `src/routes/api/canvas/[slug]/nodes/[id]/recent-executions/+server.ts`
- `tests/lib/canvas/stats/errorSignature.test.ts`
- `tests/lib/canvas/stats/costFormat.test.ts`

### Touched files
- `src/lib/canvas/adapter.ts` — register `run-timeline`, `error-explorer`, `cost-summary` types
- `src/routes/jkai/canvas/[slug]/+page.svelte` — render the three new node kinds; bump signals
- `src/lib/canvas/stats/SummaryNode.svelte` — three new counters + sparkline mode toggle
- `src/lib/canvas/stats/TrendsNode.svelte` — cost-by-model track + tooltips + prior-period overlay
- `src/lib/canvas/stats/PerNodeNode.svelte` — three new columns + integrate `PerNodeDrilldown`
- `src/lib/canvas/InspectorBody.svelte` — optional `history` prop + render
- `src/routes/api/canvas/[slug]/stats/summary/+server.ts` — cost/tokens/cache aggregates
- `src/routes/api/canvas/[slug]/stats/per-node/+server.ts` — cost/tokens/cache aggregates
- `src/routes/api/canvas/[slug]/stats/trends/+server.ts` — cost-by-model + prior-period

---

# Phase P5.1 — Server data layer

Eight tasks: 1 pure-function helper, 3 endpoint extensions, 4 new endpoints. No UI work yet. Each endpoint is curl-verified against the local dev DB after restart.

## Task 1: `errorSignature.ts` — pure helper + tests

**Why:** the Error Explorer endpoint (Task 7) groups failed `node_executions` rows by a normalised signature of their error string. Centralise the normalisation so it stays consistent if the grouping rule evolves.

**Files:**
- Create: `src/lib/canvas/stats/errorSignature.ts`
- Test: `tests/lib/canvas/stats/errorSignature.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/canvas/stats/errorSignature.test.ts
import { describe, it, expect } from 'vitest';
import { extractSignature } from '$lib/canvas/stats/errorSignature';

describe('extractSignature', () => {
  it('returns trimmed error for short input', () => {
    expect(extractSignature('  boom  ')).toBe('boom');
  });

  it('strips ANSI colour escape codes', () => {
    expect(extractSignature('[31mboom[0m')).toBe('boom');
  });

  it('strips a leading ISO timestamp prefix', () => {
    expect(
      extractSignature('2026-05-19T10:00:00.000Z error: bad thing'),
    ).toBe('error: bad thing');
  });

  it('strips a leading log-level prefix', () => {
    expect(extractSignature('ERROR: bad thing')).toBe('bad thing');
    expect(extractSignature('[error] bad thing')).toBe('bad thing');
    expect(extractSignature('WARN bad thing')).toBe('bad thing');
  });

  it('collapses internal whitespace', () => {
    expect(extractSignature('bad\n\n  thing')).toBe('bad thing');
  });

  it('truncates to 80 chars', () => {
    const long = 'x'.repeat(200);
    expect(extractSignature(long)).toHaveLength(80);
  });

  it('returns empty string for null/undefined/whitespace input', () => {
    expect(extractSignature('')).toBe('');
    expect(extractSignature('   ')).toBe('');
    // @ts-expect-error — runtime callers may pass null
    expect(extractSignature(null)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte
npx vitest run tests/lib/canvas/stats/errorSignature.test.ts
```

Expected: FAIL — cannot resolve `$lib/canvas/stats/errorSignature`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/canvas/stats/errorSignature.ts

/**
 * Normalise an error string into a stable grouping key.
 *
 * Strips ANSI colour escapes, leading ISO timestamps, leading log-level
 * prefixes (ERROR, WARN, [error], etc.), collapses runs of whitespace,
 * and truncates to 80 characters. Used by the Error Explorer node to
 * group `node_executions.error` rows that are "the same failure" even
 * when their timestamps or callsite stacks differ slightly.
 */

const ANSI = /\[[0-9;]*m/g;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\s+/;
const LEVEL = /^\s*(\[)?(ERROR|WARN|INFO|DEBUG|TRACE)(\])?\s*:?\s+/i;
const WS = /\s+/g;

export function extractSignature(input: unknown): string {
  if (typeof input !== 'string') return '';
  let s = input.replace(ANSI, '');
  s = s.replace(ISO_TS, '');
  s = s.replace(LEVEL, '');
  s = s.replace(WS, ' ').trim();
  if (s.length > 80) s = s.slice(0, 80);
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/lib/canvas/stats/errorSignature.test.ts
```

Expected: PASS — all 7 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/stats/errorSignature.ts tests/lib/canvas/stats/errorSignature.test.ts
git commit -m "feat(observability): extractSignature helper for error grouping"
```

---

## Task 2: Extend `/stats/summary` with cost / tokens / cache aggregates

**Why:** Summary is the canvas's headline observability node. Foundation populated the cost columns; now Summary surfaces them.

**Files:**
- Modify: `src/routes/api/canvas/[slug]/stats/summary/+server.ts`

- [ ] **Step 1: Read the current endpoint to understand the shape**

```bash
cat src/routes/api/canvas/[slug]/stats/summary/+server.ts | head -80
```

- [ ] **Step 2: Extend the response to include cost/tokens/cache**

Replace the existing `// Counters` block and the final `return json({...})` so the response shape adds `counters.totalCostUsd`, `counters.tokensInput`, `counters.tokensOutput`, `counters.cacheHitRate`.

Add this query alongside the existing `rows` query (uses the same period window, joined into `node_executions`):

```ts
// Cost / token aggregates over node_executions for runs in the window.
const costRow = await db.execute<{
  total_cost: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cache_read: number | null;
}>(sql`
  SELECT
    COALESCE(SUM(ne.cost_usd), 0)::text       AS total_cost,
    COALESCE(SUM(ne.tokens_input), 0)::int    AS tokens_in,
    COALESCE(SUM(ne.tokens_output), 0)::int   AS tokens_out,
    COALESCE(SUM(ne.cache_read_tokens), 0)::int AS cache_read
  FROM node_executions ne
  INNER JOIN workflow_runs wr ON wr.id = ne.run_id
  WHERE wr.workflow_id = ${wf.id}
    AND wr.started_at >= ${period.from}
    AND wr.started_at < ${period.to}
`);

const cost = costRow.rows[0];
const totalCostUsd = cost ? Number(cost.total_cost) : 0;
const tokensInput = cost ? Number(cost.tokens_in) : 0;
const tokensOutput = cost ? Number(cost.tokens_out) : 0;
const cacheReadTokens = cost ? Number(cost.cache_read) : 0;
const cacheHitRate = tokensInput > 0 ? cacheReadTokens / tokensInput : 0;
```

Then extend the returned `counters` object:

```ts
data: {
  counters: {
    runs,
    success,
    failed,
    healing,
    successRate,
    avgDurationMs,
    totalCostUsd,
    tokensInput,
    tokensOutput,
    cacheHitRate,
  },
  sparkline,
  recentRuns,
  recentEdits,
},
```

- [ ] **Step 3: Restart dev server and curl-verify shape**

```bash
# in another shell, or restart whatever is running
npm run dev &
# wait a few seconds, then:
curl -sS 'http://localhost:5173/api/canvas/<existing-slug>/stats/summary?period=7d' | jq .data.counters
```

Expected: object now contains `totalCostUsd`, `tokensInput`, `tokensOutput`, `cacheHitRate` (numbers; zero is fine when no LLM nodes have run yet).

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/canvas/[slug]/stats/summary/+server.ts
git commit -m "feat(stats): surface cost+tokens+cache aggregates in /stats/summary"
```

---

## Task 3: Extend `/stats/per-node` with cost / tokens / cache columns

**Why:** Per-Node table will gain three new columns; backend exposes them.

**Files:**
- Modify: `src/routes/api/canvas/[slug]/stats/per-node/+server.ts`

- [ ] **Step 1: Locate the aggregating SQL**

The endpoint already groups by `ne.node_id` and computes `runs / success / failed / avg_ms / p95_ms / min_ms / max_ms / total_ms / last_run_at`. Add four columns alongside.

- [ ] **Step 2: Add the columns to the aggregate query**

Find the `SELECT` inside the `db.execute<...>(...)` block and add:

```ts
COALESCE(SUM(ne.cost_usd), 0)            AS cost_usd,
COALESCE(SUM(ne.tokens_input), 0)::int   AS tokens_in,
COALESCE(SUM(ne.tokens_output), 0)::int  AS tokens_out,
COALESCE(SUM(ne.cache_read_tokens), 0)::int AS cache_read,
```

Extend the `aggRows` row type:

```ts
const aggRows = await db.execute<{
  node_id: string;
  runs: number;
  success: number;
  failed: number;
  avg_ms: number | null;
  p95_ms: number | null;
  min_ms: number | null;
  max_ms: number | null;
  total_ms: number | null;
  last_run_at: Date | null;
  cost_usd: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cache_read: number | null;
}>(sql`
  SELECT
    ne.node_id AS node_id,
    COUNT(*)::int AS runs,
    COUNT(*) FILTER (WHERE ne.status = 'completed')::int AS success,
    COUNT(*) FILTER (WHERE ne.status = 'failed')::int AS failed,
    AVG(EXTRACT(EPOCH FROM (ne.completed_at - ne.started_at)) * 1000)
      FILTER (WHERE ne.completed_at IS NOT NULL) AS avg_ms,
    percentile_cont(0.95) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (ne.completed_at - ne.started_at)) * 1000
    ) FILTER (WHERE ne.completed_at IS NOT NULL) AS p95_ms,
    MIN(EXTRACT(EPOCH FROM (ne.completed_at - ne.started_at)) * 1000)
      FILTER (WHERE ne.completed_at IS NOT NULL) AS min_ms,
    MAX(EXTRACT(EPOCH FROM (ne.completed_at - ne.started_at)) * 1000)
      FILTER (WHERE ne.completed_at IS NOT NULL) AS max_ms,
    SUM(EXTRACT(EPOCH FROM (ne.completed_at - ne.started_at)) * 1000)
      FILTER (WHERE ne.completed_at IS NOT NULL) AS total_ms,
    MAX(ne.completed_at) AS last_run_at,
    COALESCE(SUM(ne.cost_usd), 0) AS cost_usd,
    COALESCE(SUM(ne.tokens_input), 0)::int AS tokens_in,
    COALESCE(SUM(ne.tokens_output), 0)::int AS tokens_out,
    COALESCE(SUM(ne.cache_read_tokens), 0)::int AS cache_read
  FROM node_executions ne
  INNER JOIN workflow_runs wr ON wr.id = ne.run_id
  WHERE wr.workflow_id = ${wf.id}
    AND wr.started_at >= ${period.from}
    AND wr.started_at < ${period.to}
    AND ne.node_id IN (${nodeIdList})
  GROUP BY ne.node_id
`);
```

Extend the per-node result mapping:

```ts
return {
  nodeId: n.id,
  label: n.label,
  type: n.type,
  runs: agg ? Number(agg.runs) : 0,
  success: agg ? Number(agg.success) : 0,
  failed: agg ? Number(agg.failed) : 0,
  avgMs: numOrNull(agg?.avg_ms),
  p95Ms: numOrNull(agg?.p95_ms),
  minMs: numOrNull(agg?.min_ms),
  maxMs: numOrNull(agg?.max_ms),
  totalMs: numOrNull(agg?.total_ms),
  lastRunAt: agg?.last_run_at ? new Date(agg.last_run_at).toISOString() : null,
  lastError: err
    ? { at: new Date(err.completed_at).toISOString(), message: err.error }
    : null,
  costUsd: agg ? Number(agg.cost_usd) : 0,
  tokensInput: agg ? Number(agg.tokens_in) : 0,
  tokensOutput: agg ? Number(agg.tokens_out) : 0,
  cacheReadTokens: agg ? Number(agg.cache_read) : 0,
};
```

- [ ] **Step 3: curl-verify**

```bash
curl -sS 'http://localhost:5173/api/canvas/<existing-slug>/stats/per-node?period=7d' | jq '.data.nodes[0]'
```

Expected: each node row includes `costUsd`, `tokensInput`, `tokensOutput`, `cacheReadTokens`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/canvas/[slug]/stats/per-node/+server.ts
git commit -m "feat(stats): surface cost+tokens+cache columns in /stats/per-node"
```

---

## Task 4: Extend `/stats/trends` with cost-by-model + prior-period overlay

**Why:** Trends gets a new track and prior-period chart overlay.

**Files:**
- Modify: `src/routes/api/canvas/[slug]/stats/trends/+server.ts`

- [ ] **Step 1: Read current trends endpoint**

```bash
cat src/routes/api/canvas/[slug]/stats/trends/+server.ts
```

- [ ] **Step 2: Add prior-period window**

After the existing `period` resolution, compute a prior-period window of equal length immediately before:

```ts
const periodMs = period.to.getTime() - period.from.getTime();
const priorFrom = new Date(period.from.getTime() - periodMs);
const priorTo = period.from;
```

- [ ] **Step 3: Add cost-by-model query**

```ts
const costByModelRows = await db.execute<{
  bucket: Date;
  model: string | null;
  cost_usd: string;
}>(sql`
  SELECT
    date_trunc(${period.granularity}, wr.started_at) AS bucket,
    ne.model AS model,
    COALESCE(SUM(ne.cost_usd), 0) AS cost_usd
  FROM node_executions ne
  INNER JOIN workflow_runs wr ON wr.id = ne.run_id
  WHERE wr.workflow_id = ${wf.id}
    AND wr.started_at >= ${period.from}
    AND wr.started_at < ${period.to}
    AND ne.cost_usd IS NOT NULL
  GROUP BY bucket, ne.model
  ORDER BY bucket, ne.model
`);

const costByModel = costByModelRows.rows.map((r) => ({
  t: (r.bucket instanceof Date ? r.bucket : new Date(r.bucket as unknown as string)).toISOString(),
  model: r.model ?? 'unknown',
  costUsd: Number(r.cost_usd),
}));
```

- [ ] **Step 4: Add prior-period run-count buckets**

Run-count by bucket for the PRIOR window — mirrors the existing in-window bucket query:

```ts
const priorBuckets = await db.execute<{ bucket: Date; total: number }>(sql`
  SELECT
    date_trunc(${period.granularity}, wr.started_at) AS bucket,
    COUNT(*)::int AS total
  FROM workflow_runs wr
  WHERE wr.workflow_id = ${wf.id}
    AND wr.started_at >= ${priorFrom}
    AND wr.started_at < ${priorTo}
  GROUP BY bucket
  ORDER BY bucket
`);

const priorRunsByBucket = priorBuckets.rows.map((r) => ({
  t: (r.bucket instanceof Date ? r.bucket : new Date(r.bucket as unknown as string)).toISOString(),
  count: Number(r.total),
}));
```

- [ ] **Step 5: Extend the returned `data` object**

```ts
data: {
  buckets, // existing
  recentRuns, // existing
  costByModel,
  priorRunsByBucket,
},
```

- [ ] **Step 6: curl-verify**

```bash
curl -sS 'http://localhost:5173/api/canvas/<existing-slug>/stats/trends?period=7d' | jq '{costByModel: .data.costByModel[:3], priorRunsByBucket: .data.priorRunsByBucket[:3]}'
```

Expected: both arrays exist (may be empty if no data).

- [ ] **Step 7: Commit**

```bash
git add src/routes/api/canvas/[slug]/stats/trends/+server.ts
git commit -m "feat(stats): cost-by-model track + prior-period buckets in /stats/trends"
```

---

## Task 5: New `/stats/per-node/[id]/series` endpoint

**Why:** Per-Node drill-down (P5.3) needs a time-series for one node by metric.

**Files:**
- Create: `src/routes/api/canvas/[slug]/stats/per-node/[id]/series/+server.ts`

- [ ] **Step 1: Create the endpoint**

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { resolvePeriod } from '$lib/canvas/stats/resolvePeriod';

function canvasWorkflowName(slug: string): string {
  return `canvas:${slug}`;
}

type Metric = 'duration' | 'cost' | 'runs' | 'cache';

export const GET: RequestHandler = async ({ params, url }) => {
  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.name, canvasWorkflowName(params.slug)));
  if (!wf) return json({ error: 'Canvas not found' }, { status: 404 });

  const [node] = await db
    .select({ id: workflowNodes.id })
    .from(workflowNodes)
    .where(and(eq(workflowNodes.id, params.id), eq(workflowNodes.workflowId, wf.id)));
  if (!node) return json({ error: 'Node not found in this canvas' }, { status: 404 });

  const metric = (url.searchParams.get('metric') ?? 'duration') as Metric;

  const [earliestRow] = await db
    .select({ t: workflowRuns.startedAt })
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, wf.id))
    .orderBy(workflowRuns.startedAt)
    .limit(1);
  const period = resolvePeriod(
    url.searchParams.get('period'),
    new Date(),
    earliestRow?.t ?? undefined,
  );

  let rows: Array<{ t: string } & Record<string, number | null>> = [];

  if (metric === 'duration') {
    const r = await db.execute<{
      bucket: Date;
      p50: number | null;
      p95: number | null;
      avg: number | null;
      max: number | null;
    }>(sql`
      SELECT
        date_trunc(${period.granularity}, wr.started_at) AS bucket,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (ne.completed_at - ne.started_at)) * 1000
        ) AS p50,
        percentile_cont(0.95) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (ne.completed_at - ne.started_at)) * 1000
        ) AS p95,
        AVG(EXTRACT(EPOCH FROM (ne.completed_at - ne.started_at)) * 1000) AS avg,
        MAX(EXTRACT(EPOCH FROM (ne.completed_at - ne.started_at)) * 1000) AS max
      FROM node_executions ne
      INNER JOIN workflow_runs wr ON wr.id = ne.run_id
      WHERE ne.node_id = ${params.id}
        AND wr.started_at >= ${period.from}
        AND wr.started_at < ${period.to}
        AND ne.completed_at IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket
    `);
    rows = r.rows.map((x) => ({
      t: (x.bucket instanceof Date ? x.bucket : new Date(x.bucket as unknown as string)).toISOString(),
      p50: x.p50 !== null ? Number(x.p50) : null,
      p95: x.p95 !== null ? Number(x.p95) : null,
      avg: x.avg !== null ? Number(x.avg) : null,
      max: x.max !== null ? Number(x.max) : null,
    }));
  } else if (metric === 'cost') {
    const r = await db.execute<{ bucket: Date; cost_usd: string | null }>(sql`
      SELECT
        date_trunc(${period.granularity}, wr.started_at) AS bucket,
        COALESCE(SUM(ne.cost_usd), 0) AS cost_usd
      FROM node_executions ne
      INNER JOIN workflow_runs wr ON wr.id = ne.run_id
      WHERE ne.node_id = ${params.id}
        AND wr.started_at >= ${period.from}
        AND wr.started_at < ${period.to}
      GROUP BY bucket
      ORDER BY bucket
    `);
    rows = r.rows.map((x) => ({
      t: (x.bucket instanceof Date ? x.bucket : new Date(x.bucket as unknown as string)).toISOString(),
      value: x.cost_usd !== null ? Number(x.cost_usd) : 0,
    }));
  } else if (metric === 'runs') {
    const r = await db.execute<{ bucket: Date; n: number }>(sql`
      SELECT
        date_trunc(${period.granularity}, wr.started_at) AS bucket,
        COUNT(*)::int AS n
      FROM node_executions ne
      INNER JOIN workflow_runs wr ON wr.id = ne.run_id
      WHERE ne.node_id = ${params.id}
        AND wr.started_at >= ${period.from}
        AND wr.started_at < ${period.to}
      GROUP BY bucket
      ORDER BY bucket
    `);
    rows = r.rows.map((x) => ({
      t: (x.bucket instanceof Date ? x.bucket : new Date(x.bucket as unknown as string)).toISOString(),
      value: Number(x.n),
    }));
  } else if (metric === 'cache') {
    const r = await db.execute<{
      bucket: Date;
      cache_read: number | null;
      tokens_in: number | null;
    }>(sql`
      SELECT
        date_trunc(${period.granularity}, wr.started_at) AS bucket,
        COALESCE(SUM(ne.cache_read_tokens), 0)::int AS cache_read,
        COALESCE(SUM(ne.tokens_input), 0)::int AS tokens_in
      FROM node_executions ne
      INNER JOIN workflow_runs wr ON wr.id = ne.run_id
      WHERE ne.node_id = ${params.id}
        AND wr.started_at >= ${period.from}
        AND wr.started_at < ${period.to}
      GROUP BY bucket
      ORDER BY bucket
    `);
    rows = r.rows.map((x) => {
      const inT = Number(x.tokens_in ?? 0);
      const cache = Number(x.cache_read ?? 0);
      return {
        t: (x.bucket instanceof Date ? x.bucket : new Date(x.bucket as unknown as string)).toISOString(),
        value: inT > 0 ? cache / inT : 0,
      };
    });
  }

  return json({
    window: {
      preset: period.preset,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      granularity: period.granularity,
    },
    data: { metric, rows },
  });
};
```

- [ ] **Step 2: curl-verify each metric**

```bash
for m in duration cost runs cache; do
  echo "== $m =="
  curl -sS "http://localhost:5173/api/canvas/<slug>/stats/per-node/<nodeId>/series?metric=$m&period=7d" | jq '.data.rows[:2]'
done
```

Expected: all four succeed; duration returns p50/p95/avg/max keys; others return a `value` key.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/canvas/[slug]/stats/per-node/[id]/series/+server.ts
git commit -m "feat(stats): per-node metric time-series endpoint"
```

---

## Task 6: New `/stats/run-timeline` endpoint

**Why:** Run Timeline node needs per-node breakdown for a specific run.

**Files:**
- Create: `src/routes/api/canvas/[slug]/stats/run-timeline/+server.ts`

- [ ] **Step 1: Create the endpoint**

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

function canvasWorkflowName(slug: string): string {
  return `canvas:${slug}`;
}

export const GET: RequestHandler = async ({ params, url }) => {
  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.name, canvasWorkflowName(params.slug)));
  if (!wf) return json({ error: 'Canvas not found' }, { status: 404 });

  // Resolve runId — explicit query param OR most recent run for this canvas.
  let runId = url.searchParams.get('runId');
  if (!runId) {
    const [latest] = await db
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, wf.id))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(1);
    runId = latest?.id ?? null;
  }
  if (!runId) return json({ run: null, recent: [], nodes: [] });

  const [run] = await db
    .select({
      id: workflowRuns.id,
      status: workflowRuns.status,
      startedAt: workflowRuns.startedAt,
      completedAt: workflowRuns.completedAt,
    })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.workflowId, wf.id)));
  if (!run) return json({ error: 'Run not found in this canvas' }, { status: 404 });

  // Last 50 runs for the picker.
  const recent = await db
    .select({
      id: workflowRuns.id,
      status: workflowRuns.status,
      startedAt: workflowRuns.startedAt,
      completedAt: workflowRuns.completedAt,
    })
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, wf.id))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(50);

  // Per-node bars for the focused run.
  const execs = await db
    .select({
      nodeId: nodeExecutions.nodeId,
      status: nodeExecutions.status,
      startedAt: nodeExecutions.startedAt,
      completedAt: nodeExecutions.completedAt,
      error: nodeExecutions.error,
      costUsd: nodeExecutions.costUsd,
      label: workflowNodes.label,
      type: workflowNodes.type,
    })
    .from(nodeExecutions)
    .innerJoin(workflowNodes, eq(workflowNodes.id, nodeExecutions.nodeId))
    .where(eq(nodeExecutions.runId, runId))
    .orderBy(nodeExecutions.startedAt);

  return json({
    run: {
      id: run.id,
      status: run.status,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
    },
    recent: recent.map((r) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      durationMs:
        r.startedAt && r.completedAt
          ? r.completedAt.getTime() - r.startedAt.getTime()
          : null,
    })),
    nodes: execs.map((e) => ({
      nodeId: e.nodeId,
      label: e.label,
      type: e.type,
      status: e.status,
      startedAt: e.startedAt?.toISOString() ?? null,
      completedAt: e.completedAt?.toISOString() ?? null,
      durationMs:
        e.startedAt && e.completedAt
          ? e.completedAt.getTime() - e.startedAt.getTime()
          : null,
      error: e.error,
      costUsd: e.costUsd !== null ? Number(e.costUsd) : null,
    })),
  });
};
```

- [ ] **Step 2: curl-verify**

```bash
curl -sS 'http://localhost:5173/api/canvas/<slug>/stats/run-timeline' | jq '{run: .run, recentCount: (.recent | length), nodes: .nodes[:2]}'
```

Expected: response with `run` object, recent list (up to 50), and an array of node bars sorted by startedAt.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/canvas/[slug]/stats/run-timeline/+server.ts
git commit -m "feat(stats): run-timeline endpoint for Gantt view"
```

---

## Task 7: New `/stats/errors` endpoint

**Why:** Error Explorer groups failed executions by `errorSignature`.

**Files:**
- Create: `src/routes/api/canvas/[slug]/stats/errors/+server.ts`

- [ ] **Step 1: Create the endpoint**

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { and, desc, eq, gte, isNotNull, lt } from 'drizzle-orm';
import { resolvePeriod } from '$lib/canvas/stats/resolvePeriod';
import { extractSignature } from '$lib/canvas/stats/errorSignature';

function canvasWorkflowName(slug: string): string {
  return `canvas:${slug}`;
}

interface Group {
  signature: string;
  count: number;
  lastSeen: string;
  affectedNodeIds: string[];
  affectedNodeLabels: string[];
  recent: Array<{
    runId: string;
    nodeId: string;
    nodeLabel: string;
    at: string;
    error: string;
  }>;
}

export const GET: RequestHandler = async ({ params, url }) => {
  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.name, canvasWorkflowName(params.slug)));
  if (!wf) return json({ error: 'Canvas not found' }, { status: 404 });

  const [earliestRow] = await db
    .select({ t: workflowRuns.startedAt })
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, wf.id))
    .orderBy(workflowRuns.startedAt)
    .limit(1);
  const period = resolvePeriod(
    url.searchParams.get('period'),
    new Date(),
    earliestRow?.t ?? undefined,
  );

  const rows = await db
    .select({
      runId: nodeExecutions.runId,
      nodeId: nodeExecutions.nodeId,
      nodeLabel: workflowNodes.label,
      completedAt: nodeExecutions.completedAt,
      error: nodeExecutions.error,
    })
    .from(nodeExecutions)
    .innerJoin(workflowRuns, eq(workflowRuns.id, nodeExecutions.runId))
    .innerJoin(workflowNodes, eq(workflowNodes.id, nodeExecutions.nodeId))
    .where(
      and(
        eq(workflowRuns.workflowId, wf.id),
        eq(nodeExecutions.status, 'failed'),
        isNotNull(nodeExecutions.error),
        gte(workflowRuns.startedAt, period.from),
        lt(workflowRuns.startedAt, period.to),
      ),
    )
    .orderBy(desc(nodeExecutions.completedAt));

  const groups = new Map<string, Group>();
  for (const r of rows) {
    if (!r.error || !r.completedAt) continue;
    const sig = extractSignature(r.error);
    if (!sig) continue;

    let g = groups.get(sig);
    if (!g) {
      g = {
        signature: sig,
        count: 0,
        lastSeen: r.completedAt.toISOString(),
        affectedNodeIds: [],
        affectedNodeLabels: [],
        recent: [],
      };
      groups.set(sig, g);
    }
    g.count += 1;
    if (!g.affectedNodeIds.includes(r.nodeId)) {
      g.affectedNodeIds.push(r.nodeId);
      g.affectedNodeLabels.push(r.nodeLabel);
    }
    if (g.recent.length < 5) {
      g.recent.push({
        runId: r.runId,
        nodeId: r.nodeId,
        nodeLabel: r.nodeLabel,
        at: r.completedAt.toISOString(),
        error: r.error,
      });
    }
  }

  const out = Array.from(groups.values()).sort((a, b) => b.count - a.count);

  return json({
    window: {
      preset: period.preset,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      granularity: period.granularity,
    },
    data: { totalErrors: rows.length, groups: out },
  });
};
```

- [ ] **Step 2: curl-verify**

```bash
curl -sS 'http://localhost:5173/api/canvas/<slug>/stats/errors?period=30d' | jq '{total: .data.totalErrors, top: .data.groups[:2]}'
```

Expected: `total` integer; `top` array (empty if no failures).

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/canvas/[slug]/stats/errors/+server.ts
git commit -m "feat(stats): errors endpoint grouped by signature"
```

---

## Task 8: New `/stats/cost` endpoint

**Why:** Cost node consumes this for its headline + breakdown + drill-down.

**Files:**
- Create: `src/routes/api/canvas/[slug]/stats/cost/+server.ts`

- [ ] **Step 1: Create the endpoint**

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { and, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { resolvePeriod } from '$lib/canvas/stats/resolvePeriod';

function canvasWorkflowName(slug: string): string {
  return `canvas:${slug}`;
}

type GroupBy = 'model' | 'node-type' | 'node-label';

export const GET: RequestHandler = async ({ params, url }) => {
  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.name, canvasWorkflowName(params.slug)));
  if (!wf) return json({ error: 'Canvas not found' }, { status: 404 });

  const groupBy = (url.searchParams.get('groupBy') ?? 'model') as GroupBy;

  const [earliestRow] = await db
    .select({ t: workflowRuns.startedAt })
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, wf.id))
    .orderBy(workflowRuns.startedAt)
    .limit(1);
  const period = resolvePeriod(
    url.searchParams.get('period'),
    new Date(),
    earliestRow?.t ?? undefined,
  );

  // Total
  const totalRow = await db.execute<{ total: string | null }>(sql`
    SELECT COALESCE(SUM(ne.cost_usd), 0)::text AS total
    FROM node_executions ne
    INNER JOIN workflow_runs wr ON wr.id = ne.run_id
    WHERE wr.workflow_id = ${wf.id}
      AND wr.started_at >= ${period.from}
      AND wr.started_at < ${period.to}
  `);
  const totalUsd = totalRow.rows[0] ? Number(totalRow.rows[0].total) : 0;

  // Buckets, stacked by model (always model — model is the most useful
  // stack key for the trend chart; the breakdown table below changes by
  // groupBy).
  const bucketRows = await db.execute<{
    bucket: Date;
    model: string | null;
    cost_usd: string | null;
  }>(sql`
    SELECT
      date_trunc(${period.granularity}, wr.started_at) AS bucket,
      ne.model AS model,
      COALESCE(SUM(ne.cost_usd), 0) AS cost_usd
    FROM node_executions ne
    INNER JOIN workflow_runs wr ON wr.id = ne.run_id
    WHERE wr.workflow_id = ${wf.id}
      AND wr.started_at >= ${period.from}
      AND wr.started_at < ${period.to}
      AND ne.cost_usd IS NOT NULL
    GROUP BY bucket, ne.model
    ORDER BY bucket, ne.model
  `);

  const buckets = bucketRows.rows.map((r) => ({
    t: (r.bucket instanceof Date ? r.bucket : new Date(r.bucket as unknown as string)).toISOString(),
    model: r.model ?? 'unknown',
    costUsd: r.cost_usd !== null ? Number(r.cost_usd) : 0,
  }));

  // Breakdown by chosen dimension.
  let breakdown: Array<{
    key: string;
    costUsd: number;
    percentage: number;
    requests: number;
    avgCostPerRequest: number;
  }> = [];

  if (groupBy === 'model') {
    const r = await db.execute<{
      key: string | null;
      cost_usd: string;
      n: number;
    }>(sql`
      SELECT ne.model AS key,
             COALESCE(SUM(ne.cost_usd), 0) AS cost_usd,
             COUNT(*)::int AS n
      FROM node_executions ne
      INNER JOIN workflow_runs wr ON wr.id = ne.run_id
      WHERE wr.workflow_id = ${wf.id}
        AND wr.started_at >= ${period.from}
        AND wr.started_at < ${period.to}
        AND ne.cost_usd IS NOT NULL
      GROUP BY ne.model
      ORDER BY cost_usd DESC
    `);
    breakdown = r.rows.map((row) => {
      const cost = Number(row.cost_usd);
      const n = Number(row.n);
      return {
        key: row.key ?? 'unknown',
        costUsd: cost,
        percentage: totalUsd > 0 ? cost / totalUsd : 0,
        requests: n,
        avgCostPerRequest: n > 0 ? cost / n : 0,
      };
    });
  } else if (groupBy === 'node-type') {
    const r = await db.execute<{
      key: string;
      cost_usd: string;
      n: number;
    }>(sql`
      SELECT wn.type AS key,
             COALESCE(SUM(ne.cost_usd), 0) AS cost_usd,
             COUNT(*)::int AS n
      FROM node_executions ne
      INNER JOIN workflow_runs wr ON wr.id = ne.run_id
      INNER JOIN workflow_nodes wn ON wn.id = ne.node_id
      WHERE wr.workflow_id = ${wf.id}
        AND wr.started_at >= ${period.from}
        AND wr.started_at < ${period.to}
        AND ne.cost_usd IS NOT NULL
      GROUP BY wn.type
      ORDER BY cost_usd DESC
    `);
    breakdown = r.rows.map((row) => {
      const cost = Number(row.cost_usd);
      const n = Number(row.n);
      return {
        key: row.key,
        costUsd: cost,
        percentage: totalUsd > 0 ? cost / totalUsd : 0,
        requests: n,
        avgCostPerRequest: n > 0 ? cost / n : 0,
      };
    });
  } else {
    // node-label
    const r = await db.execute<{
      key: string;
      cost_usd: string;
      n: number;
    }>(sql`
      SELECT wn.label AS key,
             COALESCE(SUM(ne.cost_usd), 0) AS cost_usd,
             COUNT(*)::int AS n
      FROM node_executions ne
      INNER JOIN workflow_runs wr ON wr.id = ne.run_id
      INNER JOIN workflow_nodes wn ON wn.id = ne.node_id
      WHERE wr.workflow_id = ${wf.id}
        AND wr.started_at >= ${period.from}
        AND wr.started_at < ${period.to}
        AND ne.cost_usd IS NOT NULL
      GROUP BY wn.label
      ORDER BY cost_usd DESC
    `);
    breakdown = r.rows.map((row) => {
      const cost = Number(row.cost_usd);
      const n = Number(row.n);
      return {
        key: row.key,
        costUsd: cost,
        percentage: totalUsd > 0 ? cost / totalUsd : 0,
        requests: n,
        avgCostPerRequest: n > 0 ? cost / n : 0,
      };
    });
  }

  return json({
    window: {
      preset: period.preset,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      granularity: period.granularity,
    },
    data: { totalUsd, buckets, breakdown, groupBy },
  });
};
```

- [ ] **Step 2: curl-verify each grouping**

```bash
for g in model node-type node-label; do
  echo "== $g =="
  curl -sS "http://localhost:5173/api/canvas/<slug>/stats/cost?period=30d&groupBy=$g" | jq '{total: .data.totalUsd, top: .data.breakdown[:3]}'
done
```

Expected: `total` number; `top` array sorted by cost descending; `groupBy` echoed.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/canvas/[slug]/stats/cost/+server.ts
git commit -m "feat(stats): cost endpoint with model/node-type/node-label breakdowns"
```

---

# Phase P5.2 — Existing-node refreshes

Four tasks. Each surfaces phase 5.1's new server data in an existing observability node.

## Task 9: `costFormat.ts` — money formatters + tests

**Why:** consistent money rendering across Summary, PerNode, Cost. Centralised so "$0.0042" vs "$12.00" choices live in one place.

**Files:**
- Create: `src/lib/canvas/stats/costFormat.ts`
- Test: `tests/lib/canvas/stats/costFormat.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/canvas/stats/costFormat.test.ts
import { describe, it, expect } from 'vitest';
import { formatUsd, formatTokens } from '$lib/canvas/stats/costFormat';

describe('formatUsd', () => {
  it('renders zero as $0.00', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });
  it('renders sub-cent values with 4 decimals', () => {
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(0.0001)).toBe('$0.0001');
  });
  it('renders cents with 2 decimals when under $1', () => {
    expect(formatUsd(0.42)).toBe('$0.42');
    expect(formatUsd(0.99)).toBe('$0.99');
  });
  it('renders dollars with 2 decimals when >= $1', () => {
    expect(formatUsd(1)).toBe('$1.00');
    expect(formatUsd(12.345)).toBe('$12.35');
    expect(formatUsd(1234)).toBe('$1,234.00');
  });
  it('renders null/undefined as em-dash', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(undefined)).toBe('—');
  });
});

describe('formatTokens', () => {
  it('renders 0/null/undefined as em-dash for null/undefined', () => {
    expect(formatTokens(null)).toBe('—');
    expect(formatTokens(undefined)).toBe('—');
  });
  it('renders thousands separators below 10k', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(9999)).toBe('9,999');
  });
  it('renders >= 10k with k suffix', () => {
    expect(formatTokens(10_000)).toBe('10k');
    expect(formatTokens(12_345)).toBe('12k');
    expect(formatTokens(999_999)).toBe('1000k');
  });
  it('renders >= 1M with m suffix', () => {
    expect(formatTokens(1_000_000)).toBe('1.0m');
    expect(formatTokens(2_500_000)).toBe('2.5m');
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npx vitest run tests/lib/canvas/stats/costFormat.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/canvas/stats/costFormat.ts

/** Adaptive USD formatter: sub-cent → 4 decimals, otherwise 2 decimals. */
export function formatUsd(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v === 0) return '$0.00';
  if (Math.abs(v) < 0.01) {
    return `$${v.toFixed(4)}`;
  }
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Token counter: thousands-separator below 10k, k/m suffix above. */
export function formatTokens(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v < 10_000) return v.toLocaleString('en-US');
  if (v < 1_000_000) return `${Math.round(v / 1000)}k`;
  return `${(v / 1_000_000).toFixed(1)}m`;
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run tests/lib/canvas/stats/costFormat.test.ts
```

Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/stats/costFormat.ts tests/lib/canvas/stats/costFormat.test.ts
git commit -m "feat(stats): formatUsd/formatTokens helpers"
```

---

## Task 10: SummaryNode — surface cost / tokens / cache counters

**Why:** the headline observability node should reflect the cost data that's been quietly accumulating since phase 2.

**Files:**
- Modify: `src/lib/canvas/stats/SummaryNode.svelte`

- [ ] **Step 1: Update the `SummaryData` interface**

Find the existing interface and extend `counters`:

```ts
interface SummaryData {
  counters: {
    runs: number;
    success: number;
    failed: number;
    healing: number;
    successRate: number;
    avgDurationMs: number | null;
    totalCostUsd: number;
    tokensInput: number;
    tokensOutput: number;
    cacheHitRate: number;
  };
  sparkline: Array<{ bucket: string; count: number }>;
  recentRuns: Array<{ id: string; status: string; startedAt: string; durationMs: number | null }>;
  recentEdits: Array<{ at: string; entity: string; action: string; details: Record<string, unknown> }>;
}
```

- [ ] **Step 2: Add formatter imports**

At the top of the script block:

```ts
import { formatUsd, formatTokens } from './costFormat';
```

- [ ] **Step 3: Replace the 5-cell counters block with an 8-cell grid**

Find the existing `<div class="counters">` block (5 counters) and replace with eight:

```svelte
<div class="counters">
  <div class="counter"><span class="v">{c.runs}</span><span class="l">runs</span></div>
  <div class="counter"><span class="v ok">{c.success}</span><span class="l">success</span></div>
  <div class="counter"><span class="v fail">{c.failed}</span><span class="l">failed</span></div>
  <div class="counter"><span class="v">{formatPercent(c.successRate)}</span><span class="l">rate</span></div>
  <div class="counter"><span class="v">{formatDurationMs(c.avgDurationMs)}</span><span class="l">avg dur</span></div>
  <div class="counter"><span class="v">{formatUsd(c.totalCostUsd)}</span><span class="l">spend</span></div>
  <div class="counter"><span class="v">{formatTokens(c.tokensInput)}→{formatTokens(c.tokensOutput)}</span><span class="l">tokens</span></div>
  <div class="counter"><span class="v">{formatPercent(c.cacheHitRate)}</span><span class="l">cache</span></div>
</div>
```

- [ ] **Step 4: Update the CSS grid to 8 columns**

In the `<style>` block, change the `.counters` rule:

```css
.counters { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 6px; }
```

(4 columns × 2 rows reads better than 8 in a row on the default 300px-wide Summary node.)

- [ ] **Step 5: Verify in dev**

Load any canvas that has a Summary node + a recent run with at least one LLM call. Confirm the new counters render.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canvas/stats/SummaryNode.svelte
git commit -m "feat(stats): cost+tokens+cache counters in SummaryNode"
```

---

## Task 11: TrendsNode — cost-by-model track + hover tooltips + prior-period overlay

**Why:** the new Trends data deserves UI. This is the densest single task in P5.2.

**Files:**
- Modify: `src/lib/canvas/stats/TrendsNode.svelte`

- [ ] **Step 1: Extend the `TrendsData` interface**

Add the two new arrays from the backend:

```ts
interface TrendsData {
  buckets: Array<{
    t: string;
    runs: { success: number; failed: number; healing: number };
    durationMs: { p50: number | null; p95: number | null; avg: number | null };
  }>;
  recentRuns: RecentRun[];
  costByModel: Array<{ t: string; model: string; costUsd: number }>;
  priorRunsByBucket: Array<{ t: string; count: number }>;
}
```

- [ ] **Step 2: Derive cost-track series + model legend**

After the existing `$derived` blocks, add:

```ts
const costByModelGrouped = $derived.by(() => {
  const map = new Map<string, Map<number, number>>(); // model -> bucketMs -> costUsd
  const models = new Set<string>();
  for (const row of stats.data?.costByModel ?? []) {
    models.add(row.model);
    const bucketMs = new Date(row.t).getTime();
    let mm = map.get(row.model);
    if (!mm) { mm = new Map(); map.set(row.model, mm); }
    mm.set(bucketMs, (mm.get(bucketMs) ?? 0) + row.costUsd);
  }
  return { map, models: [...models].sort() };
});

const showCostChart = $derived((stats.data?.costByModel?.length ?? 0) > 0);

const priorOverlay = $derived(
  (stats.data?.priorRunsByBucket ?? []).map((p) => ({
    t: new Date(p.t),
    v: p.count,
  })),
);
```

- [ ] **Step 3: Add a cost-by-model track to the layout**

Find the existing two `<Chart>` tracks. After them, add a third (mirror existing structure):

```svelte
{#if showCostChart}
  <div class="track">
    <div class="track-hd">cost · stacked by model</div>
    <Chart
      data={Array.from(costByModelGrouped.map.entries()).flatMap(([model, points]) =>
        Array.from(points.entries()).map(([t, v]) => ({ t: new Date(t), v, model })),
      )}
      x="t"
      y="v"
      xScale={scaleTime()}
      yScale={scaleLinear()}
    >
      <Svg>
        {#each costByModelGrouped.models as model (model)}
          <Area
            data={Array.from(costByModelGrouped.map.get(model)?.entries() ?? []).map(([t, v]) => ({ t: new Date(t), v }))}
            fill={colorForModel(model)}
            fillOpacity={0.4}
            stroke={colorForModel(model)}
            strokeWidth={1}
          />
        {/each}
      </Svg>
    </Chart>
    <div class="legend">
      {#each costByModelGrouped.models as model (model)}
        <span class="legend-item"><span class="sw" style:background={colorForModel(model)}></span>{model}</span>
      {/each}
    </div>
  </div>
{/if}
```

Add the `colorForModel` helper at the bottom of the script block:

```ts
function colorForModel(model: string): string {
  // Deterministic colour from model name — same model always gets the
  // same hue across renders, while distinct models stay visually separated.
  let hash = 0;
  for (let i = 0; i < model.length; i++) hash = (hash * 31 + model.charCodeAt(i)) | 0;
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}
```

- [ ] **Step 4: Add a prior-period overlay to the run-volume chart**

In the existing run-volume `<Chart>` block, add a second `<Spline>` underneath the primary one:

```svelte
<Spline data={priorOverlay} x="t" y="v" stroke="var(--text-muted, #888)" strokeWidth={1} strokeDasharray="2 3" opacity={0.6} />
```

- [ ] **Step 5: Add hover tooltips on existing charts**

`layerchart` exposes a `<Highlight>` + `<Tooltip>` pattern. In each existing chart's `<Svg>`, add:

```svelte
<Highlight points lines />
<Tooltip header={(d) => new Date(d.t).toLocaleString()} let:data>
  <div>{data.v}</div>
</Tooltip>
```

(If layerchart's API differs in this repo's version, fall back to a manual hover overlay using `<rect>` + a `$state` for the hovered datum — but try Highlight/Tooltip first.)

- [ ] **Step 6: Verify in dev**

Reload the canvas. Hover the existing tracks → tooltips render. Run a workflow with LLM nodes → cost track populates. Switch the period filter to "7d" with prior data available → faint dashed prior-period line appears on the volume track.

- [ ] **Step 7: Commit**

```bash
git add src/lib/canvas/stats/TrendsNode.svelte
git commit -m "feat(stats): cost-by-model track + tooltips + prior-period overlay in Trends"
```

---

## Task 12: PerNodeNode — add cost / tokens / cache columns

**Why:** the table now has the data; show it.

**Files:**
- Modify: `src/lib/canvas/stats/PerNodeNode.svelte`

- [ ] **Step 1: Extend `PerNodeRow` interface**

```ts
interface PerNodeRow {
  nodeId: string;
  label: string;
  type: string;
  runs: number;
  success: number;
  failed: number;
  avgMs: number | null;
  p95Ms: number | null;
  minMs: number | null;
  maxMs: number | null;
  totalMs: number | null;
  lastRunAt: string | null;
  lastError: { at: string; message: string } | null;
  costUsd: number;
  tokensInput: number;
  tokensOutput: number;
  cacheReadTokens: number;
}
```

- [ ] **Step 2: Add formatter imports + a `cost` sort key**

```ts
import { formatUsd, formatTokens } from './costFormat';

type SortKey =
  | 'label'
  | 'runs'
  | 'failed'
  | 'successRate'
  | 'avgMs'
  | 'p95Ms'
  | 'totalMs'
  | 'lastRunAt'
  | 'costUsd';
```

In the sort `$derived.by`, add the new branch:

```ts
} else if (sortKey === 'costUsd') {
  av = a.costUsd;
  bv = b.costUsd;
```

- [ ] **Step 3: Add the new `<th>` and `<td>`s**

In the table `<thead>`, add a `Cost` column after `Total`:

```svelte
<th
  onclick={() => toggleSort('costUsd')}
  class:active={sortKey === 'costUsd'}
  class="num"
  title="Sum of LLM cost across all runs in this window"
>
  Cost
</th>
<th class="num" title="Total prompt → completion tokens">Tokens</th>
<th class="num" title="Cache-read tokens as a fraction of prompt tokens">Cache</th>
```

In the `<tbody>` row (the existing main row, before `{#if isOpen}`), add three cells matching:

```svelte
<td class="num">{formatUsd(r.costUsd)}</td>
<td class="num">{formatTokens(r.tokensInput)}→{formatTokens(r.tokensOutput)}</td>
<td class="num">{r.tokensInput > 0 ? formatPercent(r.cacheReadTokens / r.tokensInput) : '—'}</td>
```

- [ ] **Step 4: Bump the colspan on the existing detail row**

Find `<td colspan="8">` inside the `{#if isOpen}` block and change to `colspan="11"` (existing 8 + 3 new columns).

- [ ] **Step 5: Verify in dev**

Reload the canvas. The Per-Node table now has 3 more columns; sorting by Cost works.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canvas/stats/PerNodeNode.svelte
git commit -m "feat(stats): cost+tokens+cache columns in PerNodeNode"
```

---

# Phase P5.3 — Per-Node drill-down

Two tasks: build the drilldown component, then wire it into PerNodeNode's row expansion.

## Task 13: `PerNodeDrilldown.svelte` — chart + metric tabs + time-range pill

**Files:**
- Create: `src/lib/canvas/stats/PerNodeDrilldown.svelte`

- [ ] **Step 1: Create the component shell**

```svelte
<script lang="ts">
  import { Chart, Svg, Spline, Area, Highlight } from 'layerchart';
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { formatUsd, formatTokens } from './costFormat';
  import { formatDurationMs, formatPercent } from './format';

  type Metric = 'duration' | 'cost' | 'runs' | 'cache';
  type Range = '1h' | '6h' | '24h' | '7d' | '30d' | 'all';

  interface Props {
    slug: string;
    nodeId: string;
    /** Initial range from the canvas-wide TimeFilter; the drill-down can override. */
    defaultRange: Range;
    /** Bumps when the canvas-wide live stream signals a relevant event. */
    refreshKey?: number;
  }
  let { slug, nodeId, defaultRange, refreshKey = 0 }: Props = $props();

  let metric = $state<Metric>('duration');
  let range = $state<Range>(defaultRange);

  interface SeriesPoint {
    t: string;
    // duration metric: p50/p95/avg/max
    p50?: number | null;
    p95?: number | null;
    avg?: number | null;
    max?: number | null;
    // others: value
    value?: number | null;
  }

  let series = $state<SeriesPoint[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const url = `/api/canvas/${encodeURIComponent(slug)}/stats/per-node/${encodeURIComponent(nodeId)}/series?metric=${metric}&period=${range}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: { rows: SeriesPoint[] } };
      series = body.data.rows;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    metric; range; refreshKey;
    load();
  });

  // Summary stats derived from the current series.
  const summary = $derived.by(() => {
    if (metric === 'duration') {
      const avgs = series.map((s) => s.avg).filter((v): v is number => v != null);
      const max = avgs.length ? Math.max(...avgs) : null;
      const median = avgs.length ? avgs.slice().sort((a, b) => a - b)[Math.floor(avgs.length / 2)] : null;
      const p95s = series.map((s) => s.p95).filter((v): v is number => v != null);
      const p95 = p95s.length ? Math.max(...p95s) : null;
      const avg = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
      return { avg, median, max, p95 };
    }
    const vals = series.map((s) => s.value).filter((v): v is number => v != null);
    const sum = vals.reduce((a, b) => a + b, 0);
    const avg = vals.length ? sum / vals.length : null;
    const max = vals.length ? Math.max(...vals) : null;
    return { sum, avg, max };
  });
</script>

<div class="drill">
  <header>
    <div class="tabs" role="tablist">
      {#each ['duration', 'cost', 'runs', 'cache'] as m (m)}
        <button
          role="tab"
          class:active={metric === m}
          onclick={() => (metric = m as Metric)}
        >{m}</button>
      {/each}
    </div>
    <select bind:value={range} class="range">
      <option value="1h">1h</option>
      <option value="6h">6h</option>
      <option value="24h">24h</option>
      <option value="7d">7d</option>
      <option value="30d">30d</option>
      <option value="all">all</option>
    </select>
  </header>

  {#if loading && series.length === 0}
    <div class="skel">Loading…</div>
  {:else if error}
    <div class="error-strip">{error}</div>
  {:else if series.length === 0}
    <div class="empty">No data in this window</div>
  {:else}
    <div class="chart">
      {#if metric === 'duration'}
        <Chart
          data={series.map((s) => ({ t: new Date(s.t), p50: s.p50 ?? 0, p95: s.p95 ?? 0, avg: s.avg ?? 0 }))}
          x="t"
          xScale={scaleTime()}
          yScale={scaleLinear()}
        >
          <Svg>
            <Area y="p95" fill="var(--accent)" fillOpacity={0.15} />
            <Spline y="p50" stroke="var(--accent)" strokeWidth={1.2} />
            <Spline y="avg" stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="2 3" />
            <Highlight points lines />
          </Svg>
        </Chart>
      {:else}
        <Chart
          data={series.map((s) => ({ t: new Date(s.t), v: s.value ?? 0 }))}
          x="t"
          y="v"
          xScale={scaleTime()}
          yScale={scaleLinear()}
        >
          <Svg>
            <Area fill="var(--accent)" fillOpacity={0.15} />
            <Spline stroke="var(--accent)" strokeWidth={1.5} />
            <Highlight points lines />
          </Svg>
        </Chart>
      {/if}
    </div>

    <div class="summary">
      {#if metric === 'duration'}
        <span class="kv"><span class="k">avg</span><span class="v">{formatDurationMs((summary as { avg: number | null }).avg)}</span></span>
        <span class="kv"><span class="k">median</span><span class="v">{formatDurationMs((summary as { median: number | null }).median)}</span></span>
        <span class="kv"><span class="k">p95</span><span class="v">{formatDurationMs((summary as { p95: number | null }).p95)}</span></span>
        <span class="kv"><span class="k">max</span><span class="v">{formatDurationMs((summary as { max: number | null }).max)}</span></span>
      {:else if metric === 'cost'}
        <span class="kv"><span class="k">sum</span><span class="v">{formatUsd((summary as { sum: number }).sum)}</span></span>
        <span class="kv"><span class="k">avg/bucket</span><span class="v">{formatUsd((summary as { avg: number | null }).avg)}</span></span>
        <span class="kv"><span class="k">max/bucket</span><span class="v">{formatUsd((summary as { max: number | null }).max)}</span></span>
      {:else if metric === 'runs'}
        <span class="kv"><span class="k">total</span><span class="v">{(summary as { sum: number }).sum}</span></span>
        <span class="kv"><span class="k">avg/bucket</span><span class="v">{(summary as { avg: number | null }).avg?.toFixed(1) ?? '—'}</span></span>
        <span class="kv"><span class="k">max/bucket</span><span class="v">{(summary as { max: number | null }).max ?? '—'}</span></span>
      {:else}
        <span class="kv"><span class="k">avg hit rate</span><span class="v">{formatPercent((summary as { avg: number | null }).avg ?? 0)}</span></span>
        <span class="kv"><span class="k">peak</span><span class="v">{formatPercent((summary as { max: number | null }).max ?? 0)}</span></span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .drill {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font: 10px / 1.4 ui-monospace, Menlo, monospace;
    color: var(--text-primary, #e6e6e6);
    padding: 6px 0;
  }
  header { display: flex; justify-content: space-between; align-items: center; }
  .tabs { display: flex; gap: 2px; }
  .tabs button {
    background: transparent;
    border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
    color: var(--text-muted, #888);
    padding: 2px 8px;
    border-radius: 3px;
    font: inherit;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .tabs button.active {
    background: var(--accent, #3a8a56);
    color: white;
    border-color: var(--accent, #3a8a56);
  }
  .range {
    background: transparent;
    border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
    color: var(--text-primary, #e6e6e6);
    padding: 1px 4px;
    font: inherit;
  }
  .chart { height: 180px; }
  .summary { display: flex; gap: 12px; flex-wrap: wrap; }
  .kv { display: flex; gap: 4px; align-items: baseline; }
  .kv .k { color: var(--text-muted, #888); font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
  .kv .v { font-weight: 600; }
  .empty, .skel { color: var(--text-muted, #888); font-style: italic; padding: 12px; text-align: center; }
  .error-strip { color: #c44; font-size: 10px; padding: 4px; border: 1px solid #c44; border-radius: 4px; }
</style>
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ~/strange_rambling_svelte
NODE_OPTIONS=--max-old-space-size=8192 npm run check 2>&1 | grep -E "PerNodeDrilldown"
```

Expected: no errors mentioning the new file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/canvas/stats/PerNodeDrilldown.svelte
git commit -m "feat(stats): PerNodeDrilldown component (charts + tabs + range pill)"
```

---

## Task 14: Wire `PerNodeDrilldown` into PerNodeNode row expansion

**Why:** the existing expanded panel is a 4-cell min/max/total grid. Replace with the drill-down.

**Files:**
- Modify: `src/lib/canvas/stats/PerNodeNode.svelte`

- [ ] **Step 1: Import the component + period prop**

At the top of the script block:

```ts
import PerNodeDrilldown from './PerNodeDrilldown.svelte';
```

Add `period` to the props (mirroring the other stats nodes):

```ts
interface Props {
  slug: string;
  period: string;
  refreshKey?: number;
  onrowclick?: (nodeId: string) => void;
}
let { slug, period, refreshKey = 0, onrowclick }: Props = $props();
```

(If `period` already exists on the props, this is a no-op.)

- [ ] **Step 2: Replace the expanded `<td colspan="11">` body**

Find the existing `{#if isOpen}` block and replace the inner `<div class="detail-grid">` with:

```svelte
{#if isOpen}
  <tr class="detail">
    <td></td>
    <td colspan="11">
      <PerNodeDrilldown
        slug={slug}
        nodeId={r.nodeId}
        defaultRange={period as '1h' | '6h' | '24h' | '7d' | '30d' | 'all'}
        refreshKey={refreshKey}
      />
      {#if r.lastError}
        <div class="last-error" title={r.lastError.message}>
          <span class="le-when">{formatRelative(new Date(r.lastError.at))}</span>
          <span class="le-msg">{r.lastError.message.slice(0, 200)}</span>
        </div>
      {/if}
    </td>
  </tr>
{/if}
```

The `last-error` strip below the drill-down preserves the existing affordance (drill-down focuses on charts; errors stay visible inline).

- [ ] **Step 3: Verify in dev**

Reload a canvas with a Per-Node node. Expand a row that has data; the drill-down renders with the 4 tabs + range pill + chart.

- [ ] **Step 4: Commit**

```bash
git add src/lib/canvas/stats/PerNodeNode.svelte
git commit -m "feat(stats): row drill-down with charts in PerNodeNode"
```

---

# Phase P5.4 — Inspector history scrubber

Three tasks: backend `recent-executions` endpoint, the scrubber component, integration into `InspectorBody`.

## Task 15: New `/nodes/[id]/recent-executions` endpoint

**Files:**
- Create: `src/routes/api/canvas/[slug]/nodes/[id]/recent-executions/+server.ts`

- [ ] **Step 1: Create the endpoint**

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, nodeExecutions } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

function canvasWorkflowName(slug: string): string {
  return `canvas:${slug}`;
}

export const GET: RequestHandler = async ({ params, url }) => {
  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.name, canvasWorkflowName(params.slug)));
  if (!wf) return json({ error: 'Canvas not found' }, { status: 404 });

  const [node] = await db
    .select({ id: workflowNodes.id })
    .from(workflowNodes)
    .where(and(eq(workflowNodes.id, params.id), eq(workflowNodes.workflowId, wf.id)));
  if (!node) return json({ error: 'Node not found in this canvas' }, { status: 404 });

  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100);

  const rows = await db
    .select({
      id: nodeExecutions.id,
      runId: nodeExecutions.runId,
      status: nodeExecutions.status,
      inputData: nodeExecutions.inputData,
      outputData: nodeExecutions.outputData,
      error: nodeExecutions.error,
      startedAt: nodeExecutions.startedAt,
      completedAt: nodeExecutions.completedAt,
      costUsd: nodeExecutions.costUsd,
    })
    .from(nodeExecutions)
    .where(eq(nodeExecutions.nodeId, params.id))
    .orderBy(desc(nodeExecutions.completedAt))
    .limit(limit);

  return json({
    executions: rows.map((r) => ({
      id: r.id,
      runId: r.runId,
      status: r.status,
      inputData: r.inputData,
      outputData: r.outputData,
      error: r.error,
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      costUsd: r.costUsd !== null ? Number(r.costUsd) : null,
    })),
  });
};
```

- [ ] **Step 2: curl-verify**

```bash
curl -sS 'http://localhost:5173/api/canvas/<slug>/nodes/<nodeId>/recent-executions?limit=5' | jq '.executions | length'
```

Expected: integer up to 5.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/canvas/[slug]/nodes/[id]/recent-executions/+server.ts
git commit -m "feat(canvas): recent-executions endpoint (Inspector history backing)"
```

---

## Task 16: `InspectorHistory.svelte` scrubber strip

**Files:**
- Create: `src/lib/canvas/InspectorHistory.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts" module>
  /** Exported type — `import { type Execution } from '...'` */
  export interface Execution {
    id: string;
    runId: string;
    status: string;
    inputData: unknown;
    outputData: unknown;
    error: string | null;
    startedAt: string | null;
    completedAt: string | null;
    costUsd: number | null;
  }
</script>

<script lang="ts">
  import { formatUsd } from './stats/costFormat';

  interface Props {
    executions: Execution[];
    selectedId: string | null;
    onselect: (id: string) => void;
  }
  let { executions, selectedId, onselect }: Props = $props();

  function relative(iso: string | null): string {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
    return `${Math.floor(ms / 86_400_000)}d`;
  }
</script>

<div class="ih" role="tablist" aria-label="Execution history">
  {#each executions as e (e.id)}
    <button
      class="dot"
      class:active={e.id === selectedId}
      class:s-completed={e.status === 'completed'}
      class:s-failed={e.status === 'failed'}
      class:s-running={e.status === 'running'}
      title={`${e.status} · ${relative(e.completedAt ?? e.startedAt)} ago${e.costUsd ? ' · ' + formatUsd(e.costUsd) : ''}${e.error ? '\n' + e.error.slice(0, 200) : ''}`}
      onclick={() => onselect(e.id)}
      role="tab"
      aria-selected={e.id === selectedId}
    >
      <span class="rel">{relative(e.completedAt ?? e.startedAt)}</span>
    </button>
  {/each}
</div>

<style>
  .ih {
    display: flex;
    gap: 2px;
    padding: 4px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  }
  .dot {
    flex: 0 0 auto;
    background: var(--bg-card, rgba(255,255,255,0.04));
    border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
    color: var(--text-muted, #888);
    padding: 2px 6px;
    font: 9px / 1 ui-monospace, Menlo, monospace;
    border-radius: 2px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .dot:hover { background: var(--bg-hover, rgba(255,255,255,0.08)); }
  .dot.active {
    background: var(--accent, #3a8a56);
    color: white;
    border-color: var(--accent, #3a8a56);
  }
  .dot.s-completed { border-left: 2px solid #3a8a56; }
  .dot.s-failed    { border-left: 2px solid #c44; }
  .dot.s-running   { border-left: 2px solid #ffcf40; }
  .rel { font-weight: 600; }
</style>
```

- [ ] **Step 2: Compile-check**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npm run check 2>&1 | grep -E "InspectorHistory"
```

Expected: no errors mentioning the new file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/canvas/InspectorHistory.svelte
git commit -m "feat(canvas): InspectorHistory scrubber component"
```

---

## Task 17: Wire `InspectorHistory` into `InspectorBody`

**Why:** `InspectorBody` is used in many places; we want the scrubber available where the Inspector NODE tap renders, without disturbing other usages.

**Files:**
- Modify: `src/lib/canvas/InspectorBody.svelte`
- Modify: `src/routes/jkai/canvas/[slug]/+page.svelte`

- [ ] **Step 1: Extend `InspectorBody` to accept an optional history**

At the top of `InspectorBody.svelte`'s script (the non-`module` script block), accept new props:

```ts
import InspectorHistory, { type Execution } from './InspectorHistory.svelte';

interface Props {
  data: unknown;
  depth?: number;
  maxDepth?: number;
  history?: Execution[];
  selectedHistoryId?: string | null;
  onhistoryselect?: (id: string) => void;
}
let { data, depth = 0, maxDepth = 12, history, selectedHistoryId = null, onhistoryselect }: Props = $props();
```

(Read the current top of the script section first to merge with existing prop declarations — the file already has a script block, do not duplicate.)

Above the existing body markup, render the scrubber when history is provided:

```svelte
{#if history && history.length > 1 && depth === 0 && onhistoryselect}
  <InspectorHistory executions={history} selectedId={selectedHistoryId} onselect={onhistoryselect} />
{/if}
```

- [ ] **Step 2: In the canvas page, fetch history for Inspector nodes**

In `+page.svelte`, around where Inspector nodes render (search for `n.kind === 'inspector'`), add state + an effect to populate per-inspector-node history. Near the other `$state` declarations:

```ts
import type { Execution as InspectorExecution } from '$lib/canvas/InspectorHistory.svelte';

let inspectorHistories = $state.raw<Record<string, InspectorExecution[]>>({});
let inspectorSelected = $state.raw<Record<string, string | null>>({});

async function loadInspectorHistory(inspectorNodeId: string, upstreamNodeId: string): Promise<void> {
  try {
    const res = await fetch(
      `/api/canvas/${encodeURIComponent(canvas.slug)}/nodes/${encodeURIComponent(upstreamNodeId)}/recent-executions?limit=20`,
    );
    if (!res.ok) return;
    const body = (await res.json()) as { executions: InspectorExecution[] };
    inspectorHistories = { ...inspectorHistories, [inspectorNodeId]: body.executions };
    if (!inspectorSelected[inspectorNodeId]) {
      inspectorSelected = { ...inspectorSelected, [inspectorNodeId]: body.executions[0]?.id ?? null };
    }
  } catch {
    /* network blip — try again next event */
  }
}
```

Add a derived helper that maps an inspector node to its single upstream node id (look at how the existing rendering already finds upstream output — likely via edge lookup). Mirror that pattern; if multi-input inspectors are possible in your data, pick the first input.

```ts
function upstreamNodeIdFor(inspectorId: string): string | null {
  for (const e of canvas.edges) {
    if (e.to === inspectorId) return e.from;
  }
  return null;
}
```

In the existing `$effect` that watches `liveStream.lastEvent` and calls `refreshNodeExecution`, also refresh inspector history when the upstream node finished:

```ts
$effect(() => {
  const evt = liveStream.lastEvent;
  if (!evt) return;
  if (evt.type !== 'node.completed' && evt.type !== 'node.failed') return;
  const nodeId = evt.data?.nodeId;
  if (typeof nodeId !== 'string') return;
  if (!byId[nodeId]) return;
  refreshNodeExecution(nodeId);
  // Refresh inspectors that tap this node.
  for (const n of viewNodes) {
    if (n.kind !== 'inspector') continue;
    if (upstreamNodeIdFor(n.id) === nodeId) {
      loadInspectorHistory(n.id, nodeId);
    }
  }
});
```

On initial mount, populate history for each inspector:

```ts
$effect(() => {
  for (const n of viewNodes) {
    if (n.kind !== 'inspector') continue;
    const up = upstreamNodeIdFor(n.id);
    if (!up) continue;
    if (inspectorHistories[n.id]) continue;
    loadInspectorHistory(n.id, up);
  }
});
```

- [ ] **Step 3: Pipe history into the Inspector render block**

Find the inspector node's `<InspectorBody data={n.inputData} />` line in the inspector-rendering block and replace with:

```svelte
{@const hist = inspectorHistories[n.id] ?? []}
{@const selectedId = inspectorSelected[n.id] ?? null}
{@const selectedExec = hist.find((e) => e.id === selectedId)}
<InspectorBody
  data={selectedExec ? selectedExec.outputData : n.inputData}
  history={hist}
  selectedHistoryId={selectedId}
  onhistoryselect={(id) => { inspectorSelected = { ...inspectorSelected, [n.id]: id }; }}
/>
```

(The Inspector node's inputData = its upstream's outputData. So when the user picks a history entry, we render that execution's `outputData`.)

- [ ] **Step 4: Verify in dev**

Wire an Inspector node downstream of any LLM/code node that has run multiple times. The Inspector now shows a scrubber strip with recent executions; clicking a dot renders that historical output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/InspectorBody.svelte src/routes/jkai/canvas/[slug]/+page.svelte
git commit -m "feat(canvas): wire InspectorHistory into the Inspector node tap"
```

---

# Phase P5.5 — Run Timeline node

Three tasks: register the node type, build the component, render it on the canvas.

## Task 18: Register `run-timeline` node type in `adapter.ts`

**Files:**
- Modify: `src/lib/canvas/adapter.ts`

- [ ] **Step 1: Find the Observability section**

```bash
grep -n "Observability" src/lib/canvas/adapter.ts
```

- [ ] **Step 2: Add the new type entry**

After the existing `stats-per-node` entry, add:

```ts
{
  type: 'run-timeline',
  label: 'Run · timeline',
  kind: 'stats',
  group: 'Observability',
  description: 'Gantt-style waterfall of a single run — every node as a bar, click to focus.',
  defaultConfig: { size: { w: 540, h: 320 } },
  handles: {
    inputs: [{ id: 'data', kinds: ['dataset', 'json'] }],
    outputs: [],
  },
},
```

- [ ] **Step 3: Verify**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npm run check 2>&1 | grep -E "adapter\.ts"
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/canvas/adapter.ts
git commit -m "feat(canvas): register run-timeline node type"
```

---

## Task 19: `RunTimelineNode.svelte` component

**Files:**
- Create: `src/lib/canvas/stats/RunTimelineNode.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import { formatDurationMs, formatRelative } from './format';
  import { formatUsd } from './costFormat';

  interface RecentRun {
    id: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
  }

  interface NodeBar {
    nodeId: string;
    label: string;
    type: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
    error: string | null;
    costUsd: number | null;
  }

  interface TimelineData {
    run: {
      id: string;
      status: string;
      startedAt: string | null;
      completedAt: string | null;
    } | null;
    recent: RecentRun[];
    nodes: NodeBar[];
  }

  interface Props {
    slug: string;
    refreshKey?: number;
    /** Optional: caller can scroll the canvas to a clicked node. */
    onnodeclick?: (nodeId: string) => void;
  }
  let { slug, refreshKey = 0, onnodeclick }: Props = $props();

  let runId = $state<string | null>(null);
  let data = $state<TimelineData | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      const q = runId ? `?runId=${encodeURIComponent(runId)}` : '';
      const res = await fetch(`/api/canvas/${encodeURIComponent(slug)}/stats/run-timeline${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = (await res.json()) as TimelineData;
      if (!runId && data.run) runId = data.run.id;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    slug; runId; refreshKey;
    load();
  });

  const runDurationMs = $derived.by(() => {
    const r = data?.run;
    if (!r || !r.startedAt) return 0;
    const end = r.completedAt ? new Date(r.completedAt).getTime() : Date.now();
    return Math.max(end - new Date(r.startedAt).getTime(), 1);
  });

  function barLeft(b: NodeBar): number {
    if (!b.startedAt || !data?.run?.startedAt) return 0;
    const offset = new Date(b.startedAt).getTime() - new Date(data.run.startedAt).getTime();
    return (offset / runDurationMs) * 100;
  }
  function barWidth(b: NodeBar): number {
    if (!b.durationMs) return 0.4;
    return Math.max((b.durationMs / runDurationMs) * 100, 0.4);
  }
  function barColour(status: string): string {
    if (status === 'completed') return '#3a8a56';
    if (status === 'failed') return '#c44';
    if (status === 'running') return '#ffcf40';
    return 'var(--text-muted, #888)';
  }
</script>

<div class="rt">
  <header class="hd">
    <span class="title">Run · timeline</span>
    <select
      class="picker"
      value={runId ?? ''}
      onchange={(e) => (runId = (e.currentTarget as HTMLSelectElement).value || null)}
    >
      {#each data?.recent ?? [] as r (r.id)}
        <option value={r.id}>
          {r.status} · {formatDurationMs(r.durationMs)} · {r.startedAt ? formatRelative(new Date(r.startedAt)) : ''}
        </option>
      {/each}
    </select>
  </header>

  {#if error}
    <div class="error-strip">{error}</div>
  {:else if loading && !data}
    <div class="skel">Loading…</div>
  {:else if !data?.run}
    <div class="empty">No runs yet</div>
  {:else if (data.nodes ?? []).length === 0}
    <div class="empty">Run has no node executions</div>
  {:else}
    <div class="gantt">
      {#each data.nodes as n (n.nodeId)}
        <div class="row">
          <div class="rowlabel" title="{n.label} ({n.type})">{n.label}</div>
          <div class="track">
            <button
              class="bar"
              style:left="{barLeft(n)}%"
              style:width="{barWidth(n)}%"
              style:background={barColour(n.status)}
              title="{n.label} · {n.type} · {formatDurationMs(n.durationMs)}{n.costUsd ? ' · ' + formatUsd(n.costUsd) : ''}{n.error ? '\n' + n.error.slice(0, 200) : ''}"
              onclick={() => onnodeclick?.(n.nodeId)}
              aria-label={`${n.label} bar`}
            ></button>
          </div>
          <div class="rowdur">{formatDurationMs(n.durationMs)}</div>
        </div>
      {/each}
    </div>
    <footer class="ft">
      <span>{formatDurationMs(runDurationMs)} total</span>
      <span class="sep">·</span>
      <span>{data.nodes.length} nodes</span>
    </footer>
  {/if}
</div>

<style>
  .rt {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 10px;
    gap: 8px;
    background: var(--bg-card, rgba(255,255,255,0.03));
    border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
    border-radius: 8px;
    font: 11px / 1.4 ui-monospace, Menlo, monospace;
    color: var(--text-primary, #e6e6e6);
    overflow: hidden;
  }
  .hd { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .title { font-weight: 600; font-size: 12px; }
  .picker { flex: 1; background: transparent; color: inherit; border: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); font: inherit; padding: 1px 4px; }
  .gantt { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .row { display: grid; grid-template-columns: 100px 1fr 50px; gap: 6px; align-items: center; }
  .rowlabel { font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary, #e6e6e6); }
  .track { position: relative; height: 14px; background: var(--bg-track, rgba(255,255,255,0.04)); border-radius: 2px; }
  .bar { position: absolute; top: 0; height: 100%; border: none; cursor: pointer; border-radius: 2px; padding: 0; }
  .bar:hover { filter: brightness(1.15); }
  .rowdur { color: var(--text-muted, #888); font-size: 9px; text-align: right; }
  .ft { display: flex; gap: 6px; color: var(--text-muted, #888); font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; }
  .sep { opacity: 0.5; }
  .empty, .skel { color: var(--text-muted, #888); font-style: italic; padding: 8px; }
  .error-strip { color: #c44; font-size: 10px; padding: 4px; border: 1px solid #c44; border-radius: 4px; }
</style>
```

- [ ] **Step 2: Compile-check**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npm run check 2>&1 | grep -E "RunTimelineNode"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/canvas/stats/RunTimelineNode.svelte
git commit -m "feat(stats): RunTimelineNode (Gantt waterfall component)"
```

---

## Task 20: Render `run-timeline` in `+page.svelte`

**Files:**
- Modify: `src/routes/jkai/canvas/[slug]/+page.svelte`

- [ ] **Step 1: Import the component**

Near the other stats imports:

```ts
import RunTimelineNode from '$lib/canvas/stats/RunTimelineNode.svelte';
```

- [ ] **Step 2: Add a bump key**

In the bump-signal block (where `runBumpKey` and `perNodeBumpKey` live), add:

```ts
const timelineBumpKey = $derived.by(() => {
  const evt = liveStream.lastEvent;
  if (!evt) return 0;
  if (
    evt.type === 'node.started' ||
    evt.type === 'node.completed' ||
    evt.type === 'node.failed' ||
    evt.type === 'run.started' ||
    evt.type === 'run.completed' ||
    evt.type === 'run.failed'
  ) return evt.seq;
  return 0;
});
```

- [ ] **Step 3: Render the node type**

Find the stats-rendering block (the `{#if n.type === 'stats-summary'} ... {:else if n.type === 'stats-per-node'}` chain) and add:

```svelte
{:else if n.type === 'run-timeline'}
  <RunTimelineNode
    slug={canvas.slug}
    refreshKey={timelineBumpKey}
    onnodeclick={(nodeId) => scrollToNode(nodeId)}
  />
```

- [ ] **Step 4: Verify in dev**

Drop a Run · timeline node on a canvas. Run the workflow. The picker shows recent runs; the Gantt fills in.

- [ ] **Step 5: Commit**

```bash
git add src/routes/jkai/canvas/[slug]/+page.svelte
git commit -m "feat(canvas): render run-timeline node + live bump signal"
```

---

# Phase P5.6 — Error Explorer + Cost nodes

Five tasks: register both types, build both components, wire renders in the page.

## Task 21: Register `error-explorer` + `cost-summary` types in `adapter.ts`

**Files:**
- Modify: `src/lib/canvas/adapter.ts`

- [ ] **Step 1: Add both entries**

In the Observability section (next to `run-timeline`):

```ts
{
  type: 'error-explorer',
  label: 'Errors',
  kind: 'stats',
  group: 'Observability',
  description: 'Groups failed node executions by signature. Click a group to see runs.',
  defaultConfig: { size: { w: 420, h: 360 } },
  handles: {
    inputs: [{ id: 'data', kinds: ['dataset', 'json'] }],
    outputs: [],
  },
},
{
  type: 'cost-summary',
  label: 'Cost',
  kind: 'stats',
  group: 'Observability',
  description: 'Total spend in window, stacked by model, drill-down by node type / label.',
  defaultConfig: { size: { w: 380, h: 320 } },
  handles: {
    inputs: [{ id: 'data', kinds: ['dataset', 'json'] }],
    outputs: [],
  },
},
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/canvas/adapter.ts
git commit -m "feat(canvas): register error-explorer + cost-summary types"
```

---

## Task 22: `ErrorExplorerNode.svelte`

**Files:**
- Create: `src/lib/canvas/stats/ErrorExplorerNode.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import { useStats } from './useStats.svelte';
  import { formatRelative } from './format';

  interface ErrorGroup {
    signature: string;
    count: number;
    lastSeen: string;
    affectedNodeIds: string[];
    affectedNodeLabels: string[];
    recent: Array<{
      runId: string;
      nodeId: string;
      nodeLabel: string;
      at: string;
      error: string;
    }>;
  }

  interface ErrorsData {
    totalErrors: number;
    groups: ErrorGroup[];
  }

  interface Props {
    slug: string;
    period: string;
    refreshKey?: number;
    onnodeclick?: (nodeId: string) => void;
  }
  let { slug, period, refreshKey = 0, onnodeclick }: Props = $props();

  const stats = useStats<ErrorsData>(() => slug, 'errors' as never, () => period, () => refreshKey);
  // Note: 'errors' is added to StatsEndpoint by extending useStats.svelte.ts
  // in this task — see step 2.

  let expanded = $state<Record<string, boolean>>({});
  function toggle(sig: string) { expanded = { ...expanded, [sig]: !expanded[sig] }; }
</script>

<div class="ee">
  <header class="hd">
    <span class="title">Errors</span>
    <button class="refresh" onclick={() => stats.refresh()} title="Refresh">⟳</button>
  </header>

  {#if stats.error}
    <div class="error-strip">{stats.error}</div>
  {:else if stats.loading && !stats.data}
    <div class="skel">Loading…</div>
  {:else if stats.data}
    <div class="total">{stats.data.totalErrors} errors in window</div>
    {#if stats.data.groups.length === 0}
      <div class="empty">No failures 🎉</div>
    {:else}
      <ul class="groups">
        {#each stats.data.groups as g (g.signature)}
          {@const isOpen = !!expanded[g.signature]}
          <li>
            <button class="grow" onclick={() => toggle(g.signature)}>
              <span class="count">{g.count}×</span>
              <span class="sig" title={g.signature}>{g.signature}</span>
              <span class="when">{formatRelative(new Date(g.lastSeen))}</span>
            </button>
            <div class="affected">on {g.affectedNodeLabels.join(', ')}</div>
            {#if isOpen}
              <ul class="recent">
                {#each g.recent as r, i (r.runId + '|' + r.nodeId + '|' + i)}
                  <li>
                    <span class="rid">{r.runId.slice(0, 8)}</span>
                    <span class="nl">{r.nodeLabel}</span>
                    <span class="at">{formatRelative(new Date(r.at))}</span>
                    <button class="jump" onclick={() => onnodeclick?.(r.nodeId)}>open</button>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .ee {
    display: flex; flex-direction: column; gap: 6px; padding: 10px;
    width: 100%; height: 100%;
    background: var(--bg-card, rgba(255,255,255,0.03));
    border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
    border-radius: 8px;
    font: 11px / 1.4 ui-monospace, Menlo, monospace;
    color: var(--text-primary, #e6e6e6);
    overflow: hidden;
  }
  .hd { display: flex; justify-content: space-between; align-items: center; }
  .title { font-weight: 600; font-size: 12px; }
  .refresh { background: transparent; border: none; color: var(--text-muted, #888); cursor: pointer; font-size: 14px; padding: 0 4px; }
  .total { color: var(--text-muted, #888); font-size: 10px; }
  .groups { list-style: none; padding: 0; margin: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
  .grow {
    background: transparent; border: none; color: inherit; font: inherit;
    display: grid; grid-template-columns: 40px 1fr 60px; gap: 6px; align-items: center;
    width: 100%; padding: 4px; cursor: pointer; text-align: left; border-radius: 3px;
  }
  .grow:hover { background: var(--bg-hover, rgba(255,255,255,0.05)); }
  .count { font-weight: 700; }
  .sig { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .when, .at { color: var(--text-muted, #888); font-size: 9px; text-align: right; }
  .affected { color: var(--text-muted, #888); font-size: 9px; padding: 0 4px 4px; }
  .recent { list-style: none; padding: 0 4px; margin: 0; display: flex; flex-direction: column; gap: 2px; }
  .recent li { display: grid; grid-template-columns: 60px 1fr 50px 40px; gap: 4px; font-size: 9px; }
  .rid { font-family: ui-monospace; color: var(--text-muted, #888); }
  .nl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .jump { background: transparent; border: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); color: var(--accent, #3a8a56); cursor: pointer; padding: 0 4px; font: inherit; border-radius: 2px; }
  .empty, .skel { color: var(--text-muted, #888); font-style: italic; padding: 8px; text-align: center; }
  .error-strip { color: #c44; font-size: 10px; padding: 4px; border: 1px solid #c44; border-radius: 4px; }
</style>
```

- [ ] **Step 2: Extend `useStats.svelte.ts` to allow the new endpoint**

In `src/lib/canvas/stats/useStats.svelte.ts`:

```ts
export type StatsEndpoint = 'summary' | 'trends' | 'per-node' | 'errors' | 'cost';
```

(That single edit; the rest of the hook is endpoint-agnostic.)

- [ ] **Step 3: Compile-check + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npm run check 2>&1 | grep -E "ErrorExplorerNode|useStats"
git add src/lib/canvas/stats/ErrorExplorerNode.svelte src/lib/canvas/stats/useStats.svelte.ts
git commit -m "feat(stats): ErrorExplorerNode + extend useStats endpoint union"
```

---

## Task 23: `CostNode.svelte`

**Files:**
- Create: `src/lib/canvas/stats/CostNode.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import { Chart, Svg, Bars } from 'layerchart';
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { formatUsd } from './costFormat';
  import { formatPercent } from './format';

  type GroupBy = 'model' | 'node-type' | 'node-label';

  interface CostBucket { t: string; model: string; costUsd: number; }
  interface BreakdownRow {
    key: string;
    costUsd: number;
    percentage: number;
    requests: number;
    avgCostPerRequest: number;
  }
  interface CostData {
    totalUsd: number;
    buckets: CostBucket[];
    breakdown: BreakdownRow[];
    groupBy: GroupBy;
  }

  interface Props {
    slug: string;
    period: string;
    refreshKey?: number;
    onnodeclick?: (nodeId: string) => void;
  }
  let { slug, period, refreshKey = 0, onnodeclick }: Props = $props();

  let groupBy = $state<GroupBy>('model');
  let data = $state<CostData | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // useStats encodes only ?period, not arbitrary query args, so we fetch
  // inline here (the same pattern PerNodeDrilldown uses). Re-fetch when
  // slug, period, groupBy, or refreshKey changes.
  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      const url = `/api/canvas/${encodeURIComponent(slug)}/stats/cost?period=${encodeURIComponent(period)}&groupBy=${groupBy}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: CostData };
      data = body.data;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    slug; period; groupBy; refreshKey;
    load();
  });

  // Adapter so the existing template (which references `stats.*`) keeps
  // working without rewrites below.
  const stats = $derived({
    data,
    loading,
    error,
    refresh: load,
  });

  function colorForModel(model: string): string {
    let hash = 0;
    for (let i = 0; i < model.length; i++) hash = (hash * 31 + model.charCodeAt(i)) | 0;
    const hue = ((hash % 360) + 360) % 360;
    return `hsl(${hue}, 65%, 55%)`;
  }

  // Stack buckets per timestamp for the chart.
  const stackedBuckets = $derived.by(() => {
    const byT = new Map<string, Record<string, number>>();
    const models = new Set<string>();
    for (const b of stats.data?.buckets ?? []) {
      models.add(b.model);
      const row = byT.get(b.t) ?? { t: b.t } as unknown as Record<string, number>;
      (row as Record<string, number | string>)[b.model] = b.costUsd;
      byT.set(b.t, row as Record<string, number>);
    }
    return { rows: Array.from(byT.values()), models: [...models].sort() };
  });
</script>

<div class="cs">
  <header class="hd">
    <span class="title">Cost</span>
    <button class="refresh" onclick={() => stats.refresh()} title="Refresh">⟳</button>
  </header>

  {#if stats.error}
    <div class="error-strip">{stats.error}</div>
  {:else if stats.loading && !stats.data}
    <div class="skel">Loading…</div>
  {:else if stats.data}
    <div class="headline">{formatUsd(stats.data.totalUsd)}</div>

    <div class="chart">
      {#if stackedBuckets.rows.length > 0}
        <Chart
          data={stackedBuckets.rows.map((r) => ({ ...r, t: new Date(r.t as unknown as string) }))}
          x="t"
          xScale={scaleTime()}
          yScale={scaleLinear()}
        >
          <Svg>
            {#each stackedBuckets.models as model (model)}
              <Bars y={model} fill={colorForModel(model)} stroke="none" />
            {/each}
          </Svg>
        </Chart>
      {:else}
        <div class="empty">No spend in this window</div>
      {/if}
    </div>

    <div class="tabs">
      {#each ['model', 'node-type', 'node-label'] as g (g)}
        <button
          class:active={groupBy === g}
          onclick={() => (groupBy = g as GroupBy)}
        >{g}</button>
      {/each}
    </div>

    <ul class="breakdown">
      {#each stats.data.breakdown as r (r.key)}
        <li>
          <span class="bd-key" title={r.key}>{r.key}</span>
          <span class="bd-cost">{formatUsd(r.costUsd)}</span>
          <span class="bd-pct">{formatPercent(r.percentage)}</span>
          <span class="bd-n">{r.requests}× · {formatUsd(r.avgCostPerRequest)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .cs {
    display: flex; flex-direction: column; gap: 6px; padding: 10px;
    width: 100%; height: 100%;
    background: var(--bg-card, rgba(255,255,255,0.03));
    border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
    border-radius: 8px;
    font: 11px / 1.4 ui-monospace, Menlo, monospace;
    color: var(--text-primary, #e6e6e6);
    overflow: hidden;
  }
  .hd { display: flex; justify-content: space-between; align-items: center; }
  .title { font-weight: 600; font-size: 12px; }
  .refresh { background: transparent; border: none; color: var(--text-muted, #888); cursor: pointer; font-size: 14px; padding: 0 4px; }
  .headline { font-size: 22px; font-weight: 700; }
  .chart { height: 90px; }
  .tabs { display: flex; gap: 2px; }
  .tabs button {
    background: transparent; border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
    color: var(--text-muted, #888); padding: 1px 6px; font: inherit; cursor: pointer; border-radius: 2px;
    text-transform: uppercase; letter-spacing: 0.4px; font-size: 9px;
  }
  .tabs button.active { background: var(--accent, #3a8a56); color: white; border-color: var(--accent); }
  .breakdown { list-style: none; padding: 0; margin: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .breakdown li { display: grid; grid-template-columns: 1fr 70px 50px 100px; gap: 6px; align-items: baseline; font-size: 10px; }
  .bd-key { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bd-cost { text-align: right; font-weight: 600; }
  .bd-pct { text-align: right; color: var(--text-muted, #888); }
  .bd-n { color: var(--text-muted, #888); font-size: 9px; }
  .empty, .skel { color: var(--text-muted, #888); font-style: italic; padding: 8px; text-align: center; }
  .error-strip { color: #c44; font-size: 10px; padding: 4px; border: 1px solid #c44; border-radius: 4px; }
</style>
```

> **Note about `onnodeclick`:** kept on the props for future use (per-row drill-into-recent-calls) but not used in this task's minimal CostNode body. If layerchart's `<Bars>` API differs from the version in this repo, fall back to a manual SVG `<rect>` grid driven by a `$derived` over `stackedBuckets`.

- [ ] **Step 2: Compile-check + commit**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npm run check 2>&1 | grep -E "CostNode"
git add src/lib/canvas/stats/CostNode.svelte
git commit -m "feat(stats): CostNode (spend dashboard with model/type/label breakdown)"
```

---

## Task 24: Render `error-explorer` + `cost-summary` on the canvas

**Files:**
- Modify: `src/routes/jkai/canvas/[slug]/+page.svelte`

- [ ] **Step 1: Import both components**

```ts
import ErrorExplorerNode from '$lib/canvas/stats/ErrorExplorerNode.svelte';
import CostNode from '$lib/canvas/stats/CostNode.svelte';
```

- [ ] **Step 2: Add bump signals**

In the bump-signal block:

```ts
const errorsBumpKey = $derived.by(() => {
  const evt = liveStream.lastEvent;
  if (!evt) return 0;
  if (evt.type === 'node.failed' || evt.type === 'run.failed' || evt.type === 'run.completed') return evt.seq;
  return 0;
});
const costBumpKey = $derived.by(() => {
  const evt = liveStream.lastEvent;
  if (!evt) return 0;
  if (evt.type === 'node.completed' || evt.type === 'run.completed') return evt.seq;
  return 0;
});
```

- [ ] **Step 3: Render the node types**

In the stats-rendering chain, add two more branches:

```svelte
{:else if n.type === 'error-explorer'}
  <ErrorExplorerNode
    slug={canvas.slug}
    period={period}
    refreshKey={errorsBumpKey}
    onnodeclick={(nodeId) => scrollToNode(nodeId)}
  />
{:else if n.type === 'cost-summary'}
  <CostNode
    slug={canvas.slug}
    period={period}
    refreshKey={costBumpKey}
    onnodeclick={(nodeId) => scrollToNode(nodeId)}
  />
```

- [ ] **Step 4: Verify in dev**

Drop both new nodes on a canvas. Trigger a workflow with at least one failed node and one LLM node. Both render: Error Explorer shows the failure grouped; Cost shows the spend total and stacked bars.

- [ ] **Step 5: Commit**

```bash
git add src/routes/jkai/canvas/[slug]/+page.svelte
git commit -m "feat(canvas): render error-explorer + cost-summary nodes"
```

---

# Final verification (gate before merge)

After all 24 tasks land, run the full gate.

- [ ] **`npm run check` clean for all phase-5 files**

```bash
cd ~/strange_rambling_svelte
NODE_OPTIONS=--max-old-space-size=8192 npm run check 2>&1 | \
  grep -E "ERROR.*(stats/(SummaryNode|TrendsNode|PerNodeNode|PerNodeDrilldown|RunTimelineNode|ErrorExplorerNode|CostNode|errorSignature|costFormat|useStats|useCanvasStream)|canvas/InspectorHistory|api/canvas/\[slug\]/stats/(summary|trends|per-node|run-timeline|errors|cost)|api/canvas/\[slug\]/nodes/\[id\]/recent-executions)"
```

Expected: empty output. Any error here is in phase-5 code and must be fixed.

- [ ] **`npm run build` clean**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npm run build
ls -la build/index.js
```

Expected: clean build, fresh timestamp.

- [ ] **End-to-end smoke (after restart of homeserv service or VPS deploy)**

Drop ALL five observability-node types onto a fresh canvas: Summary, Trends, Per-Node, Run Timeline, Errors, Cost. Run a workflow that includes at least one LLM node (chat / deep-research) and one node that will fail (a stealth-scrape with a deliberately bad URL, or any `code-execute` with `throw new Error("smoke")`).

- Summary: cost / tokens / cache counters non-zero; existing counters still right.
- Trends: cost-by-model track present; tooltips on hover; prior-period overlay (faint dashed) when there's prior data.
- Per-Node: three new columns populated; expanding a row shows the drill-down with metric tabs + chart.
- Inspector (if any): scrubber strip across the top; click an older dot, body renders that execution's output.
- Run Timeline: picker auto-selects most recent run; bars render with status colours; click a bar scrolls the canvas to that node.
- Errors: failure appears as a group; expanding shows the recent failing executions; "open" jumps to the node.
- Cost: total non-zero; stacked bars render; switching `model / node-type / node-label` updates the breakdown.

- [ ] **Ship via `~/strange_rambling_svelte/scripts/deploy.sh`**

Use the `ship` skill protocol. Verify the new SSE / cost / errors endpoints land on production by curling them (they'll 401 if behind auth, which proves the routes exist) and inspecting at least one of the new client bundles for a unique fingerprint such as the string `Run · timeline`.

---

# Self-review checklist

- [ ] Every spec section (§3.1 through §3.5) maps to a task.
  - 3.1 Existing nodes refresh → Tasks 2, 3, 4, 10, 11, 12, 17 (Inspector).
  - 3.2 Per-Node drill-down → Tasks 5, 13, 14.
  - 3.3 Run Timeline → Tasks 6, 18, 19, 20.
  - 3.4 Error Explorer → Tasks 1, 7, 21, 22, 24.
  - 3.5 Cost node → Tasks 8, 9, 21, 23, 24.
- [ ] No placeholders (`TBD`, `TODO`, "handle appropriately"). Helpers and components show their full bodies; SQL queries are written out; endpoint shapes are explicit.
- [ ] Type consistency: `Execution`, `NodeBar`, `ErrorGroup`, `CostData` interfaces match across producer (endpoint) and consumer (component). Field names verified.
- [ ] `useStats` endpoint union extended (Task 22, step 2) to cover `errors` and `cost`; otherwise the two new node components would fail at type-check.
