import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';
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

  const rawGroupBy = url.searchParams.get('groupBy') ?? 'model';
  const VALID_GROUP_BY: ReadonlyArray<GroupBy> = ['model', 'node-type', 'node-label'];
  if (!VALID_GROUP_BY.includes(rawGroupBy as GroupBy)) {
    return json(
      { error: `Invalid groupBy "${rawGroupBy}". Must be one of: ${VALID_GROUP_BY.join(', ')}` },
      { status: 400 },
    );
  }
  const groupBy = rawGroupBy as GroupBy;

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
             COALESCE(SUM(ne.cost_usd), 0)::text AS cost_usd,
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
             COALESCE(SUM(ne.cost_usd), 0)::text AS cost_usd,
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
             COALESCE(SUM(ne.cost_usd), 0)::text AS cost_usd,
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
