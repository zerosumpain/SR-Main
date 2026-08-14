import { describe, it, expect } from 'vitest';
import {
  cosine,
  scoreYield,
  classifyOutcome,
  DRIFT_ALIGNMENT,
  DRIFT_CONNECTIVITY,
  type LeadOutcome,
} from './frontier-scoring';

function outcome(over: Partial<LeadOutcome> = {}): LeadOutcome {
  return {
    sourcesFound: 5,
    novelFacts: 6,
    duplicateFacts: 1,
    novelEntities: 3,
    connectedEntities: 3,
    goalAlignment: 0.7,
    searchFailed: false,
    ...over,
  };
}

describe('cosine', () => {
  it('is 1 for identical vectors and 0 for orthogonal ones', () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('is scale-invariant', () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });

  it('returns 0 rather than NaN for a zero vector', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it('returns 0 on a length mismatch instead of comparing garbage', () => {
    expect(cosine([1, 2, 3], [1, 2])).toBe(0);
  });
});

describe('scoreYield', () => {
  it('rewards novel facts and entities', () => {
    expect(scoreYield(outcome({ novelFacts: 10, novelEntities: 5 }))).toBeGreaterThan(
      scoreYield(outcome({ novelFacts: 1, novelEntities: 0 })),
    );
  });

  it('scores a lead that returned nothing at zero', () => {
    expect(
      scoreYield(outcome({ novelFacts: 0, novelEntities: 0, sourcesFound: 0, connectedEntities: 0 })),
    ).toBe(0);
  });

  // Two leads can both return ten facts; the one whose facts are ABOUT the
  // question is worth more. Without this the frontier happily chases a
  // well-covered but irrelevant topic.
  it('discounts a high-volume lead whose facts are off-question', () => {
    const onTopic = scoreYield(outcome({ novelFacts: 10, goalAlignment: 0.85 }));
    const offTopic = scoreYield(outcome({ novelFacts: 10, goalAlignment: 0.1 }));
    expect(offTopic).toBeLessThan(onTopic);
  });

  it('never returns a negative score', () => {
    expect(scoreYield(outcome({ novelFacts: 0, goalAlignment: 0, connectedEntities: 0 }))).toBeGreaterThanOrEqual(0);
  });
});

describe('classifyOutcome', () => {
  it('calls a productive lead productive', () => {
    expect(classifyOutcome(outcome()).status).toBe('productive');
  });

  // The dead-end rule: off-question AND unconnected to what we already know.
  // Either alone is not enough — a genuinely new sub-area starts unconnected,
  // and a tightly-connected aside can still be on-topic.
  it('marks a lead drifted when it is both off-question and unconnected', () => {
    const v = classifyOutcome(
      outcome({ goalAlignment: 0.1, connectedEntities: 0, novelEntities: 6, novelFacts: 8 }),
    );
    expect(v.status).toBe('drifted');
    expect(v.reason).toMatch(/connect|question/i);
  });

  it('does NOT drift a lead that is off-question but well connected', () => {
    expect(
      classifyOutcome(outcome({ goalAlignment: 0.1, connectedEntities: 5, novelEntities: 5 })).status,
    ).not.toBe('drifted');
  });

  it('does NOT drift a lead that is unconnected but on-question', () => {
    expect(
      classifyOutcome(outcome({ goalAlignment: 0.9, connectedEntities: 0, novelEntities: 5 })).status,
    ).not.toBe('drifted');
  });

  it('marks a lead exhausted when it found sources but nothing new', () => {
    const v = classifyOutcome(outcome({ novelFacts: 0, novelEntities: 0, duplicateFacts: 9 }));
    expect(v.status).toBe('exhausted');
    expect(v.reason).toMatch(/nothing new|already/i);
  });

  // A failed search is an ERROR, not evidence about the topic. Calling it
  // drifted would prune a perfectly good line of enquiry because Tavily
  // hiccuped.
  it('never blames the topic for a failed search', () => {
    const v = classifyOutcome(
      outcome({ searchFailed: true, sourcesFound: 0, novelFacts: 0, novelEntities: 0, goalAlignment: 0 }),
    );
    expect(v.status).toBe('failed');
    expect(v.reason).toMatch(/search/i);
  });

  it('reports a drifted lead in terms a human can act on', () => {
    const v = classifyOutcome(
      outcome({ novelFacts: 11, connectedEntities: 0, novelEntities: 7, goalAlignment: 0.05 }),
    );
    expect(v.reason).toContain('11');
  });

  it('uses the documented thresholds', () => {
    const justInside = classifyOutcome(
      outcome({ goalAlignment: DRIFT_ALIGNMENT + 0.01, connectedEntities: 0, novelEntities: 5 }),
    );
    expect(justInside.status).not.toBe('drifted');

    const justOutside = classifyOutcome(
      outcome({
        goalAlignment: DRIFT_ALIGNMENT - 0.01,
        connectedEntities: 0,
        novelEntities: Math.ceil(1 / DRIFT_CONNECTIVITY) + 1,
      }),
    );
    expect(justOutside.status).toBe('drifted');
  });

  // A lead that produced one connected entity out of twenty is not "connected".
  it('measures connectivity as a fraction, not a raw count', () => {
    const v = classifyOutcome(
      outcome({ goalAlignment: 0.1, novelEntities: 20, connectedEntities: 1, novelFacts: 9 }),
    );
    expect(v.status).toBe('drifted');
  });
});
