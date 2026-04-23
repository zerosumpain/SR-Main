import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { workflowInteractions } from '$lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { resumeRun } from '$lib/workflows/engine-resume';

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const session = await locals.auth();
  const runId = params.id!;
  const nodeId = params.nodeId!;

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const formValues = (body.formValues ?? {}) as Record<string, unknown>;

  // Find the pending interaction for this run + node.
  const [pending] = await db
    .select()
    .from(workflowInteractions)
    .where(
      and(
        eq(workflowInteractions.runId, runId),
        eq(workflowInteractions.nodeId, nodeId),
        isNull(workflowInteractions.resolvedAt),
      ),
    );

  if (!pending) return json({ error: 'no pending interaction' }, { status: 404 });
  if (pending.cancelled) return json({ error: 'interaction was cancelled' }, { status: 410 });

  await db
    .update(workflowInteractions)
    .set({
      resolvedAt: new Date(),
      resolvedBy: (session?.user as Record<string, unknown> | undefined)?.email as string | null ?? null,
      formValues,
    })
    .where(eq(workflowInteractions.id, pending.id));

  // Build the node's output for downstream consumption.
  const nodeOutput = {
    completed: true,
    completedAt: new Date().toISOString(),
    formValues,
    durationMs: Date.now() - new Date(pending.openedAt).getTime(),
  };

  await resumeRun(runId, { [nodeId]: nodeOutput });

  return json({ ok: true });
};

export const GET: RequestHandler = async ({ params }) => {
  const runId = params.id!;
  const nodeId = params.nodeId!;

  const [row] = await db
    .select()
    .from(workflowInteractions)
    .where(
      and(
        eq(workflowInteractions.runId, runId),
        eq(workflowInteractions.nodeId, nodeId),
      ),
    );

  if (!row) return json({ error: 'not found' }, { status: 404 });
  return json(row);
};
