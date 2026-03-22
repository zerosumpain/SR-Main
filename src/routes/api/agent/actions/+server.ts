import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { agentActions } from '$lib/db/schema';
import { validateAgentKey, unauthorized } from '$lib/agent/auth';
import { desc, eq, and, gte, lte } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request }) => {
  if (!validateAgentKey(request)) return unauthorized();

  const body = await request.json();
  const [action] = await db
    .insert(agentActions)
    .values({
      taskId: body.taskId ?? null,
      sessionId: body.sessionId ?? null,
      actionType: body.actionType,
      toolName: body.toolName ?? null,
      input: body.input ?? null,
      output: body.output ?? null,
      reasoning: body.reasoning ?? null,
      durationMs: body.durationMs ?? null,
      tokensInput: body.tokensInput ?? null,
      tokensOutput: body.tokensOutput ?? null,
      costUsd: body.costUsd ?? null,
      provider: body.provider ?? null,
      model: body.model ?? null,
      status: body.status ?? 'completed',
      error: body.error ?? null,
    })
    .returning();

  return Response.json(action);
};

export const GET: RequestHandler = async ({ url, request }) => {
  if (!validateAgentKey(request)) return unauthorized();

  const limit = parseInt(url.searchParams.get('limit') ?? '50');
  const offset = parseInt(url.searchParams.get('offset') ?? '0');
  const actionType = url.searchParams.get('type');
  const taskId = url.searchParams.get('taskId');
  const since = url.searchParams.get('since');

  const conditions = [];
  if (actionType) conditions.push(eq(agentActions.actionType, actionType));
  if (taskId) conditions.push(eq(agentActions.taskId, taskId));
  if (since) conditions.push(gte(agentActions.createdAt, new Date(since)));

  const actions = await db
    .select()
    .from(agentActions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(agentActions.createdAt))
    .limit(limit)
    .offset(offset);

  return Response.json(actions);
};
