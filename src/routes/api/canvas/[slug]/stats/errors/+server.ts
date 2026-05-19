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
        // Require completedAt so totalErrors stays consistent with what the
        // grouping loop actually processes — watchdog-reaped or mid-flight
        // crashed rows can have status='failed' but no completed_at.
        isNotNull(nodeExecutions.completedAt),
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
