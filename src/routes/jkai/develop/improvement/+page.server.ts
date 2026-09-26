import type { PageServerLoad } from './$types';
import { gte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts } from '$lib/db/schema';
import { errMsg } from '$lib/daydream/types';
import { loadLoopHealth, loopVerdict } from '$lib/builds/loop-health';
import { MIN_PAIRS } from '$lib/daydream/stats/tests';
import { loadImprovementDashboard } from '$lib/dashboard/improvement.server';
import { loadOvernight } from '$lib/builds/overnight.server';

/** The loop, end to end: ideas in → waiting for a tap → queued → built → notes. */
export interface LoopStory {
  /** Backlog items created in the last 7 days, by the channel they came in on. */
  intake: { week: number; byChannel: Record<string, number> };
  /** Open repo-build and watch items with no accepted brief — the owner's tap
   *  is what lets the nightly run spend on them. */
  awaitingTap: number;
  backlog: { open: number; engine: number; shipped: number };
  toolsBuilt: number;
  thoughts7d: number;
  error: string | null;
}

async function countThoughts7d(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(daydreamThoughts)
    .where(gte(daydreamThoughts.createdAt, new Date(Date.now() - 7 * 86_400_000)));
  return row?.n ?? 0;
}

async function loadLoopStory(loop: Awaited<ReturnType<typeof loadLoopHealth>>): Promise<LoopStory> {
  const empty: LoopStory = {
    intake: { week: 0, byChannel: {} },
    awaitingTap: 0,
    backlog: { open: 0, engine: 0, shipped: 0 },
    toolsBuilt: loop.tools.shippedRecently,
    thoughts7d: 0,
    error: null,
  };
  try {
    const { listBacklog, isOwnerAccepted } = await import('$lib/selfimprove/backlog');
    const [backlog, thoughts7d] = await Promise.all([listBacklog(undefined, { strict: true }), countThoughts7d()]);
    const weekAgo = Date.now() - 7 * 86_400_000;
    const week = backlog.filter((b) => Date.parse(b.createdAt ?? '') >= weekAgo);
    const byChannel: Record<string, number> = {};
    for (const b of week) byChannel[b.source ?? 'unattributed'] = (byChannel[b.source ?? 'unattributed'] ?? 0) + 1;
    const open = backlog.filter((b) => b.status === 'open' && !b.removedAt);
    return {
      ...empty,
      intake: { week: week.length, byChannel },
      awaitingTap: open.filter((b) => b.kind !== 'engine' && !b.buildRef && !isOwnerAccepted(b)).length,
      backlog: {
        open: open.length,
        engine: open.filter((b) => b.kind === 'engine').length,
        shipped: backlog.filter((b) => b.status === 'shipped').length,
      },
      thoughts7d,
    };
  } catch (err) {
    console.error('[daydream] loop story failed:', errMsg(err));
    return { ...empty, error: errMsg(err) };
  }
}

export const load: PageServerLoad = async () => {
  const [loop, improvement] = await Promise.all([
    loadLoopHealth(MIN_PAIRS),
    loadImprovementDashboard().catch((err) => {
      console.error('[daydream] improvement load failed:', errMsg(err));
      return null;
    }),
  ]);
  const [story, night] = await Promise.all([
    loadLoopStory(loop),
    // What actually ran, from the pulse ledger. Its own catch, because a night
    // that cannot be read must not take the whole room down with it.
    loadOvernight(),
  ]);
  return { loop, loopVerdict: loopVerdict(loop), improvement, story, night };
};
