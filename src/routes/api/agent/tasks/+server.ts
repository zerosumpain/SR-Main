import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { agentTasks } from '$lib/db/schema';
import { validateAgentKey, unauthorized } from '$lib/agent/auth';
import { emitActivity } from '$lib/agent/events';
import { desc, eq, inArray } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request }) => {
  if (!validateAgentKey(request)) return unauthorized();

  const body = await request.json();
  const [task] = await db
    .insert(agentTasks)
    .values({
      title: body.title,
      description: body.description ?? null,
      status: body.status ?? 'pending',
      priority: body.priority ?? 0,
      originChannel: body.originChannel ?? null,
      originSender: body.originSender ?? null,
      steps: body.steps ?? [],
      currentStep: body.currentStep ?? 0,
    })
    .returning();

  // Emit activity event
  emitActivity({
    id: 0,
    actionId: null,
    taskId: task.id,
    eventType: 'task_created',
    summary: `New task: ${task.title}`,
    metadata: { status: task.status, originChannel: task.originChannel },
    createdAt: new Date(),
  });

  return Response.json(task);
};

export const GET: RequestHandler = async ({ url, request }) => {
  if (!validateAgentKey(request)) return unauthorized();

  const status = url.searchParams.get('status');
  const limit = parseInt(url.searchParams.get('limit') ?? '50');

  const conditions = [];
  if (status) {
    const statuses = status.split(',');
    conditions.push(inArray(agentTasks.status, statuses));
  }

  const tasks = await db
    .select()
    .from(agentTasks)
    .where(conditions.length > 0 ? conditions[0] : undefined)
    .orderBy(desc(agentTasks.createdAt))
    .limit(limit);

  return Response.json(tasks);
};
