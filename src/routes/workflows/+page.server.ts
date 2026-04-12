import { db } from '$lib/db';
import { workflows } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const rows = await db.select().from(workflows).orderBy(desc(workflows.createdAt));
  return { workflows: rows };
};
