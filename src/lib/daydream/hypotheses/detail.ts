// src/lib/daydream/hypotheses/detail.ts
//
// The days behind an answer.
//
// The board could say "r = −0.12, n = 58, q = 1.000" and there was no way to
// see what those 58 days actually were. A verdict you cannot open is a verdict
// you have to take on trust, which is the one thing this whole engine is
// arranged against.
//
// This returns the paired series the test itself used — the same `loadSeries`
// and the same `column` extraction, and the same lag alignment — so what the
// card shows and what the statistic was computed from cannot drift apart. It
// is deliberately NOT a fresh query with its own filters.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamHypotheses } from '$lib/db/schema';
import { column, loadSeries, loadSignalColumns } from '../stats/sweep';
import { isSignalKey } from './spec';

export interface PairedDay {
  /** The day the X value came from. Under a lag, Y comes from the next day. */
  day: string;
  a: number | null;
  b: number | null;
  /** True when this day contributed to the correlation — both halves present.
   *  Pairwise deletion is what makes `n` smaller than the window. */
  used: boolean;
}

export interface HypothesisDetail {
  id: string;
  question: string;
  rationale: string | null;
  subject: string;
  metricA: string;
  metricB: string;
  lagDays: number;
  direction: string;
  verdict: string | null;
  summary: string | null;
  r: number | null;
  qValue: number | null;
  pairs: number | null;
  familySize: number | null;
  windowDays: number;
  days: PairedDay[];
  /** Days in the window that contributed nothing, and why that is normal. */
  unusedCount: number;
}

const DEFAULT_WINDOW_DAYS = 120;

export async function loadHypothesisDetail(
  id: string,
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<HypothesisDetail | null> {
  const [h] = await db
    .select()
    .from(daydreamHypotheses)
    .where(eq(daydreamHypotheses.id, id))
    .limit(1);
  if (!h) return null;

  const rows = (await loadSeries({ windowDays, subject: h.subject })) as Array<
    Record<string, unknown>
  >;
  const signalKeys = [h.metricA, h.metricB].filter(isSignalKey);
  const signalCols = signalKeys.length
    ? await loadSignalColumns(signalKeys, { windowDays, subject: h.subject })
    : new Map<string, Map<string, number>>();
  const colOf = (key: string) =>
    isSignalKey(key) ? rows.map((r) => signalCols.get(key)?.get(String(r.day)) ?? null) : column(rows as never, key);
  const xs = colOf(h.metricA);
  const ys = colOf(h.metricB);

  // Same alignment the tester uses: with a lag, X on day i is paired with Y on
  // day i+1, so the last day has no partner and drops out.
  const days: PairedDay[] = [];
  const last = h.lagDays === 0 ? rows.length : rows.length - 1;
  for (let i = 0; i < last; i++) {
    const a = xs[i];
    const b = h.lagDays === 0 ? ys[i] : ys[i + 1];
    days.push({
      day: String((rows[i] as { day?: unknown }).day ?? ''),
      a,
      b,
      used: a != null && b != null,
    });
  }

  return {
    id: h.id,
    question: h.question,
    rationale: h.rationale,
    subject: h.subject,
    metricA: h.metricA,
    metricB: h.metricB,
    lagDays: h.lagDays,
    direction: h.direction,
    verdict: h.verdict,
    summary: h.summary,
    r: h.r,
    qValue: h.qValue,
    pairs: h.pairs,
    familySize: h.familySize,
    windowDays,
    days,
    unusedCount: days.filter((d) => !d.used).length,
  };
}
