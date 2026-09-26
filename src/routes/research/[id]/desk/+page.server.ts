import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';
import { buildDeskLoad } from './deskload';
import { areaAccess, readable } from '$lib/server/area-scope';

export const load: PageServerLoad = async (event) => {
  const { params } = event;
  const access = await areaAccess(event, 'research');
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
    // A run the caller may not read looks exactly like one that does not exist.
    .where(and(eq(researchSessions.id, params.id), readable(researchSessions.principalId, access)))
    .limit(1);

  if (!session) throw redirect(302, '/research');
  return buildDeskLoad(session);
};
