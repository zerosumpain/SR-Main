import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) return json({ error: 'Session not found' }, { status: 404 });

  // Get parent
  let parent: { id: string; topic: string } | null = null;
  if (session.parentSessionId) {
    const [p] = await db
      .select({ id: researchSessions.id, topic: researchSessions.topic })
      .from(researchSessions)
      .where(eq(researchSessions.id, session.parentSessionId))
      .limit(1);
    if (p) parent = p;
  }

  // Get children
  const children = await db
    .select({
      id: researchSessions.id,
      topic: researchSessions.topic,
      status: researchSessions.status,
      createdAt: researchSessions.createdAt,
    })
    .from(researchSessions)
    .where(eq(researchSessions.parentSessionId, params.id));

  return json({ parent, children });
};
