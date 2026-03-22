import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { agentActivity } from '$lib/db/schema';
import { validateAgentKey, unauthorized } from '$lib/agent/auth';
import { emitActivity } from '$lib/agent/events';
import { desc, gte } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request }) => {
  if (!validateAgentKey(request)) return unauthorized();

  const body = await request.json();
  const [event] = await db
    .insert(agentActivity)
    .values({
      actionId: body.actionId ?? null,
      taskId: body.taskId ?? null,
      eventType: body.eventType,
      summary: body.summary,
      metadata: body.metadata ?? null,
    })
    .returning();

  // Emit to any connected SSE clients
  emitActivity({
    ...event,
    metadata: (event.metadata ?? null) as Record<string, unknown> | null,
  });

  return Response.json(event);
};

export const GET: RequestHandler = async ({ url, request }) => {
  if (!validateAgentKey(request)) return unauthorized();

  const limit = parseInt(url.searchParams.get('limit') ?? '100');
  const since = url.searchParams.get('since');

  const conditions = [];
  if (since) conditions.push(gte(agentActivity.createdAt, new Date(since)));

  const events = await db
    .select()
    .from(agentActivity)
    .where(conditions.length > 0 ? conditions[0] : undefined)
    .orderBy(desc(agentActivity.createdAt))
    .limit(limit);

  return Response.json(events);
};
