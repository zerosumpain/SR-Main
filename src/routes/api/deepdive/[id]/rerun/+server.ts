import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { startResearch } from '$lib/deepdive/worker';

export const POST: RequestHandler = async ({ params, request }) => {
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id));

  if (!session) {
    return json({ error: 'Session not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const goals = body.goals ?? session.goals;
  const config = body.config ? { ...(session.config as object), ...body.config } : session.config;

  // Reset session for re-run
  await db
    .update(researchSessions)
    .set({
      status: 'phase1',
      goals,
      config,
      report: null,
      completedAt: null,
    })
    .where(eq(researchSessions.id, params.id));

  // Start worker
  startResearch(params.id);

  return json({ message: 'Re-run started', id: params.id });
};
