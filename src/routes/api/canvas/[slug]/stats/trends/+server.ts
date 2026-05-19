import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowRuns } from '$lib/db/schema';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { resolvePeriod, type Granularity } from '$lib/canvas/stats/resolvePeriod';

function canvasWorkflowName(slug: string): string {
  return `canvas:${slug}`;
}

/** Zero-fill buckets between from..to at the granularity step. */
function buildBuckets(from: Date, to: Date, granularity: Granularity): Date[] {
  const stepMs =
    granularity === 'hour' ? 3_600_000 : granularity === 'week' ? 604_800_000 : 86_400_000;
  const startMs =
    granularity === 'hour'
      ? Math.floor(from.getTime() / stepMs) * stepMs
      : Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const out: Date[] = [];
  for (let t = startMs; t < to.getTime(); t += stepMs) out.push(new Date(t));
  return out;
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
  const period = resolvePeriod(url.searchParams.get('period'), new Date(), earliestRow?.t ?? undefined);

  const periodMs = period.to.getTime() - period.from.getTime();
  const priorFrom = new Date(period.from.getTime() - periodMs);
  const priorTo = period.from;

  const trunc =
    period.granularity === 'hour'
      ? sql`date_trunc('hour', ${workflowRuns.startedAt})`
      : period.granularity === 'week'
        ? sql`date_trunc('week', ${workflowRuns.startedAt})`
        : sql`date_trunc('day', ${workflowRuns.startedAt})`;

  // One query for per-bucket run counts by status + duration percentiles.
  // duration_ms := completedAt - startedAt (ms), null if not completed.
  const rows = await db.execute<{
    bucket: Date;
    status: string;
    cnt: number;
    p50: number | null;
    p95: number | null;
    avg_ms: number | null;
    healed: number;
  }>(sql`
    SELECT
      ${trunc} AS bucket,
      ${workflowRuns.status} AS status,
      COUNT(*)::int AS cnt,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (${workflowRuns.completedAt} - ${workflowRuns.startedAt})) * 1000
      ) FILTER (WHERE ${workflowRuns.completedAt} IS NOT NULL) AS p50,
      percentile_cont(0.95) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (${workflowRuns.completedAt} - ${workflowRuns.startedAt})) * 1000
      ) FILTER (WHERE ${workflowRuns.completedAt} IS NOT NULL) AS p95,
      AVG(EXTRACT(EPOCH FROM (${workflowRuns.completedAt} - ${workflowRuns.startedAt})) * 1000)
        FILTER (WHERE ${workflowRuns.completedAt} IS NOT NULL) AS avg_ms,
      COUNT(*) FILTER (
        WHERE jsonb_array_length(COALESCE(${workflowRuns.healingHistory}, '[]'::jsonb)) > 0
      )::int AS healed
    FROM ${workflowRuns}
    WHERE ${workflowRuns.workflowId} = ${wf.id}
      AND ${workflowRuns.startedAt} >= ${period.from}
      AND ${workflowRuns.startedAt} < ${period.to}
    GROUP BY bucket, ${workflowRuns.status}
    ORDER BY bucket
  `);

  type Row = (typeof rows.rows)[number];
  const bucketsIndex = new Map<
    string,
    { success: number; failed: number; healing: number; p50: number | null; p95: number | null; avg: number | null }
  >();

  for (const r of rows.rows as unknown as Row[]) {
    const key = new Date(r.bucket).toISOString();
    const entry = bucketsIndex.get(key) ?? {
      success: 0,
      failed: 0,
      healing: 0,
      p50: null as number | null,
      p95: null as number | null,
      avg: null as number | null,
    };
    if (r.status === 'completed') entry.success += r.cnt;
    else if (r.status === 'failed') entry.failed += r.cnt;
    entry.healing += r.healed;
    // percentiles: pick the widest bucket-level values we see (runs may span statuses)
    if (r.p50 !== null) entry.p50 = Math.max(entry.p50 ?? 0, Math.round(r.p50));
    if (r.p95 !== null) entry.p95 = Math.max(entry.p95 ?? 0, Math.round(r.p95));
    if (r.avg_ms !== null) entry.avg = Math.round(r.avg_ms);
    bucketsIndex.set(key, entry);
  }

  const skeleton = buildBuckets(period.from, period.to, period.granularity);
  const buckets = skeleton.map((t) => {
    const key = t.toISOString();
    const e = bucketsIndex.get(key);
    return {
      t: key,
      runs: {
        success: e?.success ?? 0,
        failed: e?.failed ?? 0,
        healing: e?.healing ?? 0,
      },
      durationMs: {
        p50: e?.p50 ?? null,
        p95: e?.p95 ?? null,
        avg: e?.avg ?? null,
      },
    };
  });

  // Recent individual runs — used to render a chronological timeline
  // that stays readable even when bucket counts are sparse (1–2 runs in
  // the whole window doesn't render usefully as bar chart).
  const recentRunRows = await db
    .select({
      id: workflowRuns.id,
      status: workflowRuns.status,
      startedAt: workflowRuns.startedAt,
      completedAt: workflowRuns.completedAt,
      healingHistory: workflowRuns.healingHistory,
    })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.workflowId, wf.id),
        gte(workflowRuns.startedAt, period.from),
        lt(workflowRuns.startedAt, period.to),
      ),
    )
    .orderBy(desc(workflowRuns.startedAt))
    .limit(40);

  const recentRuns = recentRunRows
    .filter((r) => r.startedAt)
    .map((r) => ({
      id: r.id,
      status: r.status,
      healing:
        Array.isArray(r.healingHistory) && (r.healingHistory as unknown[]).length > 0,
      startedAt: r.startedAt!.toISOString(),
      durationMs:
        r.startedAt && r.completedAt
          ? r.completedAt.getTime() - r.startedAt.getTime()
          : null,
    }));

  const costByModelRows = await db.execute<{
    bucket: Date;
    model: string | null;
    cost_usd: string | null;
  }>(sql`
    SELECT
      date_trunc(${period.granularity}, wr.started_at) AS bucket,
      ne.model AS model,
      COALESCE(SUM(ne.cost_usd), 0)::text AS cost_usd
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
    costUsd: r.cost_usd !== null ? Number(r.cost_usd) : 0,
  }));

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

  return json({
    window: {
      preset: period.preset,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      granularity: period.granularity,
    },
    data: { buckets, recentRuns, costByModel, priorRunsByBucket },
  });
};
