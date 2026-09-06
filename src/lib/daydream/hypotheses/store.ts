// src/lib/daydream/hypotheses/store.ts
//
// Persisting questions, and the board that shows them.

import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamHypotheses } from '$lib/db/schema';
import { DEFAULT_SUBJECT } from '../types';
import { hypothesisKey, type HypothesisSpec } from './spec';
import { RETEST_AFTER_DAYS } from './test';

export interface SaveResult {
  saved: number;
  /** Already on file — the same question, asked again. */
  duplicates: number;
}

/**
 * Write a batch of proposals as untested questions.
 *
 * `onConflictDoNothing` on (subject, key) rather than an update: a question
 * already on the board keeps its original `proposedAt`, which is what makes the
 * pre-registration claim auditable. Overwriting it with today's date would
 * quietly convert an old, honestly pre-registered question into one that
 * appears to have been proposed after the data was seen.
 */
export async function saveProposals(
  specs: HypothesisSpec[],
  opts: { tokens?: number; subject?: string } = {},
): Promise<SaveResult> {
  const subject = opts.subject ?? DEFAULT_SUBJECT;
  const result: SaveResult = { saved: 0, duplicates: 0 };
  if (specs.length === 0) return result;

  // The proposal cost is attributed across the batch it produced, so a question
  // on the board can say what it cost to think of.
  const perProposal = Math.round((opts.tokens ?? 0) / specs.length);

  for (const spec of specs) {
    const rows = await db
      .insert(daydreamHypotheses)
      .values({
        subject,
        hypothesisKey: hypothesisKey(spec),
        metricA: spec.a,
        metricB: spec.b,
        lagDays: spec.lagDays,
        direction: spec.direction,
        question: spec.question,
        rationale: spec.rationale,
        investigationPlan: spec.plan ?? null,
        proposalTokens: perProposal,
      })
      .onConflictDoNothing({
        target: [daydreamHypotheses.subject, daydreamHypotheses.hypothesisKey],
      })
      .returning({ id: daydreamHypotheses.id });

    if (rows.length) result.saved++;
    else result.duplicates++;
  }

  return result;
}

export interface BoardRow {
  id: string;
  /** Whose question this is. Carried since hypotheses became per-person —
   *  without it a board spanning the household is five people's questions in
   *  one undifferentiated list. */
  subject: string;
  question: string;
  rationale: string;
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
  retestCount: number;
  feedback: string | null;
  proposedAt: string;
  testedAt: string | null;
  lastRetestedAt: string | null;
  /** Days until this is asked again. Every verdict here is provisional —
   *  nothing is filtered by verdict when picking what to retest — and showing
   *  the horizon is what stops a refutation reading as a closed case. */
  retestInDays: number | null;
}

/**
 * The board, newest first, with the untested at the top.
 *
 * Everything is returned — supported, refuted, wrong-direction and untested
 * alike. Filtering to the supported ones here is exactly the edit that would
 * make this feature look clever and be useless: a board of only its hits cannot
 * be argued with.
 */
/**
 * The question board.
 *
 * `subject` selects one person; passing `null` spans the whole household,
 * which is what the Discoveries board does now that every person gets their
 * own questions. Ordering keeps answered questions after open ones and is
 * otherwise newest-first, so a five-person board still reads as one queue
 * rather than five interleaved ones.
 */
export async function loadBoard(
  limit = 60,
  subject: string | null = DEFAULT_SUBJECT,
): Promise<BoardRow[]> {
  const rows = await db
    .select()
    .from(daydreamHypotheses)
    .where(subject === null ? undefined : eq(daydreamHypotheses.subject, subject))
    .orderBy(sql`${daydreamHypotheses.verdict} is not null`, desc(daydreamHypotheses.proposedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    question: r.question,
    rationale: r.rationale,
    metricA: r.metricA,
    metricB: r.metricB,
    lagDays: r.lagDays,
    direction: r.direction,
    verdict: r.verdict,
    summary: r.summary,
    r: r.r,
    qValue: r.qValue,
    pairs: r.pairs,
    familySize: r.familySize,
    retestCount: r.retestCount,
    feedback: r.feedback,
    proposedAt: r.proposedAt.toISOString(),
    testedAt: r.testedAt?.toISOString() ?? null,
    lastRetestedAt: r.lastRetestedAt?.toISOString() ?? null,
    retestInDays: (() => {
      const last = r.lastRetestedAt ?? r.testedAt;
      if (!last) return null;
      const due = last.getTime() + RETEST_AFTER_DAYS * 86_400_000;
      return Math.max(0, Math.ceil((due - Date.now()) / 86_400_000));
    })(),
  }));
}

/** Counts by verdict, for the board header. */
export async function boardCounts(subject = DEFAULT_SUBJECT): Promise<Record<string, number>> {
  const rows = await db
    .select({ verdict: daydreamHypotheses.verdict, n: sql<number>`count(*)::int` })
    .from(daydreamHypotheses)
    .where(eq(daydreamHypotheses.subject, subject))
    .groupBy(daydreamHypotheses.verdict);
  return Object.fromEntries(rows.map((r) => [r.verdict ?? 'untested', r.n]));
}

/**
 * Record what John thought of the QUESTION.
 *
 * Deliberately not about the statistics — he cannot overrule a q-value and
 * should not be asked to. The signal is whether asking was worth it, and that
 * is what steers the next batch of proposals.
 */
export async function rateQuestion(
  id: string,
  feedback: 'useful' | 'not_useful',
): Promise<void> {
  await db
    .update(daydreamHypotheses)
    .set({ feedback, feedbackAt: new Date() })
    .where(and(eq(daydreamHypotheses.id, id)));
}
