import { describe, it, expect } from 'vitest';
import {
  VERDICT_WEIGHT,
  verdictWeight,
  relevanceOf,
  wilsonLowerBound,
  recencyWeight,
  packByRelevance,
  resolveServe,
  rankingRegime,
  NEUTRAL_PRIOR,
  RECENCY_FLOOR,
  EVIDENCE_MATURITY,
  serveIsAttributable,
} from './relevance';

const NOW = Date.UTC(2026, 7, 17);
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000);
const ev = (o: Partial<Parameters<typeof relevanceOf>[0]> = {}) => ({
  served: 0,
  helpful: 0,
  unhelpful: 0,
  observedAt: daysAgo(1),
  ...o,
});

describe('the outcome term', () => {
  it('starts neutral, so unproven is not the same as bad', () => {
    // Starting at zero would mean nothing new could ever be served long enough
    // to prove itself.
    expect(wilsonLowerBound(0, 0)).toBe(NEUTRAL_PRIOR);
  });

  it('does not let one lucky serve outrank a long record', () => {
    const lucky = wilsonLowerBound(1, 0); // 100% of one
    const proven = wilsonLowerBound(40, 10); // 80% of fifty
    expect(proven).toBeGreaterThan(lucky);
  });

  it('falls as failures accumulate', () => {
    const a = wilsonLowerBound(5, 1);
    const b = wilsonLowerBound(5, 10);
    const c = wilsonLowerBound(0, 10);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeLessThan(0.35);
  });
});

describe('the recency term', () => {
  it('decays with age but never below the floor', () => {
    expect(recencyWeight(daysAgo(0), NOW)).toBeCloseTo(1, 5);
    expect(recencyWeight(daysAgo(120), NOW)).toBeCloseTo(RECENCY_FLOOR + (1 - RECENCY_FLOOR) * 0.5, 5);
    // Old is not wrong: a two-year-old fact about ci-release.sh still costs a
    // deploy when forgotten.
    expect(recencyWeight(daysAgo(3000), NOW)).toBeGreaterThanOrEqual(RECENCY_FLOOR);
  });

  it('treats unknown age as unknown, not as ancient', () => {
    expect(recencyWeight(null, NOW)).toBeGreaterThan(RECENCY_FLOOR);
    expect(recencyWeight(null, NOW)).toBeLessThan(1);
  });
});

describe('start biased to recency, then expand to outcome', () => {
  it('with no evidence anywhere, the newer item wins', () => {
    const fresh = relevanceOf(ev({ observedAt: daysAgo(1) }), NOW);
    const old = relevanceOf(ev({ observedAt: daysAgo(400) }), NOW);
    expect(fresh.score).toBeGreaterThan(old.score);
    expect(fresh.because).toMatch(/recency/);
  });

  it('once evidence exists, a proven old item beats an unproven new one', () => {
    // This is the whole point: freshness is the default, not the rule.
    const provenOld = relevanceOf(ev({ observedAt: daysAgo(400), served: 30, helpful: 26, unhelpful: 4 }), NOW);
    const unprovenNew = relevanceOf(ev({ observedAt: daysAgo(1) }), NOW);
    expect(provenOld.score).toBeGreaterThan(unprovenNew.score);
    expect(provenOld.because).toMatch(/helped 26 of 30/);
  });

  it('reports which regime the ranking is currently in', () => {
    expect(rankingRegime(0).regime).toBe('recency');
    expect(rankingRegime(EVIDENCE_MATURITY - 1).regime).toBe('recency');
    expect(rankingRegime(EVIDENCE_MATURITY + 1).regime).toBe('mixed');
    expect(rankingRegime(EVIDENCE_MATURITY * 20).regime).toBe('outcome');
    expect(rankingRegime(3).label).toMatch(/too few to judge/);
  });
});

describe('atrophy', () => {
  it('demotes something served repeatedly that never helped', () => {
    const neverHelped = relevanceOf(ev({ served: 12, helpful: 0, unhelpful: 12 }), NOW);
    const untried = relevanceOf(ev({ served: 0 }), NOW);
    expect(neverHelped.score).toBeLessThan(untried.score);
    expect(neverHelped.because).toMatch(/never once preceded an improvement — atrophying/);
  });

  it('is a demotion, not a deletion — it can recover', () => {
    const atrophied = relevanceOf(ev({ served: 10, helpful: 0, unhelpful: 10 }), NOW);
    const recovering = relevanceOf(ev({ served: 20, helpful: 10, unhelpful: 10 }), NOW);
    expect(atrophied.score).toBeGreaterThan(0); // still in consideration
    expect(recovering.score).toBeGreaterThan(atrophied.score);
  });

  it('ranks a stale item far down without removing it', () => {
    const stale = relevanceOf(ev({ stale: true, helpful: 10, unhelpful: 0 }), NOW);
    const live = relevanceOf(ev({ helpful: 10, unhelpful: 0 }), NOW);
    expect(stale.score).toBeLessThan(live.score * 0.5);
    expect(stale.score).toBeGreaterThan(0);
    expect(stale.because).toMatch(/every file it names is gone/);
  });
});

describe('the budget is what enforces atrophy', () => {
  it('spends on the highest relevance and reports what did not fit', () => {
    // Nothing is filtered by score — the budget simply runs out before the
    // low-relevance items, which is why a demoted lesson is one edit from
    // being afforded again.
    const packed = packByRelevance(
      [
        { item: 'weak', score: 0.1, cost: 400 },
        { item: 'strong', score: 0.9, cost: 400 },
        { item: 'middling', score: 0.5, cost: 400 },
      ],
      800,
    );
    expect(packed.chosen).toEqual(['strong', 'middling']);
    expect(packed.spent).toBe(800);
    expect(packed.droppedForBudget).toBe(1);
  });

  it('skips an item too big for the remaining budget but keeps filling', () => {
    const packed = packByRelevance(
      [
        { item: 'huge', score: 0.9, cost: 5000 },
        { item: 'small', score: 0.8, cost: 100 },
      ],
      1000,
    );
    expect(packed.chosen).toEqual(['small']);
  });
});

describe('resolving what a serve was worth', () => {
  it('counts a green gate as helpful', () => {
    expect(
      resolveServe({
        outcome: 'served',
        servedFor: ['typecheck:TS2345'],
        nextFingerprints: [],
        nextGatePassed: true,
      }),
    ).toBe('helpful');
  });

  it('counts the same failure recurring as unhelpful', () => {
    expect(
      resolveServe({
        outcome: 'served',
        servedFor: ['typecheck:TS2345'],
        nextFingerprints: ['typecheck:TS2345', 'vitest:AssertionError'],
        nextGatePassed: false,
      }),
    ).toBe('unhelpful');
  });

  it('counts a DIFFERENT failure as helpful — that is progress', () => {
    expect(
      resolveServe({
        outcome: 'served',
        servedFor: ['typecheck:TS2345'],
        nextFingerprints: ['vitest:AssertionError'],
        nextGatePassed: false,
      }),
    ).toBe('helpful');
  });

  it('leaves it unresolved rather than guessing', () => {
    // A wrong "helpful" is indistinguishable from a real one afterwards and
    // would poison the ranking permanently.
    expect(
      resolveServe({
        outcome: 'served',
        servedFor: ['x'],
        nextFingerprints: null,
        nextGatePassed: null,
      }),
    ).toBe('unresolved');
  });

  /*
   * The defect this file did not cover, found in production 2026-08-30.
   *
   * `resolveServe` opened with `if (nextGatePassed === true) return 'helpful'`,
   * ABOVE its fingerprint check, so a file-set serve was credited whenever the
   * next gate happened to be green. Every one of the 11 serves ever marked
   * helpful had `servedFor: []`, and nine belonged to a build that failed after
   * 11 iterations. The old suite tested `nextGatePassed: false` for the
   * fingerprint-less case and never the `true` branch, which is the only one
   * that could reach the bug.
   */
  it('does NOT credit a fingerprint-less serve on a green gate', () => {
    expect(
      resolveServe({
        outcome: 'served',
        servedFor: [],
        nextFingerprints: [],
        nextGatePassed: true,
      }),
    ).toBe('unattributable');
  });

  it('closes a fingerprint-less serve rather than re-examining it forever', () => {
    expect(
      resolveServe({
        outcome: 'served',
        servedFor: [],
        nextFingerprints: [],
        nextGatePassed: false,
      }),
    ).toBe('unattributable');
  });

  it('leaves a serve that carried no text open', () => {
    // `empty` was never a candidate, so there is nothing to close. This matches
    // `resolveCompletedBuildServes`, which also only closes `served` rows.
    expect(
      resolveServe({
        outcome: 'empty',
        servedFor: [],
        nextFingerprints: [],
        nextGatePassed: true,
      }),
    ).toBe('unresolved');
  });

  it('agrees with serveIsAttributable on every shape', () => {
    // The two resolvers disagreeing is the actual bug class here, so pin the
    // one predicate to the one function that consumes it.
    for (const outcome of ['served', 'empty', 'failed']) {
      for (const servedFor of [[], ['typecheck:TS2345']]) {
        const attributable = serveIsAttributable({ outcome, servedFor });
        const verdict = resolveServe({
          outcome,
          servedFor,
          nextFingerprints: [],
          nextGatePassed: true,
        });
        expect(verdict === 'helpful').toBe(attributable);
      }
    }
  });
});

describe('what can be evidence at all', () => {
  it('accepts a serve made in answer to a specific gate error', () => {
    expect(serveIsAttributable({ outcome: 'served', servedFor: ['typecheck:TS2345'] })).toBe(true);
  });

  it('rejects a file-set serve, however the build ends', () => {
    /*
     * Made before any gate had run, so there was no error for the outcome to
     * be attributed to. Crediting it on a first-pass win is what made
     * `helpful` mean "was served to a build that happened to succeed" — two
     * builds, eight units credited, one of them a lesson about a chat hub
     * redesign served to a task about PR bodies.
     */
    expect(serveIsAttributable({ outcome: 'served', servedFor: [] })).toBe(false);
  });

  it('rejects a serve that carried no text', () => {
    expect(serveIsAttributable({ outcome: 'empty', servedFor: [] })).toBe(false);
    expect(serveIsAttributable({ outcome: 'failed', servedFor: ['x'] })).toBe(false);
  });
});

/*
 * The verdict multiplier.
 *
 * The schema has claimed since the graph shipped that "ranking multiplies by
 * this: merged is not correct". Nothing did — and the omission was invisible
 * because all 108 production episodes were `verified`, so the missing term
 * would have multiplied everything by the same number.
 *
 * It stops being invisible the moment the scanner records unproven fix
 * attempts, which it now does.
 */
describe('verdict weighting', () => {
  it('scores a lesson (no verdict) unchanged', () => {
    const e = { served: 0, helpful: 0, unhelpful: 0, observedAt: null };
    expect(relevanceOf(e).score).toBe(relevanceOf({ ...e, verdict: null }).score);
    expect(verdictWeight(undefined)).toBe(1);
    expect(verdictWeight(null)).toBe(1);
  });

  it('ranks an unverified episode strictly below an identical verified one', () => {
    // The regression this guards: recording unproven attempts is only safe
    // because they rank lower. Without the multiplier they rank level.
    const base = { served: 0, helpful: 0, unhelpful: 0, observedAt: null };
    const verified = relevanceOf({ ...base, verdict: 'verified' }).score;
    const unverified = relevanceOf({ ...base, verdict: 'unverified' }).score;
    expect(unverified).toBeLessThan(verified);
    expect(unverified).toBeCloseTo(verified * 0.5, 10);
  });

  it('orders the whole vocabulary the way the design argues for', () => {
    const w = (v: string) => verdictWeight(v);
    expect(w('verified')).toBeGreaterThan(w('landed'));
    expect(w('landed')).toBeGreaterThan(w('unverified'));
    expect(w('unverified')).toBeGreaterThan(w('repaired'));
    expect(w('repaired')).toBeGreaterThan(w('abandoned'));
  });

  it('puts landed well below verified — 17.1% of merged PRs were repairs', () => {
    expect(VERDICT_WEIGHT.landed).toBeLessThan(VERDICT_WEIGHT.verified);
    expect(VERDICT_WEIGHT.landed).toBeGreaterThan(VERDICT_WEIGHT.unverified);
  });

  it('never multiplies to zero', () => {
    // Same reason as OUTCOME_FLOOR: a unit at zero can never be ordered above
    // anything, so it can never be served, so it can never recover.
    for (const v of Object.keys(VERDICT_WEIGHT)) expect(verdictWeight(v)).toBeGreaterThan(0);
  });

  it('treats an unrecognised verdict as neutral rather than penalising it', () => {
    expect(verdictWeight('something-new')).toBe(1);
  });

  it('does NOT decay with evidence — the record and its performance are separate', () => {
    // An unverified episode that has since helped four times is still an
    // unverified episode.
    const proven = { served: 10, helpful: 8, unhelpful: 2, observedAt: null };
    const a = relevanceOf({ ...proven, verdict: 'verified' }).score;
    const b = relevanceOf({ ...proven, verdict: 'unverified' }).score;
    expect(b).toBeCloseTo(a * 0.5, 10);
  });
});
