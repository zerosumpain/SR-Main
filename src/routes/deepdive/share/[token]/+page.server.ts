import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.shareToken, params.token));

  if (!session) throw error(404, 'Not found');

  return {
    readonly: true as const,
    session: {
      id: session.id,
      topic: session.topic,
      status: session.status,
      shareToken: session.shareToken,
      createdAt: session.createdAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
    },
  };
};
