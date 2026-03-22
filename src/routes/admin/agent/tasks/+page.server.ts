import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { agentTasks } from '$lib/db/schema';
import { desc } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
  const tasks = await db
    .select()
    .from(agentTasks)
    .orderBy(desc(agentTasks.createdAt))
    .limit(100);

  return { tasks };
};
