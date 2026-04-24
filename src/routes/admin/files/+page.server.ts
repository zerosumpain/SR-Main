import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { desc } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
  const rows = await db.select().from(workflowFiles).orderBy(desc(workflowFiles.updatedAt));
  return { files: rows };
};
