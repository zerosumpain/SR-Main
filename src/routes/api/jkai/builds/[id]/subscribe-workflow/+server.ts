import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { buildWorkflowSubscriptions, jkaiBuilds, workflows } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

async function readWorkflowId(request: Request): Promise<string | null> {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const v = body.workflowId;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export const POST: RequestHandler = async ({ params, request }) => {
  const buildId = params.id!;
  const workflowId = await readWorkflowId(request);
  if (!workflowId) throw error(400, 'workflowId required');

  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId)).limit(1);
  if (!build) throw error(404, 'build not found');
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  if (!wf) throw error(404, 'workflow not found');

  await db
    .insert(buildWorkflowSubscriptions)
    .values({ buildId, workflowId })
    .onConflictDoNothing();
  return json({ buildId, workflowId, subscribed: true });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  const buildId = params.id!;
  const workflowId = await readWorkflowId(request);
  if (!workflowId) throw error(400, 'workflowId required');

  await db
    .delete(buildWorkflowSubscriptions)
    .where(and(eq(buildWorkflowSubscriptions.buildId, buildId), eq(buildWorkflowSubscriptions.workflowId, workflowId)));
  return json({ buildId, workflowId, subscribed: false });
};

export const GET: RequestHandler = async ({ params }) => {
  const buildId = params.id!;
  const subs = await db
    .select()
    .from(buildWorkflowSubscriptions)
    .where(eq(buildWorkflowSubscriptions.buildId, buildId));
  return json(subs);
};
