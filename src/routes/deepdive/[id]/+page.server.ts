// src/routes/deepdive/[id]/+page.server.ts
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params }) => {
  const [session] = await db
    .select({ id: researchSessions.id, topic: researchSessions.topic, status: researchSessions.status })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) throw error(404, 'Research session not found');

  return { sessionId: session.id, topic: session.topic ?? '', status: session.status };
};
