/**
 * How intelligence earns, and loses, its place in a build's context.
 *
 * THE PROBLEM
 *
 * A build's context is a fixed budget — a few thousand characters. The graph
 * holds 273 lessons and 83 episodes and will hold far more. Something has to
 * decide what goes in, and "most recently written" is not it: the note written
 * last night is not more useful than the one that has saved four builds.
 *
 * THE SHAPE
 *
 *   relevance = prior × recency × outcome × liveness
 *
 * Every term is 0..1 and every term is computed, never stored as a magic score
 * somebody nudged. The interesting property is how the balance SHIFTS:
 *
 *   - With no evidence, `outcome` sits at its neutral prior and `recency`
 *     dominates. A fresh graph ranks by what is newest, which is the right
 *     default when nothing has been observed yet.
 *   - As serves accumulate outcomes, `outcome` moves away from neutral and
 *     starts to dominate: it has a much wider dynamic range than recency's
 *     floor. Evidence beats freshness once evidence exists.
 *
 * That is the whole "start biased to recency, then expand" behaviour — it is
 * not a mode switch, it is the natural consequence of a confidence interval
 * widening the more you learn.
 *
 * ATROPHY
 *
 * A lesson served ten times that never once preceded an improvement is worse
 * than useless: it spent budget that something else could have used. Its
 * `unhelpful` count grows, the lower bound of its success interval falls, and
 * it drops below the budget cut. Nobody retires it; it simply stops being
 * afforded. That is deliberate — an automatic *delete* would destroy evidence,
 * while an automatic *demotion* is reversible the moment it starts working
 * again.
 *
 * PURE — no db, no clock unless passed. `relevance.test.ts` pins the curve.
 */

/** Evidence accumulated about one unit of intelligence. */
export interface Evidence {
  /** Times injected into a build's context. */
  served: number;
  /** Times served, and the build measurably improved on the next iteration. */
  helpful: number;
  /** Times served, and the same failure recurred anyway. */
  unhelpful: number;
  /** When the underlying fact was observed (not when the row was written). */
  observedAt: Date | null;
  /** True when everything it cites is gone from its own repo. */
  stale?: boolean;
  /**
   * An episode's verdict. Lessons have none and pass `undefined`, scoring 1.
   *
   * Unset until 2026-08-30, and the schema comment on the column has claimed
   * since the graph shipped that "ranking multiplies by this: merged is not
   * correct". Nothing did. Every one of the 108 production episodes was
   * `verified`, so the omission was invisible — the term would have multiplied
   * everything by the same number.
   *
   * It stops being invisible the moment the scanner records unproven fix
   * attempts, which it now does: without this, "someone edited these files
   * after this error" would rank exactly level with "someone edited these files
   * and we watched the gate go green".
   */
  verdict?: string | null;
}

export interface RelevanceParts {
  recency: number;
  outcome: number;
  liveness: number;
  /** The product — what ranking actually uses. */
  score: number;
  /** How much evidence backs `outcome`, for showing confidence in the UI. */
  observations: number;
  /** Plain-English reason, so a ranking can be argued with. */
  because: string;
}

/**
 * Wilson score lower bound at ~95%.
 *
 * A plain success rate cannot be used here: one lucky serve out of one is 100%
 * and would outrank a lesson that helped forty times out of fifty. The lower
 * bound of the interval encodes "how good, given how much we actually know",
 * which is exactly the quantity that should decide budget.
 *
 * With zero observations it returns the neutral prior rather than 0 — an
 * unproven lesson is unproven, not bad, and starting everything at zero would
 * mean nothing new could ever be served long enough to prove itself.
 */
export const NEUTRAL_PRIOR = 0.5;

/**
 * The outcome term never reaches zero.
 *
 * With no successes at all the Wilson bound is exactly 0, which multiplies the
 * whole score to 0 — and an item at 0 can never be ordered above anything, so
 * it can never be served, so it can never acquire the evidence that would let
 * it recover. That is a permanent deletion wearing a demotion's clothes, and it
 * is the opposite of what this file claims to do.
 *
 * The floor keeps a failed unit last-but-present: still ranked (by recency,
 * among its equally-failed peers), still one good outcome away from climbing.
 */
export const OUTCOME_FLOOR = 0.02;

export function wilsonLowerBound(helpful: number, unhelpful: number, z = 1.96): number {
  const n = helpful + unhelpful;
  if (n <= 0) return NEUTRAL_PRIOR;
  const p = helpful / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  const bound = (centre - margin) / denom;
  return Math.max(OUTCOME_FLOOR, Math.min(1, bound));
}

/**
 * Age decay, with a FLOOR.
 *
 * Old is not wrong. "`ci-release.sh` is an allow-list" was true in June and is
 * true now; decaying it to zero would lose a fact that still costs a deploy
 * when forgotten. The floor says: age lowers priority, it never removes
 * something from consideration. Only staleness and retirement do that.
 */
export const RECENCY_FLOOR = 0.35;
const HALF_LIFE_DAYS = 120;

export function recencyWeight(observedAt: Date | null, now = Date.now()): number {
  if (!observedAt) return 0.6; // unknown age is not the same as old
  const days = Math.max(0, (now - observedAt.getTime()) / 86_400_000);
  const decayed = Math.pow(0.5, days / HALF_LIFE_DAYS);
  return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * decayed;
}

/** A unit whose every cited path has left the tree can still be true, but
 *  nothing can act on it, so it ranks far down rather than out. */
export const STALE_WEIGHT = 0.35;

/**
 * Observations at which outcome and recency carry equal weight.
 *
 * Below it, ranking is mostly "what is newest"; above it, mostly "what has
 * worked". Ten is deliberately low: the corpus is small, builds are expensive,
 * and waiting for hundreds of samples before trusting any of them would mean
 * the system never learns within a useful timeframe.
 */
export const EVIDENCE_HALF_WEIGHT = 10;

/**
 * How much an episode's verdict is worth, as a multiplier.
 *
 * `verified` is the only one we actually watched work: a gate went red, files
 * changed, and the SAME gate went green inside the same transcript.
 *
 * `landed` is deliberately well below it. A merged PR is the weakest strong
 * signal there is — **17.1% of merged PRs in this repo were themselves
 * repairs** — so "it shipped" buys roughly three quarters of "we saw it pass".
 *
 * `unverified` is the honest middle: a real failure, real edits after it, and
 * no green run observed. It is worth serving ("this error happened here before,
 * and here is what was touched next") and it must not outrank proof.
 *
 * `repaired` and `abandoned` sit below the neutral prior on purpose — a fix
 * that later needed fixing, or one that was walked away from, is evidence
 * pointing the other way. Neither reaches zero, for the same reason
 * `OUTCOME_FLOOR` does not: a unit at zero can never be ordered above anything,
 * so it can never be served, so it can never recover.
 */
export const VERDICT_WEIGHT: Record<string, number> = {
  verified: 1,
  landed: 0.75,
  unverified: 0.5,
  repaired: 0.4,
  abandoned: 0.2,
};

/** The multiplier for a verdict; 1 for lessons and for anything unrecognised. */
export function verdictWeight(verdict: string | null | undefined): number {
  if (!verdict) return 1;
  return VERDICT_WEIGHT[verdict] ?? 1;
}

export function relevanceOf(e: Evidence, now = Date.now()): RelevanceParts {
  const recency = recencyWeight(e.observedAt, now);
  const outcome = wilsonLowerBound(e.helpful, e.unhelpful);
  const liveness = e.stale ? STALE_WEIGHT : 1;
  const observations = e.helpful + e.unhelpful;

  /*
   * The shift from recency to outcome is a change in WEIGHTS, not just values.
   *
   * The first version multiplied the terms together, and that quietly defeated
   * the whole design: recency's floor is 0.35, so a 400-day-old lesson that had
   * helped 26 builds out of 30 scored 0.29 while a brand-new unproven one
   * scored 0.50. Recency could veto evidence, which is precisely backwards —
   * the point of measuring outcomes is that they should win once they exist.
   *
   *   confidence  = n / (n + K)              0 with no evidence, → 1 with lots
   *   belief      = blend(neutral prior, measured outcome, confidence)
   *   recency     = applied with strength (1 - confidence)
   *
   * So with nothing observed, `belief` is a constant and recency does all the
   * sorting. With plenty observed, recency's influence collapses toward 1 and
   * `belief` does all the sorting. Nothing switches mode; the weights move.
   */
  const confidence = observations / (observations + EVIDENCE_HALF_WEIGHT);
  const belief = (1 - confidence) * NEUTRAL_PRIOR + confidence * outcome;
  const recencyInfluence = 1 - confidence;
  const effectiveRecency = 1 - recencyInfluence * (1 - recency);
  // Verdict is a property of the RECORD, not of how it has performed, so it
  // multiplies the finished score rather than feeding `belief`. It must not
  // decay with evidence: an unverified episode that has since proved helpful
  // four times is still an unverified episode, and the two facts are separate.
  const score = belief * effectiveRecency * liveness * verdictWeight(e.verdict);

  let because: string;
  if (observations === 0) {
    because =
      e.served > 0
        ? `served ${e.served}× but no outcome resolved yet — ranked on recency`
        : 'never served — ranked on recency alone';
  } else if (outcome > NEUTRAL_PRIOR) {
    because = `helped ${e.helpful} of ${observations} builds it was served to`;
  } else if (e.helpful === 0) {
    because = `served ${observations}× and never once preceded an improvement — atrophying`;
  } else if (e.unhelpful === 0) {
    // A perfect record is not "mixed" — it is simply too small to trust yet,
    // which is a completely different thing to say and the honest one. Calling
    // 2-from-2 "mixed" would misreport the data to justify the ranking.
    because = `helped all ${observations} so far — too few to rank on yet`;
  } else {
    because = `mixed: helped ${e.helpful} of ${observations}`;
  }
  if (e.stale) because += '; every file it names is gone';

  return { recency, outcome, liveness, score, observations, because };
}

/**
 * Whether the balance of a ranking is currently being set by recency or by
 * measured outcomes. Shown in the UI so "why is this at the top" is answerable.
 *
 * The threshold is about the CORPUS, not one item: until a reasonable number of
 * serves have been resolved, the outcome term is near-neutral for almost
 * everything and recency is doing the sorting whether or not that was intended.
 */
export const EVIDENCE_MATURITY = 25;

export function rankingRegime(totalObservations: number): {
  regime: 'recency' | 'mixed' | 'outcome';
  label: string;
} {
  if (totalObservations < EVIDENCE_MATURITY) {
    return {
      regime: 'recency',
      label: `Ranking by recency — only ${totalObservations} resolved serves so far, too few to judge by outcome.`,
    };
  }
  if (totalObservations < EVIDENCE_MATURITY * 8) {
    return {
      regime: 'mixed',
      label: `Ranking on early outcome evidence (${totalObservations} resolved serves), still weighted by recency.`,
    };
  }
  return {
    regime: 'outcome',
    label: `Ranking by measured outcome across ${totalObservations} resolved serves.`,
  };
}

/**
 * Pack the highest-relevance units into a character budget.
 *
 * This is where atrophy actually bites: nothing is filtered out by score, the
 * budget simply runs out, and low-relevance units are the ones it runs out
 * before reaching. A demoted lesson is one edit away from being afforded again.
 */
export function packByRelevance<T>(
  items: Array<{ item: T; score: number; cost: number }>,
  budgetChars: number,
): { chosen: T[]; spent: number; droppedForBudget: number } {
  const ranked = items.slice().sort((a, b) => b.score - a.score);
  const chosen: T[] = [];
  let spent = 0;
  let dropped = 0;
  for (const r of ranked) {
    if (spent + r.cost <= budgetChars) {
      chosen.push(r.item);
      spent += r.cost;
    } else {
      dropped++;
    }
  }
  return { chosen, spent, droppedForBudget: dropped };
}

/**
 * Resolve what a serve was worth, from what the build did next.
 *
 * Mechanical on purpose — no model judges this. The signal is the gate:
 *
 *  - the fingerprint that triggered the retrieval did not recur, and the gate
 *    improved → helpful
 *  - the same fingerprint came back → unhelpful; whatever was served did not
 *    address it
 *  - anything else (build abandoned, provider error, no next iteration) →
 *    unresolved, and it stays unresolved rather than being guessed at
 *
 * Guessing here would be worse than not measuring: a wrong "helpful" is
 * indistinguishable from a real one afterwards, and it would poison the
 * ranking permanently.
 */
export type ServeOutcome = 'helpful' | 'unhelpful' | 'unresolved' | 'unattributable';

/**
 * Whether a serve is capable of being evidence at all, before asking what it
 * showed.
 *
 * Two ways a serve can be unattributable no matter how the build ends:
 *
 *  - it carried no text (`empty` — "no precedent found"), so nothing it did not
 *    say can have helped; or
 *  - it was keyed on the FILE SET rather than on a gate error, which means it
 *    was made before anything had failed. There is no "did the error recur"
 *    question to ask, and a build that then passes first time would very likely
 *    have passed with no context at all.
 *
 * This exists because the first version of the completed-build resolver skipped
 * the second case and credited every open serve on a green finish, which made
 * `helpful` mean "was served to a build that happened to succeed". Measured on
 * real data: two builds, eight units credited, zero of them demonstrably useful
 * — one of the served lessons was about a chat hub redesign.
 */
export function serveIsAttributable(serve: { outcome: string; servedFor: string[] }): boolean {
  return serve.outcome === 'served' && serve.servedFor.length > 0;
}

export function resolveServe(input: {
  /** The serve's own outcome — `served`, `empty` or `failed`. */
  outcome: string;
  /** Fingerprints that caused the retrieval. */
  servedFor: string[];
  /** Fingerprints present in the NEXT iteration's gate output. */
  nextFingerprints: string[] | null;
  /** Did the next iteration's gate pass outright? */
  nextGatePassed: boolean | null;
}): ServeOutcome {
  const { outcome, servedFor, nextFingerprints, nextGatePassed } = input;
  // ATTRIBUTABILITY COMES FIRST, and the order is the whole point.
  //
  // This used to open with `if (nextGatePassed === true) return 'helpful'`,
  // above the fingerprint check below it. So a FILE-SET serve — made before any
  // gate had run, with nothing it could be answering — was credited whenever
  // the next gate happened to be green. `resolveCompletedBuildServes` had
  // already been fixed for exactly this and applied `serveIsAttributable`;
  // this resolver had not, so the same defect survived in the other half.
  //
  // Measured in production 2026-08-30: all 11 serves ever marked `helpful`
  // carried `served_for = []`, and NINE of them belonged to build 42244cc0,
  // which failed after 11 iterations. 44 of 48 lesson credits and 33 of 36
  // episode credits in the whole corpus came from those rows.
  //
  // Both resolvers now go through the one predicate, so they cannot drift again.
  if (!serveIsAttributable({ outcome, servedFor })) {
    // A serve that carried text but no fingerprint can never become evidence,
    // so close it now. An `empty` or `failed` one is left open, matching
    // `resolveCompletedBuildServes` — it was never a candidate to begin with.
    return outcome === 'served' ? 'unattributable' : 'unresolved';
  }
  if (nextFingerprints === null || nextGatePassed === null) return 'unresolved';
  // Safe here and only here: the serve answered a specific gate error, so a
  // green gate means that error is gone.
  if (nextGatePassed === true) return 'helpful';
  const recurred = servedFor.some((f) => nextFingerprints.includes(f));
  if (recurred) return 'unhelpful';
  // The original failure is gone even though the gate is still red: something
  // else is failing now. That is progress, and it is what was asked for.
  return 'helpful';
}
