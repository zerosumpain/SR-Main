// src/lib/daydream/hypotheses/test.ts
//
// Answering the questions, without a model anywhere near the answer.
//
// Every hypothesis due a verdict is tested in ONE batch and corrected together.
// That is not an optimisation — it is the only way the q-values mean anything.
// Correcting each claim in isolation as it arrives would be a fresh family of
// one every time, which is the same as no correction at all, and would quietly
// void the guarantee the statistics module exists to provide.

import { and, eq, inArray, isNull, or, lt, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamHypotheses } from '$lib/db/schema';
import { benjaminiHochberg, correlate, DEFAULT_FDR } from '../stats/tests';
import { loadSeries, loadSignalColumns } from '../stats/sweep';
import { DEFAULT_SUBJECT, errMsg } from '../types';
import { isSignalKey, judge, type Direction } from './spec';

/** How stale a verdict may get before the question is asked again. */
export const RETEST_AFTER_DAYS = 14;

export interface TestRunResult {
  tested: number;
  supported: number;
  refuted: number;
  wrongDirection: number;
  underpowered: number;
  familySize: number;
  errors: string[];
}

export const EMPTY_TEST_RUN: TestRunResult = {
  tested: 0,
  supported: 0,
  refuted: 0,
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
export async function hypothesesDueTesting(subject = DEFAULT_SUBJECT) {
  const staleBefore = new Date(Date.now() - RETEST_AFTER_DAYS * 86_400_000);
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

  const due = await hypothesesDueTesting(subject);
  if (due.length === 0) return result;

  const rows = (await loadSeries({ windowDays, subject, now })) as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    result.errors.push('no day features to test against');
    return result;
  }

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

  const stats = due.map((h) => {
    const xs = colFor(h.metricA);
    const ys = colFor(h.metricB);
    const res =
      h.lagDays === 0
        ? correlate(xs, ys)
        : correlate(xs.slice(0, -1), ys.slice(1));
    // Alpha spending across repeated looks. Without it, asking the same question
    // every fortnight eventually manufactures a hit even when every individual
    // test is valid. Bonferroni over this hypothesis's observed looks is simple,
    // auditable, and conservative in the safe direction.
    const looks = Math.max(1, h.retestCount + 1);
    return { item: h, p: Math.min(1, res.p * looks), r: res.r, n: res.n };
  });

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

      await db
        .update(daydreamHypotheses)
        .set({
          verdict: outcome.verdict,
          summary: outcome.summary,
          r: outcome.r,
          pValue: outcome.p,
          qValue: outcome.qValue,
          pairs: outcome.n,
          familySize: corrected.length,
          fdr,
          testedAt: h.testedAt ?? now,
          lastRetestedAt: now,
          retestCount: h.testedAt ? h.retestCount + 1 : h.retestCount,
        })
        .where(eq(daydreamHypotheses.id, h.id));

      result.tested++;
      if (outcome.verdict === 'supported') result.supported++;
      else if (outcome.verdict === 'refuted') result.refuted++;
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
