import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { resolveDefaultModel } from '$lib/server/models/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const builds = await db
    .select()
    .from(jkaiBuilds)
    .orderBy(desc(jkaiBuilds.createdAt));

  const defaultBuilderModel = await resolveDefaultModel();

  return { builds, defaultBuilderModel };
};
