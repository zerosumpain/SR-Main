import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations, jkaiLogs } from '$lib/db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const [build] = await db
    .select()
    .from(jkaiBuilds)
    .where(eq(jkaiBuilds.id, params.id));

  if (!build) throw error(404, 'Build not found');

  const iterations = await db
    .select()
    .from(jkaiIterations)
    .where(eq(jkaiIterations.buildId, params.id))
    .orderBy(asc(jkaiIterations.number));

  const logs = await db
    .select()
    .from(jkaiLogs)
    .where(eq(jkaiLogs.buildId, params.id))
    .orderBy(desc(jkaiLogs.id))
    .limit(200);

  return { build, iterations, logs: logs.reverse() };
};
