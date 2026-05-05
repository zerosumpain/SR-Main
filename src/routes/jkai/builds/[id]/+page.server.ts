import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations, jkaiLogs } from '$lib/db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
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

  // V2 = pre-existing lanes-based view. V3 = single-pane terminal-style
  // stream — opt in via PUBLIC_BUILDS_V3=true. V2 stays as the default
  // until V3 has bedded in across a few real builds.
  const flagOn = publicEnv.PUBLIC_BUILDS_V2 === 'true';
  const v3 = publicEnv.PUBLIC_BUILDS_V3 === 'true';

  return { build, iterations, logs: logs.reverse(), flagOn, v3 };
};
