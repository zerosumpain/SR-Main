import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import {
  workflows,
  workflowRuns,
  workflowAuditLog,
} from '$lib/db/schema';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { resolvePeriod } from '$lib/canvas/stats/resolvePeriod';

function canvasWorkflowName(slug: string): string {
  return `canvas:${slug}`;
}

export const GET: RequestHandler = async ({ params, url }) => {
  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.name, canvasWorkflowName(params.slug)));
  if (!wf) return json({ error: 'Canvas not found' }, { status: 404 });

  // If 'all' preset: find earliest run for this workflow
  const [earliestRow] = await db
    .select({ t: workflowRuns.startedAt })
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, wf.id))
    .orderBy(workflowRuns.startedAt)
    .limit(1);
  const period = resolvePeriod(url.searchParams.get('period'), new Date(), earliestRow?.t ?? undefined);

  // Counters
  const rows = await db
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
    );

  let success = 0,
    failed = 0,
    healing = 0,
    totalDuration = 0,
    durCount = 0;
  for (const r of rows) {
    if (r.status === 'completed') success++;
    else if (r.status === 'failed') failed++;
    if (Array.isArray(r.healingHistory) && r.healingHistory.length > 0) healing++;
    if (r.startedAt && r.completedAt) {
      totalDuration += r.completedAt.getTime() - r.startedAt.getTime();
      durCount++;
    }
  }
  const runs = rows.length;
  const successRate = runs > 0 ? success / runs : 0;
  const avgDurationMs = durCount > 0 ? Math.round(totalDuration / durCount) : null;

  // Cost / token aggregates over node_executions for runs in the window.
  // Token sums use ::bigint, not ::int, because INTEGER (32-bit) can overflow
  // at ~2.1B and a long "all"-preset window across an LLM-heavy canvas can
  // exceed that. pg returns BIGINT as a string; Number() handles values up
  // to 2^53 cleanly, which is more than enough for any plausible total.
  const costRow = await db.execute<{
    total_cost: string | null;
    tokens_in: string | null;
    tokens_out: string | null;
    cache_read: string | null;
  }>(sql`
    SELECT
      COALESCE(SUM(ne.cost_usd), 0)::text         AS total_cost,
      COALESCE(SUM(ne.tokens_input), 0)::bigint   AS tokens_in,
      COALESCE(SUM(ne.tokens_output), 0)::bigint  AS tokens_out,
      COALESCE(SUM(ne.cache_read_tokens), 0)::bigint AS cache_read
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

  // Sparkline — bucket by granularity
  const bucketExpr =
    period.granularity === 'hour'
      ? sql`date_trunc('hour', ${workflowRuns.startedAt})`
      : period.granularity === 'week'
        ? sql`date_trunc('week', ${workflowRuns.startedAt})`
        : sql`date_trunc('day', ${workflowRuns.startedAt})`;

  const sparkRows = await db
    .select({
      bucket: bucketExpr.as('bucket'),
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.workflowId, wf.id),
        gte(workflowRuns.startedAt, period.from),
        lt(workflowRuns.startedAt, period.to),
      ),
    )
    .groupBy(sql`bucket`)
    .orderBy(sql`bucket`);

  const sparkline = sparkRows.map((r) => ({
    bucket: (r.bucket instanceof Date ? r.bucket : new Date(r.bucket as unknown as string)).toISOString(),
    count: Number(r.count),
  }));

  // Recent runs
  const recentRuns = rows
    .filter((r) => r.startedAt)
    .sort((a, b) => (b.startedAt!.getTime() - a.startedAt!.getTime()))
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt!.toISOString(),
      durationMs: r.startedAt && r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null,
    }));

  // Recent edits (always top 5, regardless of period — the edit history is most useful as "what changed lately")
  const editRows = await db
    .select()
    .from(workflowAuditLog)
    .where(eq(workflowAuditLog.workflowId, wf.id))
    .orderBy(desc(workflowAuditLog.at))
    .limit(5);

  const recentEdits = editRows.map((e) => ({
    at: e.at.toISOString(),
    entity: e.entity,
    entityId: e.entityId,
    action: e.action,
    details: (e.details as Record<string, unknown>) ?? {},
  }));

  return json({
    window: {
      preset: period.preset,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      granularity: period.granularity,
    },
    data: {
      counters: { runs, success, failed, healing, successRate, avgDurationMs, totalCostUsd, tokensInput, tokensOutput, cacheHitRate },
      sparkline,
      recentRuns,
      recentEdits,
    },
  });
};
