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
      counters: { runs, success, failed, healing, successRate, avgDurationMs },
      sparkline,
      recentRuns,
      recentEdits,
    },
  });
};
