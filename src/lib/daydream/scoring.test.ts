import { describe, it, expect } from 'vitest';
import {
  coldStartThreshold,
  adaptiveThreshold,
  contextualWeight,
  contextKey,
  decayFactor,
  finalScore,
  hourBand,
  kindWeight,
  tallyFeedback,
  EMPTY_COUNTS,
  FEEDBACK_HALF_LIFE_DAYS,
  MAX_WEIGHT,
  MIN_WEIGHT,
  THRESHOLD_FLOOR,
  THRESHOLD_START,
  type FeedbackRow,
} from './scoring';

const NOW = new Date('2026-08-26T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const vote = (
  feedback: FeedbackRow['feedback'],
  ageDays = 0,
  kind = 'test_kind',
): FeedbackRow => ({ kind, feedback, feedbackAt: daysAgo(ageDays) });

describe('decayFactor', () => {
  it('counts a fresh vote in full', () => {
    expect(decayFactor(NOW, NOW)).toBe(1);
  });

  it('halves a vote at the half-life', () => {
    expect(decayFactor(daysAgo(FEEDBACK_HALF_LIFE_DAYS), NOW)).toBeCloseTo(0.5, 6);
  });

  it('does not amplify a vote from the future', () => {
    expect(decayFactor(new Date(NOW.getTime() + 86_400_000), NOW)).toBe(1);
  });
});

describe('kindWeight', () => {
  it('is exactly neutral with no evidence', () => {
    // The property the whole cold-start design rests on: a new kind is not
    // born muted, or it could never collect the feedback to un-mute itself.
    expect(kindWeight(EMPTY_COUNTS)).toBe(1);
  });

  it('does not let a single downvote kill a kind', () => {
    const w = kindWeight(tallyFeedback([vote('not_useful')], NOW));
    expect(w).toBeLessThan(1);
    expect(w).toBeGreaterThan(0.7);
  });

  it('pushes a consistently unhelpful kind down hard', () => {
    const rows = Array.from({ length: 12 }, () => vote('not_useful'));
    expect(kindWeight(tallyFeedback(rows, NOW))).toBeLessThan(0.45);
  });

  it('never reaches zero — silence is `never_kind`, not a statistic', () => {
    const rows = Array.from({ length: 500 }, () => vote('not_useful'));
    expect(kindWeight(tallyFeedback(rows, NOW))).toBeGreaterThanOrEqual(MIN_WEIGHT);
  });

  it('rewards a useful kind, but caps the boost', () => {
    const rows = Array.from({ length: 500 }, () => vote('useful'));
    const w = kindWeight(tallyFeedback(rows, NOW));
    expect(w).toBeGreaterThan(1);
    expect(w).toBeLessThanOrEqual(MAX_WEIGHT);
  });

  it('lets an old grudge fade', () => {
    const old = Array.from({ length: 8 }, () => vote('not_useful', 180));
    const fresh = Array.from({ length: 8 }, () => vote('not_useful', 0));
    expect(kindWeight(tallyFeedback(old, NOW))).toBeGreaterThan(
      kindWeight(tallyFeedback(fresh, NOW)),
    );
  });
});

describe('tallyFeedback', () => {
  it('ignores never_kind, which is a mute rather than a vote', () => {
    // Counting it here would punish the kind twice for one tap.
    const counts = tallyFeedback([vote('never_kind'), vote('useful')], NOW);
    expect(counts.useful).toBe(1);
    expect(counts.notUseful).toBe(0);
    expect(counts.n).toBe(1);
  });

  it('reports an undecayed n for "based on N responses"', () => {
    const counts = tallyFeedback([vote('useful', 200), vote('not_useful', 200)], NOW);
    expect(counts.n).toBe(2);
    expect(counts.useful).toBeLessThan(0.2);
  });
});

describe('coldStartThreshold', () => {
  it('opens conservative with no feedback', () => {
    expect(coldStartThreshold(0)).toBe(THRESHOLD_START);
  });

  it('falls as the ledger fills, never below the floor', () => {
    expect(coldStartThreshold(25)).toBeLessThan(coldStartThreshold(0));
    expect(coldStartThreshold(1000)).toBeGreaterThanOrEqual(THRESHOLD_FLOOR);
    expect(coldStartThreshold(1000)).toBeCloseTo(THRESHOLD_FLOOR, 2);
  });

  it('descends monotonically', () => {
    let prev = Infinity;
    for (let n = 0; n <= 100; n += 5) {
      const t = coldStartThreshold(n);
      expect(t).toBeLessThanOrEqual(prev);
      prev = t;
    }
  });

  it('treats a negative count as zero rather than inverting', () => {
    expect(coldStartThreshold(-10)).toBe(THRESHOLD_START);
  });
});

describe('adaptiveThreshold', () => {
  it('does not reward a ledger full of negative responses with a lower bar', () => {
    const negatives = Array.from({ length: 25 }, () => vote('not_useful'));
    expect(adaptiveThreshold(negatives, NOW)).toBeGreaterThan(coldStartThreshold(25));
    expect(adaptiveThreshold(negatives, NOW)).toBeGreaterThan(adaptiveThreshold([], NOW));
  });

  it('ignores never-kind mutes when estimating learning support', () => {
    expect(adaptiveThreshold(Array.from({ length: 30 }, () => vote('never_kind')), NOW)).toBe(THRESHOLD_START);
  });
});

describe('contextualWeight', () => {
  it('partially pools local evidence instead of letting one context take over', () => {
    const kind = { useful: 8, notUseful: 0, n: 8 };
    const local = { useful: 0, notUseful: 2, n: 2 };
    const weight = contextualWeight(kind, local);
    expect(weight).toBeLessThan(kindWeight(kind));
    expect(weight).toBeGreaterThan(kindWeight(local));
  });
});

describe('hourBand and contextKey', () => {
  it('buckets hours coarsely enough to gather support', () => {
    expect(hourBand(3)).toBe('night');
    expect(hourBand(9)).toBe('morning');
    expect(hourBand(14)).toBe('afternoon');
    expect(hourBand(20)).toBe('evening');
    expect(hourBand(23)).toBe('night');
  });

  it('distinguishes the same kind in different places', () => {
    expect(contextKey('near_offer', 'p1', 'afternoon')).not.toBe(
      contextKey('near_offer', 'p2', 'afternoon'),
    );
  });

  it('gives placeless thoughts a stable key rather than "undefined"', () => {
    expect(contextKey('free_window', null, 'morning')).toBe('free_window|_nowhere|morning');
    expect(contextKey('free_window', undefined, 'morning')).toBe('free_window|_nowhere|morning');
  });
});

describe('finalScore', () => {
  it('multiplies raw by the learned weight and shows its working', () => {
    const { score, components } = finalScore(0.8, 0.5, { visits: 4 });
    expect(score).toBe(0.4);
    expect(components).toEqual({ visits: 4, raw: 0.8, kindWeight: 0.5 });
  });

  it('clamps a detector that returns nonsense rather than propagating it', () => {
    expect(finalScore(5, 1).score).toBe(1);
    expect(finalScore(-2, 1).score).toBe(0);
  });

  it('cannot exceed 1 even with a boosted weight', () => {
    expect(finalScore(1, MAX_WEIGHT).score).toBe(1);
  });
});

describe('feedback source weighting', () => {
  const now = new Date('2026-08-26T12:00:00Z');
  const at = new Date('2026-08-26T11:00:00Z');

  // The whole point of keeping provenance. `confirmPlace` used to record
  // nothing, on the correct grounds that manufacturing an upvote would inflate
  // a kind's score with something the owner never said. Recording it at a
  // discount keeps the signal without the pretence.
  it('counts an inferred action for less than a stated verdict', () => {
    const explicit = tallyFeedback(
      [{ kind: 'k', feedback: 'useful', feedbackAt: at, feedbackSource: 'explicit' }],
      now,
    );
    const action = tallyFeedback(
      [{ kind: 'k', feedback: 'useful', feedbackAt: at, feedbackSource: 'action' }],
      now,
    );
    expect(action.useful).toBeLessThan(explicit.useful);
    expect(action.useful).toBeGreaterThan(0);
  });

  it('puts a triage verdict between the two', () => {
    const w = (source: 'explicit' | 'triage' | 'action') =>
      tallyFeedback([{ kind: 'k', feedback: 'useful', feedbackAt: at, feedbackSource: source }], now)
        .useful;
    expect(w('action')).toBeLessThan(w('triage'));
    expect(w('triage')).toBeLessThan(w('explicit'));
  });

  // Rows written before the column existed must not silently lose weight.
  it('treats an unlabelled row as explicit', () => {
    const labelled = tallyFeedback(
      [{ kind: 'k', feedback: 'useful', feedbackAt: at, feedbackSource: 'explicit' }],
      now,
    );
    const unlabelled = tallyFeedback([{ kind: 'k', feedback: 'useful', feedbackAt: at }], now);
    expect(unlabelled.useful).toBeCloseTo(labelled.useful, 10);
  });

  // An inferred nudge should never be able to carry a kind on its own.
  it('needs more than two actions to match one stated verdict', () => {
    const oneExplicit = tallyFeedback(
      [{ kind: 'k', feedback: 'useful', feedbackAt: at, feedbackSource: 'explicit' }],
      now,
    ).useful;
    const twoActions = tallyFeedback(
      [
        { kind: 'k', feedback: 'useful', feedbackAt: at, feedbackSource: 'action' },
        { kind: 'k', feedback: 'useful', feedbackAt: at, feedbackSource: 'action' },
      ],
      now,
    ).useful;
    expect(twoActions).toBeLessThan(oneExplicit);
  });

  // `n` is the response COUNT the threshold decays on, and it is deliberately
  // undiscounted: a verdict given is a verdict given, however it arrived.
  it('counts every verdict once toward the response count', () => {
    const t = tallyFeedback(
      [
        { kind: 'k', feedback: 'useful', feedbackAt: at, feedbackSource: 'action' },
        { kind: 'k', feedback: 'not_useful', feedbackAt: at, feedbackSource: 'triage' },
      ],
      now,
    );
    expect(t.n).toBe(2);
  });
});

// ── Relevance ────────────────────────────────────────────────────────────────
//
// The guard on the ask "the model should learn to show more relevant items in
// the feed". A dial that records a number and changes no weight is a dial that
// does nothing, and nothing on the page would say so.

describe('relevanceVote', () => {
  it('is zero at the midpoint — "ordinary" is not a complaint', async () => {
    const { relevanceVote } = await import('./scoring');
    expect(relevanceVote(3)).toBe(0);
  });

  it('runs −1 to +1, linearly', async () => {
    const { relevanceVote } = await import('./scoring');
    expect(relevanceVote(1)).toBe(-1);
    expect(relevanceVote(2)).toBe(-0.5);
    expect(relevanceVote(4)).toBe(0.5);
    expect(relevanceVote(5)).toBe(1);
  });

  it('clamps rather than throwing, and survives rubbish', async () => {
    const { relevanceVote } = await import('./scoring');
    expect(relevanceVote(9)).toBe(1);
    expect(relevanceVote(-4)).toBe(-1);
    expect(relevanceVote(Number.NaN)).toBe(0);
  });
});

describe('tallyRelevance', () => {
  const rate = (relevance: number, ageDays = 0, kind = 'test_kind') => ({
    kind,
    relevance,
    relevanceAt: daysAgo(ageDays),
  });

  it('counts a 5 as a full vote at the relevance discount', async () => {
    const { tallyRelevance, RELEVANCE_SOURCE_WEIGHT } = await import('./scoring');
    const counts = tallyRelevance([rate(5)], NOW);
    expect(counts.useful).toBeCloseTo(RELEVANCE_SOURCE_WEIGHT, 6);
    expect(counts.notUseful).toBe(0);
    expect(counts.n).toBe(1);
  });

  it('a 1 pushes the other way, a 4 counts half', async () => {
    const { tallyRelevance, RELEVANCE_SOURCE_WEIGHT } = await import('./scoring');
    expect(tallyRelevance([rate(1)], NOW).notUseful).toBeCloseTo(RELEVANCE_SOURCE_WEIGHT, 6);
    expect(tallyRelevance([rate(4)], NOW).useful).toBeCloseTo(RELEVANCE_SOURCE_WEIGHT / 2, 6);
  });

  it('neutral ratings contribute nothing AND do not inflate n', async () => {
    const { tallyRelevance } = await import('./scoring');
    // A page of 3s is a page he read and had no opinion about. Counting those
    // as evidence would drag the cold-start threshold down on nothing.
    expect(tallyRelevance([rate(3), rate(3), rate(3)], NOW)).toEqual({
      useful: 0,
      notUseful: 0,
      n: 0,
    });
  });

  it('decays with the same half-life as feedback', async () => {
    const { tallyRelevance, RELEVANCE_SOURCE_WEIGHT } = await import('./scoring');
    const old = tallyRelevance([rate(5, FEEDBACK_HALF_LIFE_DAYS)], NOW);
    expect(old.useful).toBeCloseTo(RELEVANCE_SOURCE_WEIGHT / 2, 6);
  });

  it('is worth less than an explicit verdict and more than a triage one', async () => {
    const { RELEVANCE_SOURCE_WEIGHT } = await import('./scoring');
    expect(RELEVANCE_SOURCE_WEIGHT).toBeLessThan(1);
    expect(RELEVANCE_SOURCE_WEIGHT).toBeGreaterThan(0.7);
  });
});

describe('relevance reaches the weight', () => {
  it('a run of 5s lifts a kind above neutral', async () => {
    const { tallyRelevance, mergeCounts } = await import('./scoring');
    const rows = [5, 5, 5, 5].map((r) => ({
      kind: 'k',
      relevance: r,
      relevanceAt: NOW,
    }));
    const merged = mergeCounts(EMPTY_COUNTS, tallyRelevance(rows, NOW));
    expect(kindWeight(merged)).toBeGreaterThan(1);
    expect(kindWeight(merged)).toBeLessThanOrEqual(MAX_WEIGHT);
  });

  it('a run of 1s pushes it below neutral without muting it', async () => {
    const { tallyRelevance, mergeCounts } = await import('./scoring');
    const rows = [1, 1, 1, 1, 1, 1].map((r) => ({
      kind: 'k',
      relevance: r,
      relevanceAt: NOW,
    }));
    const merged = mergeCounts(EMPTY_COUNTS, tallyRelevance(rows, NOW));
    expect(kindWeight(merged)).toBeLessThan(1);
    // Only `never_kind` may reach zero — a statistic must never do it silently.
    expect(kindWeight(merged)).toBeGreaterThanOrEqual(MIN_WEIGHT);
  });

  it('adds to feedback rather than replacing it', async () => {
    const { tallyRelevance, mergeCounts } = await import('./scoring');
    const fb = tallyFeedback([vote('useful')], NOW);
    const rel = tallyRelevance([{ kind: 'test_kind', relevance: 5, relevanceAt: NOW }], NOW);
    const merged = mergeCounts(fb, rel);
    expect(merged.n).toBe(2);
    expect(kindWeight(merged)).toBeGreaterThan(kindWeight(fb));
  });
});

describe('meanRelevance', () => {
  it('is null with nothing rated, so the page can say so', async () => {
    const { meanRelevance } = await import('./scoring');
    expect(meanRelevance([])).toBeNull();
  });

  it('is the plain mean — undecayed, so it matches the cards beside it', async () => {
    const { meanRelevance } = await import('./scoring');
    const rows = [5, 4, 3].map((r) => ({ kind: 'k', relevance: r, relevanceAt: daysAgo(400) }));
    expect(meanRelevance(rows)).toEqual({ mean: 4, n: 3 });
  });

  it('ignores anything outside the dial', async () => {
    const { meanRelevance } = await import('./scoring');
    const rows = [{ kind: 'k', relevance: 0, relevanceAt: NOW }];
    expect(meanRelevance(rows)).toBeNull();
  });
});
