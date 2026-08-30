// src/lib/daydream/loop-health.ts
//
// Is the loop closing?
//
// The self-improvement engine and daydreaming are one engine now, and the whole
// case for merging them rested on a single number nothing displayed: **33 tools
// shipped in the fortnight to 2026-08-30, and not one ever called.** The engine
// mined a question for an unmet need, authored a tool, auto-enabled it and then
// waited for a chat turn that never came.
//
// Two dashboards showed a great deal about that engine — runs, phases, budget,
// generated code — and neither showed whether any of it was ever used. This is
// the scoreboard for the merge: what was built, whether it is being called,
// whether it became a measurement, and what is driving the next build.
//
// Every figure is a count of rows. Nothing here is inferred, and where a number
// cannot be established it is null rather than zero — "no tools have been
// called" and "we could not tell" are different answers and only one of them is
// a reason to go and look.

import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { customTools, daydreamSignals } from '$lib/db/schema';
import { errMsg } from './types';

export interface LoopHealth {
  tools: {
    total: number;
    enabled: number;
    /** Ever called, all time. */
    everCalled: number;
    /** Shipped inside the window below. */
    shippedRecently: number;
    /** Of those, how many have been called. THE number. */
    shippedRecentlyCalled: number;
    windowDays: number;
  };
  /** Signals whose source is a self-built tool — the return edge. */
  toolSignals: {
    registered: number;
    /** Have recorded at least one reading. */
    observing: number;
    /** Have enough days to be correlated. */
    sweepable: number;
    minPairs: number;
  } | null;
  /** Null when the query failed, so the page can say so rather than show zeros. */
  error: string | null;
}

const WINDOW_DAYS = 14;

export async function loadLoopHealth(minPairs: number): Promise<LoopHealth> {
  const empty: LoopHealth = {
    tools: {
      total: 0,
      enabled: 0,
      everCalled: 0,
      shippedRecently: 0,
      shippedRecentlyCalled: 0,
      windowDays: WINDOW_DAYS,
    },
    toolSignals: null,
    error: null,
  };

  try {
    const [tools] = await db
      .select({
        total: sql<number>`count(*)::int`,
        enabled: sql<number>`count(*) filter (where ${customTools.enabled})::int`,
        everCalled: sql<number>`count(*) filter (where coalesce(${customTools.runCount}, 0) > 0)::int`,
        shippedRecently: sql<number>`count(*) filter (where ${customTools.createdAt} > now() - interval '${sql.raw(String(WINDOW_DAYS))} days')::int`,
        shippedRecentlyCalled: sql<number>`count(*) filter (where ${customTools.createdAt} > now() - interval '${sql.raw(String(WINDOW_DAYS))} days' and coalesce(${customTools.runCount}, 0) > 0)::int`,
      })
      .from(customTools);

    const [signals] = await db
      .select({
        registered: sql<number>`count(*)::int`,
        observing: sql<number>`count(*) filter (where ${daydreamSignals.observedDays} > 0)::int`,
        sweepable: sql<number>`count(*) filter (where ${daydreamSignals.observedDays} >= ${minPairs})::int`,
      })
      .from(daydreamSignals)
      .where(sql`${daydreamSignals.source} = 'tool' and ${daydreamSignals.status} = 'active'`);

    return {
      tools: {
        total: Number(tools?.total ?? 0),
        enabled: Number(tools?.enabled ?? 0),
        everCalled: Number(tools?.everCalled ?? 0),
        shippedRecently: Number(tools?.shippedRecently ?? 0),
        shippedRecentlyCalled: Number(tools?.shippedRecentlyCalled ?? 0),
        windowDays: WINDOW_DAYS,
      },
      toolSignals: {
        registered: Number(signals?.registered ?? 0),
        observing: Number(signals?.observing ?? 0),
        sweepable: Number(signals?.sweepable ?? 0),
        minPairs,
      },
      error: null,
    };
  } catch (err) {
    console.error('[daydream] loop health failed:', errMsg(err));
    return { ...empty, error: errMsg(err) };
  }
}

/**
 * The one-line verdict.
 *
 * Deliberately refuses to congratulate itself on a small sample: a single tool
 * called once is not a closed loop, and a scoreboard that says "healthy" at n=1
 * is the kind of thing nobody trusts the second time.
 */
export function loopVerdict(h: LoopHealth): { state: 'closed' | 'opening' | 'open' | 'unknown'; line: string } {
  if (h.error) return { state: 'unknown', line: 'Could not read the loop’s state.' };
  const { shippedRecently, shippedRecentlyCalled, windowDays } = h.tools;
  const observing = h.toolSignals?.observing ?? 0;

  if (shippedRecently === 0 && observing === 0) {
    return { state: 'unknown', line: `Nothing shipped in ${windowDays} days and no tool is being sampled.` };
  }
  if (observing > 0 && shippedRecentlyCalled > 0) {
    return {
      state: 'closed',
      line: `${shippedRecentlyCalled} of ${shippedRecently} tools built in ${windowDays} days are being called, and ${observing} are recording a series.`,
    };
  }
  if (observing > 0) {
    return {
      state: 'opening',
      line: `${observing} self-built tool(s) are recording a series, but none of the last ${windowDays} days’ builds has been called yet.`,
    };
  }
  return {
    state: 'open',
    line: `${shippedRecently} tool(s) built in ${windowDays} days and none is being called or sampled.`,
  };
}
