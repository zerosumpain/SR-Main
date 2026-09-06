// src/lib/daydream/hypotheses/test.ts
//
// Answering the questions, without a model anywhere near the answer.
//
// Every hypothesis due a verdict is tested in ONE batch and corrected together.
// That is not an optimisation — it is the only way the q-values mean anything.
// Correcting each claim in isolation as it arrives would be a fresh family of
// one every time, which is the same as no correction at all, and would quietly
// void the guarantee the statistics module exists to provide.

import { and, desc, eq, isNull, or, lt } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamHypotheses, daydreamHypothesisAssessments } from '$lib/db/schema';
import { benjaminiHochberg, correlate, DEFAULT_FDR } from '../stats/tests';
import { loadSeries, loadSignalColumns } from '../stats/sweep';
import { DEFAULT_SUBJECT, LOCAL_TZ, errMsg } from '../types';
import { isSignalKey, judge, MIN_PAIRS_FOR_VERDICT, type Direction } from './spec';
import { pairEvidence } from './evidence';

/** How stale a verdict may get before the question is asked again. */
export const RETEST_AFTER_DAYS = 14;

export interface TestRunResult {
  tested: number;
  supported: number;
  refuted: number;
  inconclusive: number;
  wrongDirection: number;
  underpowered: number;
  familySize: number;
  errors: string[];
}

export const EMPTY_TEST_RUN: TestRunResult = {
  tested: 0,
  supported: 0,
  refuted: 0,
  inconclusive: 0,
  wrongDirection: 0,
  underpowered: 0,
  familySize: 0,
  errors: [],
};

/**
 * Hypotheses that need a verdict: never tested, or tested long enough ago that
 * the window has meaningfully changed underneath them.
 *
 * Retesting matters in both directions. An underpowered question becomes
 * answerable as days accumulate, and — the one people forget — a supported
 * finding can stop holding. A board that never revisits its own conclusions is
 * a board of things that were true once.
 */
export async function hypothesesDueTesting(subject = DEFAULT_SUBJECT, now = new Date()) {
  const staleBefore = new Date(now.getTime() - RETEST_AFTER_DAYS * 86_400_000);
  return db
    .select()
    .from(daydreamHypotheses)
    .where(
      and(
        eq(daydreamHypotheses.subject, subject),
        or(
          isNull(daydreamHypotheses.testedAt),
          lt(daydreamHypotheses.lastRetestedAt, staleBefore),
          and(isNull(daydreamHypotheses.lastRetestedAt), lt(daydreamHypotheses.testedAt, staleBefore)),
        ),
      ),
    );
}

function column(rows: Array<Record<string, unknown>>, key: string): Array<number | null> {
  return rows.map((r) => {
    const v = r[key];
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  });
}

/**
 * Test everything due, correct across the batch, and write the verdicts.
 *
 * The correction family is the batch — the claims the model pre-registered —
 * not the several hundred pairs an exhaustive sweep would run. That is the
 * dividend of asking a model what is worth looking at: a much smaller m, and
 * therefore a real chance of anything surviving.
 */
export async function testDueHypotheses(
  opts: { windowDays?: number; fdr?: number; subject?: string; now?: Date } = {},
): Promise<TestRunResult> {
  const windowDays = opts.windowDays ?? 120;
  const fdr = opts.fdr ?? DEFAULT_FDR;
  const subject = opts.subject ?? DEFAULT_SUBJECT;
  const now = opts.now ?? new Date();
  const result: TestRunResult = { ...EMPTY_TEST_RUN, errors: [] };

  const due = await hypothesesDueTesting(subject, now);
  if (due.length === 0) return result;

  const rows = (await loadSeries({ windowDays, subject, now })) as Array<Record<string, unknown>>;

  // A hypothesis may name a registered SIGNAL as well as a day-feature column.
  // Signal series come from the observations table and are aligned to the
  // feature store's days here, so the two kinds pair up day for day.
  const signalKeys = [...new Set(due.flatMap((h) => [h.metricA, h.metricB]).filter(isSignalKey))];
  const signalCols = await loadSignalColumns(signalKeys, { windowDays, subject, now });
  const cols = new Map<string, Array<number | null>>();
  const colFor = (key: string) => {
    let c = cols.get(key);
    if (!c) {
      c = isSignalKey(key)
        ? rows.map((r) => signalCols.get(key)?.get(String(r.day)) ?? null)
        : column(rows, key);
      cols.set(key, c);
    }
    return c;
  };

  const stats = [];
  for (const h of due) {
    const days = rows.map((r) => String(r.day));
    const xs = colFor(h.metricA);
    const ys = colFor(h.metricB);
    const future = pairEvidence(days, xs, ys, h.lagDays, new Intl.DateTimeFormat('en-CA', { timeZone: LOCAL_TZ }).format(h.proposedAt));
    const prospective = future.filter((d) => d.used).length >= MIN_PAIRS_FOR_VERDICT;
    const evidence = prospective ? future : pairEvidence(days, xs, ys, h.lagDays);
    const phase = prospective ? 'prospective' : 'exploratory';
    const [previous] = await db.select().from(daydreamHypothesisAssessments)
      .where(eq(daydreamHypothesisAssessments.hypothesisId, h.id))
      .orderBy(desc(daydreamHypothesisAssessments.assessedAt)).limit(1);
    // A heartbeat is not another piece of evidence. Do not spend a new look on
    // unchanged observations or write a second copy of the same assessment.
    if (previous?.phase === phase && JSON.stringify((previous.evidence as typeof evidence).map((d) => [d.day, d.a, d.b])) === JSON.stringify(evidence.map((d) => [d.day, d.a, d.b]))) continue;
    const res = correlate(evidence.map((d) => d.a), evidence.map((d) => d.b));
    const looks = h.testedAt ? h.retestCount + 2 : 1;
    // Summable spending weights 1/(k*(k+1)); the previous 1/k allowance
    // diverged over an unbounded sequence of looks. These remain exploratory
    // associations, not causal proof or a calibrated probability of truth.
    stats.push({ item: h, p: Math.min(1, res.p * looks * (looks + 1)), r: res.r, n: res.n, phase, evidence });
  }

  // ONE correction across the whole batch.
  const corrected = benjaminiHochberg(
    stats.map((s) => ({ item: s, p: s.p })),
    fdr,
  );
  result.familySize = corrected.length;

  for (const c of corrected) {
    const { item: stat } = c;
    const h = stat.item;
    try {
      const outcome = judge(
        { direction: h.direction as Direction },
        { r: stat.r, p: stat.p, qValue: c.qValue, n: stat.n },
        fdr,
      );

      if (stat.phase === 'exploratory' && outcome.verdict !== 'underpowered') {
        outcome.summary = `Exploratory only: ${outcome.summary} Waiting for ${MIN_PAIRS_FOR_VERDICT} overlapping days after the question was proposed.`;
        outcome.verdict = 'inconclusive';
      }
      const saved = await db.transaction(async (tx) => {
        // Optimistic concurrency prevents overlapping heartbeat workers from
        // advancing the same investigation twice from one starting verdict.
        const updated = await tx.update(daydreamHypotheses).set({
          verdict: outcome.verdict, summary: outcome.summary, r: outcome.r,
          pValue: outcome.p, qValue: outcome.qValue, pairs: outcome.n,
          familySize: corrected.length, fdr,
          testedAt: h.testedAt ?? now, lastRetestedAt: now,
          retestCount: h.testedAt ? h.retestCount + 1 : h.retestCount,
        }).where(and(eq(daydreamHypotheses.id, h.id),
          h.lastRetestedAt ? eq(daydreamHypotheses.lastRetestedAt, h.lastRetestedAt) : isNull(daydreamHypotheses.lastRetestedAt),
        )).returning({ id: daydreamHypotheses.id });
        if (!updated.length) return false;
        await tx.insert(daydreamHypothesisAssessments).values({
          hypothesisId: h.id, assessedAt: now, phase: stat.phase,
          verdict: outcome.verdict, summary: outcome.summary, windowDays,
          r: outcome.r, pValue: outcome.p, qValue: outcome.qValue, pairs: outcome.n,
          familySize: corrected.length, fdr, evidence: stat.evidence,
        });
        return true;
      });
      if (!saved) continue;

      result.tested++;
      if (outcome.verdict === 'supported') result.supported++;
      else if (outcome.verdict === 'refuted') result.refuted++;
      else if (outcome.verdict === 'inconclusive') result.inconclusive++;
      else if (outcome.verdict === 'wrong_direction') result.wrongDirection++;
      else result.underpowered++;
    } catch (err) {
      result.errors.push(`${h.id}: ${errMsg(err)}`);
    }
  }

  return result;
}

/** Keys already on file, so the proposer is not asked the same thing twice. */
export async function existingKeys(subject = DEFAULT_SUBJECT): Promise<string[]> {
  const rows = await db
    .select({ k: daydreamHypotheses.hypothesisKey })
    .from(daydreamHypotheses)
    .where(eq(daydreamHypotheses.subject, subject));
  return rows.map((r) => r.k);
}
