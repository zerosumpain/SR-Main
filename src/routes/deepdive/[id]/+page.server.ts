import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';
import { buildDeskLoad } from './deskload';

export const load: PageServerLoad = async ({ params }) => {
  const [session] = await db
    .select({
      id: researchSessions.id,
      topic: researchSessions.topic,
      status: researchSessions.status,
      goals: researchSessions.goals,
      shareToken: researchSessions.shareToken,
      createdAt: researchSessions.createdAt,
      completedAt: researchSessions.completedAt,
    })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) throw redirect(302, '/deepdive');

  return buildDeskLoad(session);
};
