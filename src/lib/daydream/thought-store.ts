// src/lib/daydream/thought-store.ts
//
// Giving a candidate an identity that survives recomputation.
//
// The detectors are pure functions over a snapshot, so they re-derive the same
// findings on every tick. Without a durable identity there is nothing to
// dismiss, nothing to snooze, and no yesterday to compare against — which is
// the same problem `intel_insights` was built to solve, and this follows its
// shape closely enough that the two should stay recognisable as siblings.
//
// `dedupeKey` IS the identity, and each detector owns its own because the right
// key genuinely differs by kind: asking twice about the same place is annoying,
// while a free-window suggestion should recur on a new day.

import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts } from '$lib/db/schema';
import { getSetting } from '$lib/server/models/settings';
import { SETTINGS_MUTED_KINDS_KEY } from './types';
import {
  coldStartThreshold,
  finalScore,
  kindWeight,
  tallyFeedback,
  type FeedbackRow,
  type FeedbackSource,
} from './scoring';
import type { Candidate } from './snapshot-types';

/**
 * Statuses a re-run must not touch.
 *
 * A dismissal is a judgement the owner made about a specific finding; silently
 * refreshing its text and score would turn "I decided this doesn't matter" into
 * "I decided this other thing doesn't matter". Snoozes are the same decision
 * with a timer, and an actioned thought is finished business.
 */
export const PROTECTED_STATUSES = ['dismissed', 'snoozed', 'actioned'] as const;

export interface PersistResult {
  created: number;
  updated: number;
  /** Left alone because the owner already ruled on them. */
  protectedSkipped: number;
  /** Written but marked suppressed, with a reason. */
  suppressed: number;
  /** Dropped before writing because the kind is muted outright. */
  muted: number;
  /** Dedupe keys inserted (not updated) this run — what lets a caller act
   *  exactly once per NEW thought instead of once per tick. */
  createdKeys: string[];
}

export const EMPTY_PERSIST: PersistResult = {
  created: 0,
  updated: 0,
  protectedSkipped: 0,
  suppressed: 0,
  muted: 0,
  createdKeys: [],
};

/** Kinds the owner has silenced with `never this kind`. An absolute mute:
 *  no statistics, no decay, no gradual return. */
export async function mutedKinds(): Promise<Set<string>> {
  const raw = await getSetting<string[]>(SETTINGS_MUTED_KINDS_KEY);
  return new Set(Array.isArray(raw) ? raw : []);
}

/** Every feedback row that still matters, for the learned weights. */
export async function loadFeedback(sinceDays = 180): Promise<FeedbackRow[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = await db
    .select({
      kind: daydreamThoughts.kind,
      feedback: daydreamThoughts.feedback,
      feedbackAt: daydreamThoughts.feedbackAt,
      placeId: daydreamThoughts.placeId,
      feedbackSource: daydreamThoughts.feedbackSource,
    })
    .from(daydreamThoughts)
    .where(and(isNotNull(daydreamThoughts.feedback), gte(daydreamThoughts.feedbackAt, since)));

  return rows
    .filter((r) => r.feedbackAt != null)
    .map((r) => ({
      kind: r.kind,
      feedback: r.feedback as FeedbackRow['feedback'],
      feedbackAt: r.feedbackAt as Date,
      placeId: r.placeId,
      feedbackSource: r.feedbackSource as FeedbackRow['feedbackSource'],
    }));
}

/** Learned multiplier per kind, plus the global threshold, computed once per
 *  tick so every candidate is judged against the same numbers. */
export function buildScoringContext(feedback: FeedbackRow[], now: Date) {
  const byKind = new Map<string, FeedbackRow[]>();
  for (const f of feedback) {
    const list = byKind.get(f.kind) ?? [];
    list.push(f);
    byKind.set(f.kind, list);
  }

  const weights = new Map<string, number>();
  for (const [kind, rows] of byKind) {
    weights.set(kind, kindWeight(tallyFeedback(rows, now)));
  }

  return {
    weightFor: (kind: string) => weights.get(kind) ?? 1,
    threshold: coldStartThreshold(feedback.length),
    feedbackCount: feedback.length,
  };
}

/**
 * Write this tick's candidates to the ledger.
 *
 * Everything lands, including what will never be delivered — a ledger that only
 * records what got through cannot answer the one question worth asking of this
 * feature. Sub-threshold candidates are written with `status: 'suppressed'` and
 * the reason, so the page can show what it nearly said and why it did not.
 *
 * Delivery itself is merge 4. Nothing here notifies anyone.
 */
export async function persistCandidates(
  candidates: Candidate[],
  opts: { runId: string; now?: Date },
): Promise<PersistResult> {
  const now = opts.now ?? new Date();
  const result: PersistResult = { ...EMPTY_PERSIST, createdKeys: [] };
  if (candidates.length === 0) return result;

  const muted = await mutedKinds();
  const feedback = await loadFeedback();
  const scoring = buildScoringContext(feedback, now);

  const keys = candidates.map((c) => c.dedupeKey);
  const existing = keys.length
    ? await db
        .select({
          id: daydreamThoughts.id,
          dedupeKey: daydreamThoughts.dedupeKey,
          status: daydreamThoughts.status,
        })
        .from(daydreamThoughts)
        .where(inArray(daydreamThoughts.dedupeKey, keys))
    : [];
  const byKey = new Map(existing.map((r) => [r.dedupeKey, r]));

  for (const candidate of candidates) {
    if (muted.has(candidate.kind)) {
      result.muted++;
      continue;
    }

    const weight = scoring.weightFor(candidate.kind);
    const { score, components } = finalScore(candidate.rawScore, weight, candidate.components);

    const belowThreshold = score < scoring.threshold;
    const status = belowThreshold ? 'suppressed' : 'new';
    const suppressedReason = belowThreshold
      ? `below_threshold (${score} < ${scoring.threshold})`
      : null;
    if (belowThreshold) result.suppressed++;

    const found = byKey.get(candidate.dedupeKey);

    if (found) {
      if ((PROTECTED_STATUSES as readonly string[]).includes(found.status)) {
        result.protectedSkipped++;
        continue;
      }
      await db
        .update(daydreamThoughts)
        .set({
          title: candidate.title,
          explanation: candidate.explanation,
          score,
          components,
          evidence: candidate.evidence,
          placeId: candidate.placeId ?? null,
          proposedActions: candidate.proposedActions,
          status,
          suppressedReason,
          runId: opts.runId,
          // How many ticks have re-proposed this exact thing. The row is still
          // one standing proposal rather than 144 a day, but the count survives
          // — which is what lets the triage deck lead with the things that keep
          // almost being said instead of whatever happened to be newest.
          recurrenceCount: sql`${daydreamThoughts.recurrenceCount} + 1`,
          updatedAt: now,
        })
        .where(eq(daydreamThoughts.id, found.id));
      result.updated++;
    } else {
      await db
        .insert(daydreamThoughts)
        .values({
          kind: candidate.kind,
          title: candidate.title,
          explanation: candidate.explanation,
          score,
          components,
          evidence: candidate.evidence,
          placeId: candidate.placeId ?? null,
          dedupeKey: candidate.dedupeKey,
          status,
          suppressedReason,
          proposedActions: candidate.proposedActions,
          runId: opts.runId,
          createdAt: now,
          updatedAt: now,
        })
        // Two ticks racing on the same key must not blow up the run; the
        // engine fires actions without a lock.
        .onConflictDoNothing({ target: daydreamThoughts.dedupeKey });
      result.created++;
      result.createdKeys.push(candidate.dedupeKey);
    }
  }

  return result;
}

/** Thoughts waiting to be said, best first. Merge 4 reads this. */
export async function listUndelivered(limit = 10) {
  return db
    .select()
    .from(daydreamThoughts)
    .where(eq(daydreamThoughts.status, 'new'))
    .orderBy(desc(daydreamThoughts.score))
    .limit(limit);
}

/** Wake anything whose snooze has expired, so it can be considered again. */
export async function wakeSnoozed(now = new Date()): Promise<number> {
  const woken = await db
    .update(daydreamThoughts)
    .set({ status: 'new', snoozeUntil: null, updatedAt: now })
    .where(
      and(
        eq(daydreamThoughts.status, 'snoozed'),
        isNotNull(daydreamThoughts.snoozeUntil),
        lt(daydreamThoughts.snoozeUntil, now),
      ),
    )
    .returning({ id: daydreamThoughts.id });
  return woken.length;
}

/** Record a verdict. `never_kind` also writes the absolute mute — the escape
 *  hatch has to be one tap, and one tap has to be final. */
export async function recordFeedback(
  thoughtId: string,
  verdict: 'useful' | 'not_useful' | 'never_kind',
  note?: string,
  source: FeedbackSource = 'explicit',
): Promise<{ kind: string; muted: boolean }> {
  const now = new Date();
  const [row] = await db
    .update(daydreamThoughts)
    .set({
      feedback: verdict,
      feedbackSource: source,
      feedbackNote: note?.slice(0, 500) ?? null,
      feedbackAt: now,
      status: verdict === 'useful' ? 'actioned' : 'dismissed',
      updatedAt: now,
    })
    .where(eq(daydreamThoughts.id, thoughtId))
    .returning({ kind: daydreamThoughts.kind });

  if (!row) throw new Error(`no such thought: ${thoughtId}`);

  if (verdict === 'never_kind') {
    const { setSetting } = await import('$lib/server/models/settings');
    const current = await mutedKinds();
    current.add(row.kind);
    await setSetting(SETTINGS_MUTED_KINDS_KEY, [...current]);
    return { kind: row.kind, muted: true };
  }

  return { kind: row.kind, muted: false };
}

/**
 * The sorting deck: things it nearly said, offered thirty at a time.
 *
 * The cold start is otherwise unreachable. `coldStartThreshold` needs about 25
 * responses to fall from 0.75 to its floor; `MAX_PER_DAY` is 4, and with no
 * push subscriber almost nothing is delivered at all — so at the observed rate
 * that number is never reached and every ranking mechanism downstream is a
 * random walk on an empty ledger.
 *
 * Suppressed thoughts are the natural material. They were judged not worth an
 * interruption, which is a guess the system made with no evidence, and they are
 * exactly the guesses worth checking. Rating one here costs nothing, because a
 * page he opened is attention already offered.
 *
 * Ordered by recurrence first: something proposed forty times and never said is
 * a far better question than something noticed once. That is the counterfactual
 * the recurrence counter exists to preserve.
 */
export async function loadTriageDeck(limit = 30) {
  return db
    .select({
      id: daydreamThoughts.id,
      kind: daydreamThoughts.kind,
      title: daydreamThoughts.title,
      explanation: daydreamThoughts.explanation,
      narrative: daydreamThoughts.narrative,
      verified: daydreamThoughts.verified,
      score: daydreamThoughts.score,
      recurrenceCount: daydreamThoughts.recurrenceCount,
      suppressedReason: daydreamThoughts.suppressedReason,
      createdAt: daydreamThoughts.createdAt,
    })
    .from(daydreamThoughts)
    .where(and(eq(daydreamThoughts.status, 'suppressed'), isNull(daydreamThoughts.feedback)))
    .orderBy(desc(daydreamThoughts.recurrenceCount), desc(daydreamThoughts.score))
    .limit(limit);
}

/**
 * Rule on a batch from the deck.
 *
 * Each verdict is written with `source: 'triage'` so it is worth 0.7 of a
 * considered one — real signal, priced for the attention it actually had.
 * Failures are collected rather than thrown: one bad id must not discard
 * twenty-nine answers the owner already gave.
 */
export async function recordTriageBatch(
  items: Array<{ id: string; verdict: 'useful' | 'not_useful' | 'never_kind' }>,
): Promise<{ recorded: number; muted: string[]; failed: Array<{ id: string; error: string }> }> {
  const muted: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  let recorded = 0;

  for (const item of items) {
    try {
      const res = await recordFeedback(item.id, item.verdict, undefined, 'triage');
      recorded++;
      if (res.muted) muted.push(res.kind);
    } catch (err) {
      failed.push({ id: item.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { recorded, muted, failed };
}

/** Counts by status, for the ledger page header. */
export async function thoughtCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: daydreamThoughts.status, n: sql<number>`count(*)::int` })
    .from(daydreamThoughts)
    .groupBy(daydreamThoughts.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
