import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id));

  if (!session) {
    throw redirect(302, '/deepdive');
  }

  if (session.status === 'complete') {
    throw redirect(302, `/deepdive/${params.id}/dashboard`);
  }

  return {
    session: {
      id: session.id,
      topic: session.topic,
      status: session.status,
      timeLimitMinutes: session.timeLimitMinutes,
      createdAt: session.createdAt.toISOString(),
    },
  };
};
