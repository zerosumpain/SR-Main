import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations } from '$lib/db/schema';
import { desc, sql } from 'drizzle-orm';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { laneStats } from '$lib/builds/lane-stats';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const builds = await db
    .select()
    .from(jkaiBuilds)
    .orderBy(desc(jkaiBuilds.createdAt));

  // Real iteration counts, not `iterations_completed` — that column is a
  // read-modify-write over a row read at the top of the iteration, so
  // concurrent iterations discarded each other's increments and it disagrees
  // with the row count on 33 of the first 83 builds.
  const counts = await db
    .select({
      buildId: jkaiIterations.buildId,
      n: sql<number>`count(*)::int`,
    })
    .from(jkaiIterations)
    .groupBy(jkaiIterations.buildId);
  const byBuild = new Map(counts.map((c) => [c.buildId, c.n]));

  const lanes = laneStats(
    builds.map((b) => ({
      origin: b.origin,
      gitTargetConfig: b.gitTargetConfig,
      status: b.status,
      outcome: b.outcome,
      planStatus: b.planStatus,
      iterationCount: byBuild.get(b.id) ?? 0,
      publishedSlug: b.publishedSlug,
    })),
  );

  const defaultBuilderModel = await resolveDefaultModel();

  return { builds, lanes, defaultBuilderModel };
};
