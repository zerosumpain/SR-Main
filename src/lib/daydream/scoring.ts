// src/lib/daydream/scoring.ts
//
// How a daydream earns the right to be said out loud.
//
// Two separate instruments, deliberately not conflated:
//
//   kindWeight       what the ledger knows about THIS KIND of thought.
//   coldStartThreshold  how cautious the system is overall, right now.
//
// Keeping them apart is what makes the first fortnight survivable. A brand-new
// kind has no evidence either way, so its weight is exactly neutral — punishing
// it for being new would mean nothing could ever prove itself. Caution about
// being new belongs in the threshold, which starts high and falls as the ledger
// fills, and is a property of the whole system rather than of any one kind.
//
// PURE — no DB, no clock (callers pass `now`). Every number here is inspectable
// on the ledger page, because the rule is: never show an unexplained number.

/**
 * Pseudo-counts, i.e. the prior. Two imaginary useful votes and two imaginary
 * unhelpful ones, so a kind starts at exactly 0.5 and a single downvote moves
 * it to 0.4 rather than to 0.
 *
 * This is a shrunk posterior mean rather than the Wilson lower bound the design
 * note named. Wilson LB is the right tool for ranking things that all have
 * evidence; here it is wrong at the only moment that matters, because with
 * n = 0 it returns 0 — every new kind would be born muted and could never
 * collect the feedback needed to un-mute itself. Same intent, correct
 * behaviour at the origin.
 */
export const PRIOR_USEFUL = 2;
export const PRIOR_NOT_USEFUL = 2;

/** Feedback older than this counts half as much. An old grudge fades; a
 *  sustained one does not. */
export const FEEDBACK_HALF_LIFE_DAYS = 45;

/** Multiplier bounds. A well-liked kind gets a modest boost, not a free pass;
 *  a disliked one is pushed down hard but never to zero — zero is what
 *  `never_kind` is for, and that is a decision the owner makes explicitly
 *  rather than one a statistic makes on their behalf. */
export const MIN_WEIGHT = 0.2;
export const MAX_WEIGHT = 1.3;

export type FeedbackVerdict = 'useful' | 'not_useful' | 'never_kind';

export interface FeedbackRow {
  kind: string;
  feedback: FeedbackVerdict;
  feedbackAt: Date;
  /** Where it landed, when it landed there — for the per-context weight. */
  placeId?: string | null;
  hourBand?: string | null;
}

/** How much a vote from `at` still counts at `now`. */
export function decayFactor(at: Date, now: Date, halfLifeDays = FEEDBACK_HALF_LIFE_DAYS): number {
  const ageDays = (now.getTime() - at.getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export interface WeightCounts {
  useful: number;
  notUseful: number;
  /** Undecayed row count, for "based on N responses" on the page. */
  n: number;
}

export const EMPTY_COUNTS: WeightCounts = { useful: 0, notUseful: 0, n: 0 };

/** Decay-weighted useful/unhelpful totals for a set of votes. */
export function tallyFeedback(
  rows: FeedbackRow[],
  now: Date,
  halfLifeDays = FEEDBACK_HALF_LIFE_DAYS,
): WeightCounts {
  let useful = 0;
  let notUseful = 0;
  let n = 0;
  for (const r of rows) {
    // `never_kind` is an absolute mute handled elsewhere; counting it here too
    // would punish the kind twice for one tap.
    if (r.feedback !== 'useful' && r.feedback !== 'not_useful') continue;
    const w = decayFactor(r.feedbackAt, now, halfLifeDays);
    if (r.feedback === 'useful') useful += w;
    else notUseful += w;
    n++;
  }
  return { useful, notUseful, n };
}

/**
 * The score multiplier for a kind. 1.0 means "no opinion".
 *
 * Bounded at both ends on purpose. The bottom bound stops a statistic from
 * silently doing what only `never_kind` should do; the top stops one good week
 * from letting a kind bypass the threshold indefinitely.
 */
export function kindWeight(counts: WeightCounts): number {
  const posterior =
    (counts.useful + PRIOR_USEFUL) /
    (counts.useful + counts.notUseful + PRIOR_USEFUL + PRIOR_NOT_USEFUL);
  const raw = posterior * 2; // 0.5 (no evidence) → 1.0
  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, Math.round(raw * 1000) / 1000));
}

/** Bucket an hour into a coarse band, so per-context weights have enough
 *  support to mean anything. Twenty-four buckets would never fill. */
export function hourBand(hour: number): string {
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

/** Identity for a per-context weight: this kind, at this place, at this time of
 *  day. "Useful at the shop, noise at home" is a thing the ledger can learn;
 *  a single per-kind number cannot express it. */
export function contextKey(kind: string, placeId: string | null | undefined, band: string): string {
  return `${kind}|${placeId ?? '_nowhere'}|${band}`;
}

// ── Cold start ───────────────────────────────────────────────────────────────

/** Where the threshold opens with no feedback at all. High: on day one the
 *  system has no idea what is useful, and push is the default channel. */
export const THRESHOLD_START = 0.75;
/** Where it settles once the ledger has real signal. */
export const THRESHOLD_FLOOR = 0.45;
/** Responses at which roughly two-thirds of the descent has happened. */
export const THRESHOLD_DECAY_N = 25;

/**
 * How high a thought must score to be said out loud.
 *
 * Opens conservative and falls as the ledger fills, rather than opening
 * permissive and being beaten down by irritation. That direction is the whole
 * point: the failure mode of a proactive assistant is not "too quiet on day
 * one", it is "muted forever by day three". A quiet start costs a few missed
 * suggestions; a loud one costs the entire feature.
 */
export function coldStartThreshold(
  feedbackCount: number,
  opts: { start?: number; floor?: number; decayN?: number } = {},
): number {
  const start = opts.start ?? THRESHOLD_START;
  const floor = opts.floor ?? THRESHOLD_FLOOR;
  const decayN = opts.decayN ?? THRESHOLD_DECAY_N;
  const n = Math.max(0, feedbackCount);
  const t = floor + (start - floor) * Math.exp(-n / decayN);
  return Math.round(t * 1000) / 1000;
}

/**
 * Final score, and why.
 *
 * Returns the components as well as the number so a card can show its working.
 * The rule this enforces — never show an unexplained number — is why every
 * detector returns named components rather than a bare float.
 */
export function finalScore(
  rawScore: number,
  weight: number,
  components: Record<string, number> = {},
): { score: number; components: Record<string, number> } {
  const clampedRaw = Math.min(1, Math.max(0, rawScore));
  const score = Math.min(1, Math.max(0, clampedRaw * weight));
  return {
    score: Math.round(score * 1000) / 1000,
    components: {
      ...components,
      raw: Math.round(clampedRaw * 1000) / 1000,
      kindWeight: weight,
    },
  };
}
