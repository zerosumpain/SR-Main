import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { env as publicEnv } from '$env/dynamic/public';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const builds = await db
    .select()
    .from(jkaiBuilds)
    .orderBy(desc(jkaiBuilds.createdAt));

  const defaultBuilderModel = await resolveDefaultModel('builder');
  const flagOn = publicEnv.PUBLIC_BUILDS_V2 === 'true';

  return { builds, defaultBuilderModel, flagOn };
};
