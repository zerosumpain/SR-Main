// live.server.ts — the study's live numbers. Counts only.
//
// This is a public page, so the rule is narrow and absolute: a count, a stage name or a
// weekly total may leave the server; a note's words, a title, a link, a path or a person
// may not. Breakdowns by life area are left out too, because "how many health notes this
// week" says something about a person that "how many notes" doesn't.
//
// Each block is fetched on its own and fails on its own: a missing table or a cold database
// renders as a dash on that one figure, never as an error page. Results are memoised for
// five minutes per process, behind the layout's ten-minute edge cache.

import { isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { codegraphLessons, jkaiBuildDeliveries } from '$lib/db/schema';
import { loadImpact } from '$lib/daydream/impact.server';
import { developmentLane, type DevelopmentLane } from '$lib/builds/development-progress';

export interface LiveDaydream {
  windowDays: number;
  noticed: number;
  rated: number;
  hitRate: number | null;
  funnel: { spotted: number; decided: number; useful: number; actedOn: number; result: number };
  weeks: Array<{ start: string; useful: number; notUseful: number; undecided: number }>;
  checks: { awaiting: number; running: number; completed: number };
}

export interface LiveBuild {
  lanes: Partial<Record<DevelopmentLane, number>>;
  deliveries: number;
  lessons: number | null;
}

export interface Live {
  at: string;
  daydream: LiveDaydream | null;
  build: LiveBuild | null;
}

const TTL_MS = 5 * 60_000;
let memo: { at: number; value: Live } | null = null;

async function daydream(now: Date): Promise<LiveDaydream | null> {
  try {
    const { impact } = await loadImpact(now);
    return {
      windowDays: impact.windowDays,
      noticed: impact.current.noticed,
      rated: impact.current.rated,
      hitRate: impact.current.hitRate,
      funnel: { ...impact.funnel },
      weeks: impact.weeks.map((w) => ({ start: w.start, useful: w.useful, notUseful: w.notUseful, undecided: w.undecided })),
      checks: { ...impact.checks },
    };
  } catch (err) {
    console.error('[engine-room] live daydream counts unavailable:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function build(): Promise<LiveBuild | null> {
  try {
    const rows = await db.select({ state: jkaiBuildDeliveries.state }).from(jkaiBuildDeliveries);
    const lanes: Partial<Record<DevelopmentLane, number>> = {};
    let deliveries = 0;
    for (const { state } of rows) {
      // Same rule as /jkai/develop: a delivery row created only so a stray build could ask
      // a question is not a commissioned feature.
      if (!state || state.commissioned === false) continue;
      const lane = developmentLane(state);
      lanes[lane] = (lanes[lane] ?? 0) + 1;
      deliveries += 1;
    }
    let lessons: number | null = null;
    try {
      const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(codegraphLessons).where(isNull(codegraphLessons.retiredAt));
      lessons = r?.n ?? 0;
    } catch {
      lessons = null;
    }
    return { lanes, deliveries, lessons };
  } catch (err) {
    console.error('[engine-room] live build counts unavailable:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function loadLive(now = new Date()): Promise<Live> {
  if (memo && now.getTime() - memo.at < TTL_MS) return memo.value;
  const [d, b] = await Promise.all([daydream(now), build()]);
  const value: Live = { at: now.toISOString(), daydream: d, build: b };
  memo = { at: now.getTime(), value };
  return value;
}
