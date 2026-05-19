import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';

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
  let runId: string | null = url.searchParams.get('runId');
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
    // NULLS LAST: pending/aborted rows with no startedAt should sort to the
    // end so the Gantt renderer's bar-offset math (which uses run.startedAt
    // as t=0) doesn't place them ahead of completed nodes.
    .orderBy(sql`${nodeExecutions.startedAt} ASC NULLS LAST`);

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
