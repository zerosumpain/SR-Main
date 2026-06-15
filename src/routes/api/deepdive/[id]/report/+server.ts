import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/deepdive/[id]/report
 * Returns the persisted ResearchReport jsonb for the report-preview node.
 * { report } when present, { report: null } when not yet generated.
 */
export const GET: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select({ id: researchSessions.id, report: researchSessions.report })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) {
    return json({ error: 'Session not found' }, { status: 404 });
  }

  return json({ report: session.report ?? null });
};
