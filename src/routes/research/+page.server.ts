import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { RESEARCH_DEPTHS, depthPreset } from '$lib/deepdive/depth';
import { depthTimings } from '$lib/deepdive/timings';

export const load: PageServerLoad = async () => {
  const runs = await db
    .select({
      id: researchSessions.id,
      topic: researchSessions.topic,
      status: researchSessions.status,
      depth: researchSessions.depth,
      durationMs: researchSessions.durationMs,
      createdAt: researchSessions.createdAt,
    })
    .from(researchSessions)
    .orderBy(desc(researchSessions.createdAt))
    .limit(40);

  return {
    runs: runs.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    // The picker quotes measured p50s rather than promised durations, so the
    // question "how long will this take" is answered from this machine's own
    // history. `budgetMs` is the ceiling the tier will not exceed.
    tiers: RESEARCH_DEPTHS.map((d) => {
      const p = depthPreset(d);
      return {
        depth: d,
        label: p.label,
        blurb: p.blurb,
        budgetMs: p.budgetMs,
        searches: p.searches,
        extractsFacts: p.extractsFacts,
      };
    }),
    timings: await depthTimings(),
  };
};
