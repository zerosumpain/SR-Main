import type { PageServerLoad } from './$types';
import { gte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts } from '$lib/db/schema';
import { errMsg } from '$lib/daydream/types';
import { loadLoopHealth, loopVerdict } from '$lib/builds/loop-health';
import { MIN_PAIRS } from '$lib/daydream/stats/tests';
import { loadImprovementControls, loadImprovementDashboard } from '$lib/dashboard/improvement.server';
import { loadOvernight } from '$lib/builds/overnight.server';
import { isOwnerRequest } from '$lib/server/owner';

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

export const load: PageServerLoad = async (event) => {
  if (!(await isOwnerRequest(event))) {
    // jkai · develop, read-only for a member: the loop's counts and the
    // night's timeline as passes and timings. Never the improvement ledger —
    // its insights are mined from the owner's own chat questions and its
    // attempts carry tool arguments and results — nor a pass's summary or cost.
    const loop = await loadLoopHealth(MIN_PAIRS);
    const [story, night] = await Promise.all([loadLoopStory(loop), loadOvernight()]);
    return {
      loop,
      loopVerdict: loopVerdict(loop),
      improvement: null,
      story,
      night: {
        ...night,
        costUsd: 0,
        dearest: null,
        passes: night.passes.map((p) => ({ ...p, summary: '', costUsd: 0, href: null })),
      },
      controls: null,
      member: true,
    };
  }
  const [loop, improvement, controls] = await Promise.all([
    loadLoopHealth(MIN_PAIRS),
    loadImprovementDashboard().catch((err) => {
      console.error('[daydream] improvement load failed:', errMsg(err));
      return null;
    }),
    // The switches folded in from /admin/ai/improvement — owner only.
    loadImprovementControls().catch((err) => {
      console.error('[daydream] improvement controls load failed:', errMsg(err));
      return null;
    }),
  ]);
  const [story, night] = await Promise.all([
    loadLoopStory(loop),
    // What actually ran, from the pulse ledger. Its own catch, because a night
    // that cannot be read must not take the whole room down with it.
    loadOvernight(),
  ]);
  return { loop, loopVerdict: loopVerdict(loop), improvement, story, night, controls, member: false };
};
