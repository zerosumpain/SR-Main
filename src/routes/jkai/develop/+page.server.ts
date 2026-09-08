import { db } from '$lib/db';
import { jkaiBuildDeliveries, jkaiIterations } from '$lib/db/schema';
import { sql } from 'drizzle-orm';
import { getBuildList } from '$lib/jkai/queries';
import { laneStats } from '$lib/builds/lane-stats';
import { isCommissioned } from '$lib/jkai/development';
import type { PageServerLoad } from './$types';

/**
 * The archive half of the page — every build that is NOT a development feature.
 *
 * Server-rendered because it needs a join the client cannot cheaply do: real
 * iteration counts. `jkai_builds.iterations_completed` is a read-modify-write
 * over a row read at the top of an iteration, so concurrent iterations
 * discarded each other's increments and it disagrees with the row count on 33
 * of the first 83 builds. The lane table is the only honest measurement of the
 * builder and it must not be built on that column.
 *
 * The live portfolio stays a client fetch of `/api/jkai/development`, which is
 * what the release smoke asserts and what the workspace's own poll refreshes.
 */
export const load: PageServerLoad = async () => {
  const [all, counts, deliveries] = await Promise.all([
    getBuildList(),
    db
      .select({ buildId: jkaiIterations.buildId, n: sql<number>`count(*)::int` })
      .from(jkaiIterations)
      .groupBy(jkaiIterations.buildId),
    db.select({ buildId: jkaiBuildDeliveries.buildId, state: jkaiBuildDeliveries.state }).from(jkaiBuildDeliveries),
  ]);
  const byBuild = new Map(counts.map((c) => [c.buildId, c.n]));
  // A COMMISSIONED delivery is a development feature and belongs to the
  // portfolio above. A delivery row on its own is not enough: `pi-runner`
  // creates one for any build that asks the owner a question, and a forge or
  // studio build that did so would otherwise vanish from the archive along with
  // the only Promote, Unpublish and Delete controls it has.
  const isFeature = new Set(deliveries.filter((d) => isCommissioned(d.state)).map((d) => d.buildId));
  const builds = all.filter((b) => !isFeature.has(b.id));

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

  return {
    archive: builds.map((b) => ({ ...b, iterationCount: byBuild.get(b.id) ?? 0 })),
    lanes,
  };
};
