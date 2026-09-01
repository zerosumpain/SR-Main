// src/lib/daydream/scoring.ts
//
// How a daydream earns the right to be said out loud.
//
// Three separate instruments, deliberately not conflated:
//
//   kindWeight       what the ledger knows about THIS KIND of thought.
//   coldStartThreshold  how cautious the system is overall, right now.
//   tallyRelevance   how much the SUBJECT matters to him, said outright.
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

/** Where a verdict came from. Kept alongside the verdict because the two are
 *  different kinds of evidence and averaging them would lose the distinction. */
export type FeedbackSource = 'explicit' | 'triage' | 'action';

/**
 * How much a verdict counts, by where it came from.
 *
 * `explicit` is the owner reading one thing and ruling on it — the strongest
 * signal there is, and the unit everything else is priced against.
 *
 * `triage` is a verdict given in a sorting session, thirty at a time. Real, and
 * the only realistic way out of a cold start that otherwise needs 25 responses
 * at four interruptions a day. Discounted a little, because attention spread
 * over thirty cards is not attention spent on one.
 *
 * `action` is inferred: he named the place the thought asked about. Good
 * evidence, and deliberately the weakest, because he was acting on the subject
 * rather than ruling on the suggestion — the objection `confirmPlace` has
 * always raised against recording it at all. At 0.4 it can move a threshold
 * over time and cannot, on its own, make a kind look loved.
 */
export const SOURCE_WEIGHTS: Record<FeedbackSource, number> = {
  explicit: 1,
  triage: 0.7,
  action: 0.4,
};

export function sourceWeight(source: FeedbackSource | null | undefined): number {
  // An unlabelled row is an explicit tap from before the column existed.
  if (!source) return SOURCE_WEIGHTS.explicit;
  return SOURCE_WEIGHTS[source] ?? SOURCE_WEIGHTS.explicit;
}

export interface FeedbackRow {
  kind: string;
  feedback: FeedbackVerdict;
  feedbackAt: Date;
  /** Null on rows written before the column existed — treated as explicit. */
  feedbackSource?: FeedbackSource | null;
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
    // Two independent discounts, multiplied: how old the verdict is, and how
    // directly it was given. An inferred action from last week should not
    // outweigh something he actually said this morning.
    const w = decayFactor(r.feedbackAt, now, halfLifeDays) * sourceWeight(r.feedbackSource);
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

/** Effective, provenance- and age-weighted evidence behind the global bar. */
export function effectiveFeedbackCount(rows: FeedbackRow[], now: Date): number {
  const counts = tallyFeedback(rows, now);
  return counts.useful + counts.notUseful;
}

/** A cold-start bar that responds to observed precision, not merely activity. */
export function adaptiveThreshold(rows: FeedbackRow[], now: Date): number {
  const counts = tallyFeedback(rows, now);
  const effectiveN = counts.useful + counts.notUseful;
  const learned = coldStartThreshold(effectiveN);
  const posterior =
    (counts.useful + PRIOR_USEFUL) /
    (effectiveN + PRIOR_USEFUL + PRIOR_NOT_USEFUL);
  // Poor precision adds caution back. Negative/inferred activity can no longer
  // lower the global bar merely by filling rows in the ledger.
  const precisionPenalty = Math.max(0, 0.5 - posterior) * 0.6;
  return Math.round(
    Math.min(0.9, Math.max(THRESHOLD_FLOOR, learned + precisionPenalty)) * 1000,
  ) / 1000;
}

/** Partially pool a sparse place/time preference toward its kind preference. */
export function contextualWeight(kindCounts: WeightCounts, contextCounts: WeightCounts): number {
  const base = kindWeight(kindCounts);
  const localN = contextCounts.useful + contextCounts.notUseful;
  if (localN <= 0) return base;
  const blend = localN / (localN + 5);
  return Math.round((base * (1 - blend) + kindWeight(contextCounts) * blend) * 1000) / 1000;
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

// ── Relevance ────────────────────────────────────────────────────────────────
//
// A third instrument, and deliberately not a fourth verdict.
//
// `feedback` answers "was this interruption worth having". It can only honestly
// be asked of something that actually reached him, its vocabulary is a verdict,
// and `never_kind` inside it is an absolute mute. Relevance answers a different
// question about a different object: how much the SUBJECT matters, whether or
// not this particular suggestion landed. The two come apart constantly — a
// clumsy suggestion about money is a bad suggestion about a subject that
// matters a great deal — and until now the ledger had nowhere to put that.
//
// It is expressed in the SAME currency as feedback (decayed useful/unhelpful
// pseudo-votes) rather than as a parallel multiplier, because two independent
// multipliers over one kind is a number nobody can read off the page. One
// currency means `kindWeight` stays the single explanation of why a kind ranks
// where it does.

/** The dial. 1 is "not my concern", 5 is "this is what I care about". */
export const RELEVANCE_MIN = 1;
export const RELEVANCE_MAX = 5;
/** The midpoint contributes nothing: "I looked, and it is ordinary" is a real
 *  answer and must not be recorded as either approval or a complaint. */
export const RELEVANCE_NEUTRAL = 3;

/**
 * How much a relevance rating counts against an explicit verdict.
 *
 * Below `explicit` on purpose. A rating can be given on a row that never
 * reached him — the feed shows suppressed cards, and rating one there is a
 * judgement about the topic made without ever having been interrupted by it.
 * Real evidence, and it should not outweigh a verdict on something he actually
 * saw. Above `triage` (0.7), because this is one card considered on its own
 * rather than one of thirty in a sorting session.
 */
export const RELEVANCE_SOURCE_WEIGHT = 0.8;

export interface RelevanceRow {
  kind: string;
  /** 1..5. Anything outside the range, or the neutral midpoint, is ignored. */
  relevance: number;
  relevanceAt: Date;
  placeId?: string | null;
  hourBand?: string | null;
}

/**
 * A rating's signed strength, in votes. −1 … +1, zero at the midpoint.
 *
 * Linear rather than stepped, so 5 is exactly twice 4 and the card can print
 * the number without the page having to explain a curve.
 */
export function relevanceVote(relevance: number): number {
  if (!Number.isFinite(relevance)) return 0;
  const clamped = Math.min(RELEVANCE_MAX, Math.max(RELEVANCE_MIN, Math.round(relevance)));
  return (clamped - RELEVANCE_NEUTRAL) / (RELEVANCE_MAX - RELEVANCE_NEUTRAL);
}

/**
 * Decay-weighted useful/unhelpful totals for a set of relevance ratings.
 *
 * Same two discounts `tallyFeedback` applies — age, then provenance — so the
 * counts it returns can be added to that function's without converting
 * anything. `n` counts only ratings that moved the needle: a page full of
 * neutral 3s is a page he has read and had no opinion about, and letting those
 * inflate `n` would drag the cold-start threshold down on no evidence at all.
 */
export function tallyRelevance(
  rows: RelevanceRow[],
  now: Date,
  halfLifeDays = FEEDBACK_HALF_LIFE_DAYS,
): WeightCounts {
  let useful = 0;
  let notUseful = 0;
  let n = 0;
  for (const r of rows) {
    const vote = relevanceVote(r.relevance);
    if (vote === 0) continue;
    const w = decayFactor(r.relevanceAt, now, halfLifeDays) * RELEVANCE_SOURCE_WEIGHT;
    if (vote > 0) useful += vote * w;
    else notUseful += -vote * w;
    n++;
  }
  return { useful, notUseful, n };
}

/** Add two tallies. Trivial, and named so callers do not open the shape. */
export function mergeCounts(a: WeightCounts, b: WeightCounts): WeightCounts {
  return { useful: a.useful + b.useful, notUseful: a.notUseful + b.notUseful, n: a.n + b.n };
}

/**
 * The mean rating for a kind, for the page.
 *
 * Unweighted and undecayed on purpose: this is a description of what he has
 * said, not an input to anything. Weighting it would make the number on the
 * card disagree with the ratings visible beside it.
 */
export function meanRelevance(rows: RelevanceRow[]): { mean: number; n: number } | null {
  const valid = rows.filter(
    (r) => Number.isFinite(r.relevance) && r.relevance >= RELEVANCE_MIN && r.relevance <= RELEVANCE_MAX,
  );
  if (valid.length === 0) return null;
  const sum = valid.reduce((acc, r) => acc + r.relevance, 0);
  return { mean: Math.round((sum / valid.length) * 100) / 100, n: valid.length };
}
