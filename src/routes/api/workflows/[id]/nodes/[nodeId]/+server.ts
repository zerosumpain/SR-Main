import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowNodes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (body.config !== undefined) updates.config = body.config;
  if (typeof body.label === 'string') updates.label = body.label;
  if (body.position && typeof body.position === 'object') updates.position = body.position;

  if (Object.keys(updates).length === 0) {
    return json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  const [updated] = await db
    .update(workflowNodes)
    .set(updates)
    .where(and(eq(workflowNodes.id, params.nodeId), eq(workflowNodes.workflowId, params.id)))
    .returning();

  if (!updated) {
    return json({ error: 'Node not found' }, { status: 404 });
  }

  return json({ node: updated });
};
