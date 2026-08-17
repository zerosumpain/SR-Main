import { describe, it, expect } from 'vitest';
import {
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
      resolveServe({ servedFor: ['typecheck:TS2345'], nextFingerprints: [], nextGatePassed: true }),
    ).toBe('helpful');
  });

  it('counts the same failure recurring as unhelpful', () => {
    expect(
      resolveServe({
        servedFor: ['typecheck:TS2345'],
        nextFingerprints: ['typecheck:TS2345', 'vitest:AssertionError'],
        nextGatePassed: false,
      }),
    ).toBe('unhelpful');
  });

  it('counts a DIFFERENT failure as helpful — that is progress', () => {
    expect(
      resolveServe({
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
      resolveServe({ servedFor: ['x'], nextFingerprints: null, nextGatePassed: null }),
    ).toBe('unresolved');
    expect(
      resolveServe({ servedFor: [], nextFingerprints: [], nextGatePassed: false }),
    ).toBe('unresolved');
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
