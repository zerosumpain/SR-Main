import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { agentTasks, agentActions } from '$lib/db/schema';
import { validateAgentKey, unauthorized } from '$lib/agent/auth';
import { emitActivity } from '$lib/agent/events';
import { eq, desc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, request }) => {
  if (!validateAgentKey(request)) return unauthorized();

  const task = await db
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, params.id))
    .limit(1);

  if (!task.length) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }

  // Include recent actions for this task
  const actions = await db
    .select()
    .from(agentActions)
    .where(eq(agentActions.taskId, params.id))
    .orderBy(desc(agentActions.createdAt))
    .limit(50);

  return Response.json({ ...task[0], actions });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  if (!validateAgentKey(request)) return unauthorized();

  const body = await request.json();
  const update: Record<string, unknown> = { updatedAt: new Date() };

  if (body.status !== undefined) update.status = body.status;
  if (body.title !== undefined) update.title = body.title;
  if (body.description !== undefined) update.description = body.description;
  if (body.steps !== undefined) update.steps = body.steps;
  if (body.currentStep !== undefined) update.currentStep = body.currentStep;
  if (body.result !== undefined) update.result = body.result;
  if (body.priority !== undefined) update.priority = body.priority;

  if (body.status === 'completed' || body.status === 'failed') {
    update.completedAt = new Date();
  }

  const [updated] = await db
    .update(agentTasks)
    .set(update)
    .where(eq(agentTasks.id, params.id))
    .returning();

  if (!updated) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }

  // Emit status change
  emitActivity({
    id: 0,
    actionId: null,
    taskId: updated.id,
    eventType: body.status === 'completed' ? 'tool_completed' : 'step_started',
    summary: `Task "${updated.title}" → ${updated.status}`,
    metadata: { status: updated.status, currentStep: updated.currentStep },
    createdAt: new Date(),
  });

  return Response.json(updated);
};
