import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { agentActions } from '$lib/db/schema';
import { desc } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
  const actions = await db
    .select()
    .from(agentActions)
    .orderBy(desc(agentActions.createdAt))
    .limit(100);

  return { actions };
};
