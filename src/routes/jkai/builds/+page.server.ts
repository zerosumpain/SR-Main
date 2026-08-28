import { db } from '$lib/db';
import { jkaiIterations } from '$lib/db/schema';
import { sql } from 'drizzle-orm';
import { getBuildList } from '$lib/jkai/queries';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { laneStats } from '$lib/builds/lane-stats';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  // Three independent reads, one wave. `getBuildList` is the shared list
  // projection — the full row (prompt, research brief, chapter plan) belongs to
  // the detail view, not to a page that renders ninety cards.
  const [builds, counts, defaultBuilderModel] = await Promise.all([
    getBuildList(),
    // Real iteration counts, not `iterations_completed` — that column is a
    // read-modify-write over a row read at the top of the iteration, so
    // concurrent iterations discarded each other's increments and it disagrees
    // with the row count on 33 of the first 83 builds.
    db
      .select({
        buildId: jkaiIterations.buildId,
        n: sql<number>`count(*)::int`,
      })
      .from(jkaiIterations)
      .groupBy(jkaiIterations.buildId),
    resolveDefaultModel(),
  ]);
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

  return { builds, lanes, defaultBuilderModel };
};
