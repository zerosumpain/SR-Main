import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
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

  let rows: Array<Record<string, string | number | null>> = [];

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
        AND wr.workflow_id = ${wf.id}
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
        COALESCE(SUM(ne.cost_usd), 0)::text AS cost_usd
      FROM node_executions ne
      INNER JOIN workflow_runs wr ON wr.id = ne.run_id
      WHERE ne.node_id = ${params.id}
        AND wr.workflow_id = ${wf.id}
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
        AND wr.workflow_id = ${wf.id}
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
      cache_read: string | null;
      tokens_in: string | null;
    }>(sql`
      SELECT
        date_trunc(${period.granularity}, wr.started_at) AS bucket,
        COALESCE(SUM(ne.cache_read_tokens), 0)::bigint AS cache_read,
        COALESCE(SUM(ne.tokens_input), 0)::bigint AS tokens_in
      FROM node_executions ne
      INNER JOIN workflow_runs wr ON wr.id = ne.run_id
      WHERE ne.node_id = ${params.id}
        AND wr.workflow_id = ${wf.id}
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
