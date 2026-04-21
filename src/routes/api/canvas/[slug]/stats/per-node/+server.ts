import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { and, desc, eq, gte, inArray, lt, like, sql, not } from 'drizzle-orm';
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

  const [earliestRow] = await db
    .select({ t: workflowRuns.startedAt })
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, wf.id))
    .orderBy(workflowRuns.startedAt)
    .limit(1);
  const period = resolvePeriod(url.searchParams.get('period'), new Date(), earliestRow?.t ?? undefined);

  // All non-stats nodes for this workflow
  const nodes = await db
    .select({
      id: workflowNodes.id,
      label: workflowNodes.label,
      type: workflowNodes.type,
    })
    .from(workflowNodes)
    .where(
      and(
        eq(workflowNodes.workflowId, wf.id),
        not(like(workflowNodes.type, 'stats-%')),
      ),
    );

  if (nodes.length === 0) {
    return json({
      window: {
        preset: period.preset,
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        granularity: period.granularity,
      },
      data: { nodes: [] },
    });
  }

  // Aggregate node_executions in the window, joined to workflow_runs so we can filter by started_at
  const aggRows = await db.execute<{
    node_id: string;
    runs: number;
    success: number;
    failed: number;
    avg_ms: number | null;
    p95_ms: number | null;
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
      ) FILTER (WHERE ne.completed_at IS NOT NULL) AS p95_ms
    FROM node_executions ne
    INNER JOIN workflow_runs wr ON wr.id = ne.run_id
    WHERE wr.workflow_id = ${wf.id}
      AND wr.started_at >= ${period.from}
      AND wr.started_at < ${period.to}
      AND ne.node_id = ANY(${nodes.map((n) => n.id)})
    GROUP BY ne.node_id
  `);

  const aggByNodeId = new Map<string, (typeof aggRows.rows)[number]>();
  for (const r of aggRows.rows) aggByNodeId.set(r.node_id, r);

  // Most-recent error per node in window
  const errRows = await db.execute<{
    node_id: string;
    completed_at: Date;
    error: string;
  }>(sql`
    SELECT DISTINCT ON (ne.node_id)
      ne.node_id,
      ne.completed_at,
      ne.error
    FROM node_executions ne
    INNER JOIN workflow_runs wr ON wr.id = ne.run_id
    WHERE wr.workflow_id = ${wf.id}
      AND wr.started_at >= ${period.from}
      AND wr.started_at < ${period.to}
      AND ne.status = 'failed'
      AND ne.error IS NOT NULL
      AND ne.node_id = ANY(${nodes.map((n) => n.id)})
    ORDER BY ne.node_id, ne.completed_at DESC NULLS LAST
  `);

  const errByNodeId = new Map<string, (typeof errRows.rows)[number]>();
  for (const r of errRows.rows) errByNodeId.set(r.node_id, r);

  const result = nodes.map((n) => {
    const agg = aggByNodeId.get(n.id);
    const err = errByNodeId.get(n.id);
    return {
      nodeId: n.id,
      label: n.label,
      type: n.type,
      runs: agg ? Number(agg.runs) : 0,
      success: agg ? Number(agg.success) : 0,
      failed: agg ? Number(agg.failed) : 0,
      avgMs: agg?.avg_ms !== null && agg?.avg_ms !== undefined ? Math.round(Number(agg.avg_ms)) : null,
      p95Ms: agg?.p95_ms !== null && agg?.p95_ms !== undefined ? Math.round(Number(agg.p95_ms)) : null,
      lastError: err
        ? { at: new Date(err.completed_at).toISOString(), message: err.error }
        : null,
    };
  });

  return json({
    window: {
      preset: period.preset,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      granularity: period.granularity,
    },
    data: { nodes: result },
  });
};
