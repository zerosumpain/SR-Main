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
