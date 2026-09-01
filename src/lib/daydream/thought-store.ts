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

import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts } from '$lib/db/schema';
import { getSetting } from '$lib/server/models/settings';
import { LOCAL_TZ, SETTINGS_MUTED_KINDS_KEY, errMsg } from './types';
import { echoOf, loadRefutedClaims, type RefutedClaim } from './refutations';
import {
  adaptiveThreshold,
  contextKey,
  contextualWeight,
  finalScore,
  hourBand,
  kindWeight,
  mergeCounts,
  tallyFeedback,
  tallyRelevance,
  RELEVANCE_MAX,
  RELEVANCE_MIN,
  type FeedbackRow,
  type FeedbackSource,
  type RelevanceRow,
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
/**
 * `archived` belongs here for exactly the same reason, and its absence was a
 * real bug for as long as it lasted: filing a card away with OK is a judgement
 * about that specific finding, and `persistCandidates` runs every ten minutes.
 * Left unprotected, the detect tick re-derives the same candidate, finds the
 * row by `dedupeKey`, and rewrites it back to `new` or `suppressed` — so the
 * button would have looked like it worked and then quietly undone itself
 * before the page was next opened. Any new "the owner has ruled on this"
 * status must be added here in the same commit that introduces it, and
 * `archive.test.ts` asserts that without needing a database.
 */
export const PROTECTED_STATUSES = ['dismissed', 'snoozed', 'actioned', 'archived'] as const;

export interface PersistResult {
  created: number;
  updated: number;
  /** Left alone because the owner already ruled on them. */
  protectedSkipped: number;
  /** Written but marked suppressed, with a reason. */
  suppressed: number;
  /** Dropped before writing because the kind is muted outright. */
  muted: number;
  /** Written but silenced because a reviewer has already refuted a claim built
   *  on the same rows. Counted apart from `suppressed` because it is the one
   *  number that says whether the ruling memory is doing any work. */
  alreadyRefuted: number;
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
  alreadyRefuted: 0,
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
      createdAt: daydreamThoughts.createdAt,
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
      hourBand: hourBand(
        Number(new Intl.DateTimeFormat('en-GB', {
          timeZone: LOCAL_TZ,
          hour: '2-digit',
          hour12: false,
        }).format(r.createdAt)) % 24,
      ),
    }));
}

/**
 * Every relevance rating that still matters.
 *
 * A sibling of `loadFeedback` rather than a widening of it, because the two
 * answer different questions and the merge belongs where the weights are built:
 * folding relevance into `FeedbackRow` would have forced a fake verdict onto
 * every rating and made `tallyFeedback` — which the detector rows, the
 * threshold and three tests all read — silently mean something else.
 */
export async function loadRelevanceRows(sinceDays = 180): Promise<RelevanceRow[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = await db
    .select({
      kind: daydreamThoughts.kind,
      relevance: daydreamThoughts.relevance,
      relevanceAt: daydreamThoughts.relevanceAt,
      placeId: daydreamThoughts.placeId,
      createdAt: daydreamThoughts.createdAt,
    })
    .from(daydreamThoughts)
    .where(and(isNotNull(daydreamThoughts.relevance), gte(daydreamThoughts.relevanceAt, since)));

  return rows
    .filter((r) => r.relevanceAt != null && r.relevance != null)
    .map((r) => ({
      kind: r.kind,
      relevance: r.relevance as number,
      relevanceAt: r.relevanceAt as Date,
      placeId: r.placeId,
      // Banded off when the THOUGHT landed, exactly as feedback is — the
      // per-context weight asks "is this kind worth hearing here, at this hour",
      // and the hour that matters is the one it arrived in.
      hourBand: hourBand(
        Number(new Intl.DateTimeFormat('en-GB', {
          timeZone: LOCAL_TZ,
          hour: '2-digit',
          hour12: false,
        }).format(r.createdAt)) % 24,
      ),
    }));
}

/**
 * Set the owner's relevance for one thought.
 *
 * Writes NO status, on purpose. That is what keeps this clear of both traps
 * this table has already sprung: it cannot collide with `PROTECTED_STATUSES`
 * (so a rating never freezes a live row out of re-detection), and it cannot be
 * mistaken for the negative verdict `archived` exists specifically to avoid
 * recording. Rate a card and then file it, or rate it and leave it in the
 * feed — both are coherent, and neither is a verdict on the suggestion.
 *
 * `null` clears it, so a mis-tap is undoable without inventing a sixth value.
 */
export async function setRelevance(
  thoughtId: string,
  relevance: number | null,
): Promise<{ kind: string; relevance: number | null }> {
  let value: number | null = null;
  if (relevance != null) {
    if (!Number.isFinite(relevance)) throw new Error('relevance must be a number');
    const rounded = Math.round(relevance);
    if (rounded < RELEVANCE_MIN || rounded > RELEVANCE_MAX) {
      throw new Error(`relevance must be ${RELEVANCE_MIN}..${RELEVANCE_MAX}`);
    }
    value = rounded;
  }

  const now = new Date();
  const [row] = await db
    .update(daydreamThoughts)
    .set({
      relevance: value,
      // Cleared with the value. A timestamp left behind on a null rating would
      // survive into `loadRelevanceRows`' window filter and describe a rating
      // that no longer exists.
      relevanceAt: value == null ? null : now,
      updatedAt: now,
    })
    .where(eq(daydreamThoughts.id, thoughtId))
    .returning({ kind: daydreamThoughts.kind });

  if (!row) throw new Error(`no such thought: ${thoughtId}`);
  return { kind: row.kind, relevance: value };
}

/** Learned multiplier per kind, plus the global threshold, computed once per
 *  tick so every candidate is judged against the same numbers. */
export function buildScoringContext(
  feedback: FeedbackRow[],
  now: Date,
  relevance: RelevanceRow[] = [],
) {
  const byKind = new Map<string, FeedbackRow[]>();
  const byContext = new Map<string, FeedbackRow[]>();
  for (const f of feedback) {
    const list = byKind.get(f.kind) ?? [];
    list.push(f);
    byKind.set(f.kind, list);
    if (f.hourBand) {
      const key = contextKey(f.kind, f.placeId, f.hourBand);
      const local = byContext.get(key) ?? [];
      local.push(f);
      byContext.set(key, local);
    }
  }

  // Same two buckets, filled from the other instrument. Kept in their own maps
  // so a kind that has ONLY relevance ratings still gets a weight — keying off
  // `byKind` alone would have made the dial do nothing at all until the same
  // kind had also been given a verdict, which is most of them.
  const relByKind = new Map<string, RelevanceRow[]>();
  const relByContext = new Map<string, RelevanceRow[]>();
  for (const r of relevance) {
    const list = relByKind.get(r.kind) ?? [];
    list.push(r);
    relByKind.set(r.kind, list);
    if (r.hourBand) {
      const key = contextKey(r.kind, r.placeId, r.hourBand);
      const local = relByContext.get(key) ?? [];
      local.push(r);
      relByContext.set(key, local);
    }
  }

  const countsByKind = new Map<string, ReturnType<typeof tallyFeedback>>();
  for (const kind of new Set([...byKind.keys(), ...relByKind.keys()])) {
    countsByKind.set(
      kind,
      mergeCounts(
        tallyFeedback(byKind.get(kind) ?? [], now),
        tallyRelevance(relByKind.get(kind) ?? [], now),
      ),
    );
  }

  return {
    weightFor: (kind: string, placeId?: string | null, band?: string) => {
      const kindCounts = countsByKind.get(kind);
      if (!kindCounts) return 1;
      if (!band) return kindWeight(kindCounts);
      const key = contextKey(kind, placeId, band);
      const rows = byContext.get(key);
      const relRows = relByContext.get(key);
      if (!rows && !relRows) return kindWeight(kindCounts);
      return contextualWeight(
        kindCounts,
        mergeCounts(tallyFeedback(rows ?? [], now), tallyRelevance(relRows ?? [], now)),
      );
    },
    // The global bar stays a measure of feedback alone. It answers "how
    // cautious should the system be about INTERRUPTING", and a rating given on
    // a card that was never sent is not evidence about that — see the cold-start
    // note in scoring.ts. Relevance moves the per-kind weight instead, which is
    // the lever that actually reorders the feed.
    threshold: adaptiveThreshold(feedback, now),
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
  // Both instruments, read together. This is the only place the relevance dial
  // reaches the future: a kind John keeps marking relevant earns a higher
  // multiplier here, so the NEXT candidate of that kind scores higher and
  // clears the delivery bar more often. Without this line the dial would be a
  // number the page stored and nothing read.
  const [feedback, relevance] = await Promise.all([loadFeedback(), loadRelevanceRows()]);
  const scoring = buildScoringContext(feedback, now, relevance);
  // The rows a reviewer has already ruled against. Loaded once per call and
  // soft: a guard that cannot read its own table must not cost the tick, which
  // is the same contract the ruling cards keep in the ponder pack.
  let refuted: RefutedClaim[] = [];
  try {
    refuted = await loadRefutedClaims();
  } catch (err) {
    console.warn(`[daydream] could not read the refutations: ${errMsg(err)}`);
  }

  const keys = candidates.map((c) => c.dedupeKey);
  const existing = keys.length
    ? await db
        .select({
          id: daydreamThoughts.id,
          dedupeKey: daydreamThoughts.dedupeKey,
          status: daydreamThoughts.status,
          reviewVerdict: daydreamThoughts.reviewVerdict,
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

    const localHour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: LOCAL_TZ,
      hour: '2-digit',
      hour12: false,
    }).format(now)) % 24;
    const weight = scoring.weightFor(candidate.kind, candidate.placeId, hourBand(localHour));
    const { score, components } = finalScore(candidate.rawScore, weight, candidate.components);

    const found = byKey.get(candidate.dedupeKey);
    const belowThreshold = score < scoring.threshold;
    const rejectedByReview =
      found?.reviewVerdict === 'refuted' || found?.reviewVerdict === 'uncertain';
    // The same claim under a new name.
    //
    // Checked before the threshold and after the mute, which is the ordering
    // that matters: a mute is the owner's and outranks everything, while the
    // threshold is a score and this is a verdict somebody reached by going and
    // reading the sources. A candidate whose rows have already been ruled on
    // never reaches `new`, so it never reaches the reviewer for a second xhigh
    // pass and never reaches WhatsApp — however it is worded.
    //
    // A row carrying a verdict of its own has been judged directly and keeps
    // that judgement, `verified` included; the echo test is for the rest.
    const echo = found?.reviewVerdict ? null : echoOf(candidate, refuted);
    const status = rejectedByReview || echo
      ? 'suppressed'
      : found?.reviewVerdict === 'verified'
        ? 'new'
        : belowThreshold
          ? 'suppressed'
          : 'new';
    const suppressedReason = rejectedByReview
      ? found.reviewVerdict === 'refuted'
        ? 'refuted_by_review'
        : 'uncertain_after_review'
      : echo
        ? `already_refuted (${echo.title.slice(0, 80)})`
        : belowThreshold && found?.reviewVerdict !== 'verified'
          ? `below_threshold (${score} < ${scoring.threshold})`
          : null;
    if (status === 'suppressed') result.suppressed++;
    if (echo) result.alreadyRefuted++;

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

/**
 * Thoughts waiting to be said, best first.
 *
 * A verified review supersedes the cold-start score bar. That invariant used to
 * exist only inside `chooseChannel`: below-threshold rows had status
 * `suppressed`, while this query selected only `new`, so the router never got a
 * chance to apply it. Include exactly that reviewed exception here; an
 * unreviewed or uncertain suppressed row remains feed-only.
 */
export async function listUndelivered(limit = 10) {
  return db
    .select()
    .from(daydreamThoughts)
    .where(
      or(
        and(
          eq(daydreamThoughts.status, 'new'),
          or(
            isNull(daydreamThoughts.reviewVerdict),
            eq(daydreamThoughts.reviewVerdict, 'verified'),
          ),
        ),
        and(
          eq(daydreamThoughts.status, 'suppressed'),
          eq(daydreamThoughts.reviewVerdict, 'verified'),
          isNull(daydreamThoughts.deliveredAt),
        ),
      ),
    )
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

/**
 * Filed away, with no opinion attached.
 *
 * The third thing the owner needs to be able to say about a card, and until now
 * the only one he could not. `useful` and `not useful` are both VERDICTS: they
 * move the kind's weight, they count toward the cold-start threshold, and they
 * are quoted back at the engine as evidence about what is worth saying. Most
 * cards deserve neither. "Yes, I have seen that, now go away" is the ordinary
 * response to a true and unremarkable observation, and forcing it through a
 * thumb means either inflating a kind that was merely correct or punishing one
 * that did nothing wrong.
 *
 * So `archived` is its own status and writes NO feedback. It cannot be folded
 * into `dismissed`, which `recordFeedback` already writes for *not useful* —
 * reusing it would silently record a negative verdict the owner explicitly
 * declined to give.
 */
export async function archiveThought(thoughtId: string): Promise<{ kind: string }> {
  const [row] = await db
    .update(daydreamThoughts)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(daydreamThoughts.id, thoughtId))
    .returning({ kind: daydreamThoughts.kind });
  if (!row) throw new Error(`no such thought: ${thoughtId}`);
  return { kind: row.kind };
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
