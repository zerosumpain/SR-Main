// src/lib/daydream/rooms/overnight.server.ts
//
// The night, as a run of passes.
//
// The improvement room could say what the loop PRODUCED but never what
// actually ran to produce it: six activities fire inside one window, against
// one budget, and the only surface for that was a rollup cell counting tools.
// A night that overruns is a night that stops rather than a night that spends,
// so "what ran, for how long, and what did it cost" is the fact that says
// whether the window is holding.
//
// One grouped query, keyed on the `ts` index. Every figure is a stamp the
// heartbeat already wrote — nothing here is derived from a schedule's
// intention, because an activity that was scheduled and did not fire is
// exactly the case this panel exists to show.

import { and, desc, gte, like, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { heartbeatActions, heartbeatPulses } from '$lib/db/schema';
import { errMsg } from '$lib/daydream/types';

/** One activity's turn in the window, folded from however many pulses it wrote. */
export interface OvernightPass {
  /** The heartbeat action name — `daydream-ponder`. */
  name: string;
  /** The name as a word: `Ponder`. */
  label: string;
  /** When it started: the FIRST pulse of the pass, not the last. */
  at: string;
  durationMs: number | null;
  /** The terminal outcome, preferring a real result over the `fired` that opened it. */
  outcome: string;
  summary: string;
  costUsd: number;
}

export interface Overnight {
  passes: OvernightPass[];
  startedAt: string | null;
  finishedAt: string | null;
  costUsd: number;
  /** The name of the pass that cost the most — the one worth tinting. */
  dearest: string | null;
  error: string | null;
}

export const EMPTY_OVERNIGHT: Overnight = {
  passes: [],
  startedAt: null,
  finishedAt: null,
  costUsd: 0,
  dearest: null,
  error: null,
};

/** `daydream-ponder` → `Ponder`. The registry has no display names, and a
 *  hard-coded map would silently omit the next activity added. */
function labelOf(name: string): string {
  const tail = name.replace(/^daydream-/, '').replace(/[-_]+/g, ' ');
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

/**
 * A pulse row that opened a pass rather than reporting one.
 *
 * `fired` is written when an activity starts, so a window whose last activity
 * is still running has a trailing `fired` with no duration. Preferring any
 * other outcome keeps the cell describing the RESULT where there is one, and
 * still shows the pass as started where there is not.
 */
const OPENING = 'fired';

/**
 * The last window of daydream activity.
 *
 * "Last night" is defined from the data, not from the clock: take the most
 * recent daydream pulse and reach back `windowHours` from it. A fixed
 * 02:30–03:55 would print an empty panel on any night the heartbeat ran late,
 * and an empty panel and a night that did not run look identical.
 */
export async function loadOvernight(windowHours = 6): Promise<Overnight> {
  try {
    const [latest] = await db
      .select({ ts: heartbeatPulses.ts })
      .from(heartbeatPulses)
      .innerJoin(heartbeatActions, sql`${heartbeatActions.id} = ${heartbeatPulses.actionId}`)
      .where(like(heartbeatActions.name, 'daydream-%'))
      .orderBy(desc(heartbeatPulses.ts))
      .limit(1);
    if (!latest?.ts) return EMPTY_OVERNIGHT;

    const from = new Date(latest.ts.getTime() - windowHours * 3_600_000);
    const rows = await db
      .select({
        name: heartbeatActions.name,
        ts: heartbeatPulses.ts,
        outcome: heartbeatPulses.outcome,
        summary: heartbeatPulses.summary,
        durationMs: heartbeatPulses.durationMs,
        costUsd: heartbeatPulses.costUsd,
      })
      .from(heartbeatPulses)
      .innerJoin(heartbeatActions, sql`${heartbeatActions.id} = ${heartbeatPulses.actionId}`)
      .where(and(like(heartbeatActions.name, 'daydream-%'), gte(heartbeatPulses.ts, from)))
      .orderBy(heartbeatPulses.ts);

    // Fold to one cell per activity. Cost SUMS across the pass's pulses —
    // MAX would under-report an activity that billed twice, which is the
    // aggregation error this codebase has already made once on health metrics.
    const byName = new Map<string, OvernightPass>();
    for (const r of rows) {
      const cost = Number(r.costUsd ?? 0) || 0;
      const prev = byName.get(r.name);
      if (!prev) {
        byName.set(r.name, {
          name: r.name,
          label: labelOf(r.name),
          at: r.ts.toISOString(),
          durationMs: r.durationMs ?? null,
          outcome: r.outcome,
          summary: r.summary,
          costUsd: cost,
        });
        continue;
      }
      prev.costUsd += cost;
      if (r.durationMs != null) prev.durationMs = r.durationMs;
      // Keep the first `at` (the pass started then) and the most informative
      // outcome. A later `fired` never overwrites an `ok` already recorded.
      if (r.outcome !== OPENING || prev.outcome === OPENING) {
        prev.outcome = r.outcome;
        prev.summary = r.summary;
      }
    }

    const passes = [...byName.values()].sort((a, b) => a.at.localeCompare(b.at));
    const costUsd = passes.reduce((a, p) => a + p.costUsd, 0);
    const dearest = passes.reduce<OvernightPass | null>(
      (best, p) => (p.costUsd > 0 && (!best || p.costUsd > best.costUsd) ? p : best),
      null,
    );
    return {
      passes,
      startedAt: passes[0]?.at ?? null,
      finishedAt: passes.length ? passes[passes.length - 1].at : null,
      costUsd,
      dearest: dearest?.name ?? null,
      error: null,
    };
  } catch (err) {
    console.error('[daydream] overnight load failed:', errMsg(err));
    return { ...EMPTY_OVERNIGHT, error: errMsg(err) };
  }
}
