import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { RESEARCH_DEPTHS, depthPreset } from '$lib/deepdive/depth';
import { depthTimings } from '$lib/deepdive/timings';
import { STALE_AFTER_MS } from '$lib/deepdive/resume';

const TERMINAL = new Set(['complete', 'failed', 'paused', 'draft']);

export const load: PageServerLoad = async () => {
  const runs = await db
    .select({
      id: researchSessions.id,
      topic: researchSessions.topic,
      status: researchSessions.status,
      depth: researchSessions.depth,
      durationMs: researchSessions.durationMs,
      createdAt: researchSessions.createdAt,
      heartbeatAt: researchSessions.heartbeatAt,
    })
    .from(researchSessions)
    .orderBy(desc(researchSessions.createdAt))
    .limit(40);

  const now = Date.now();

  return {
    runs: runs.map(({ heartbeatAt, ...r }) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      /**
       * Mid-run, and nobody is working on it.
       *
       * Judged on `heartbeatAt`, which only a live worker writes — never by
       * subtracting `updatedAt`, which an unrelated write would refresh. The
       * list used to show these as though they were still going, which is how a
       * run sat stalled for four months without anyone noticing.
       */
      stalled:
        !TERMINAL.has(r.status) &&
        (!heartbeatAt || now - heartbeatAt.getTime() > STALE_AFTER_MS),
    })),
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
