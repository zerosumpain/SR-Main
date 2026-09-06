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

import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamHypotheses, daydreamHypothesisAssessments } from '$lib/db/schema';
import { column, loadSeries, loadSignalColumns } from '../stats/sweep';
import { isSignalKey } from './spec';
import { pairEvidence } from './evidence';
import { parseInvestigationPlan, type InvestigationPlan } from './plan';

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
  plan: InvestigationPlan | null;
  evidenceAsOf: string | null;
  history: Array<{ at: string; phase: string; verdict: string; summary: string; pairs: number }>;

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

  const assessments = await db.select().from(daydreamHypothesisAssessments)
    .where(eq(daydreamHypothesisAssessments.hypothesisId, id))
    .orderBy(desc(daydreamHypothesisAssessments.assessedAt));
  const latest = assessments.find((a) => a.phase !== 'legacy');
  const asOf = latest?.assessedAt ?? h.lastRetestedAt ?? h.testedAt ?? new Date();
  windowDays = latest?.windowDays ?? windowDays;
  let days: PairedDay[];
  if (latest) {
    days = latest.evidence as PairedDay[];
  } else {
    const rows = (await loadSeries({ windowDays, subject: h.subject, now: asOf })) as Array<Record<string, unknown>>;
    const signalKeys = [h.metricA, h.metricB].filter(isSignalKey);
    const signalCols = signalKeys.length
      ? await loadSignalColumns(signalKeys, { windowDays, subject: h.subject, now: asOf })
      : new Map<string, Map<string, number>>();
    const colOf = (key: string) => isSignalKey(key)
      ? rows.map((r) => signalCols.get(key)?.get(String(r.day)) ?? null)
      : column(rows as never, key);
    days = pairEvidence(rows.map((r) => String(r.day)), colOf(h.metricA), colOf(h.metricB), h.lagDays);
  }

  return {
    plan: parseInvestigationPlan(h.investigationPlan),
    evidenceAsOf: latest?.assessedAt.toISOString() ?? null,
    history: assessments.map((a) => ({ at: a.assessedAt.toISOString(), phase: a.phase, verdict: a.verdict, summary: a.summary, pairs: a.pairs })),
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
