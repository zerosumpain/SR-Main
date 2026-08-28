import { describe, it, expect } from 'vitest';
import { digestDay, phrase } from './build';

const empty = {
  questionsAsked: 0, questionsAnswered: 0, held: 0, refuted: 0, backwards: 0,
  underpowered: 0, thoughtsRaised: 0, thoughtsDelivered: 0,
  placesNamed: 5, placesWaiting: 78, daysOfData: 236,
};

describe('digestDay', () => {
  it('covers the previous LOCAL day', () => {
    // 00:30 local on the 27th (23:30 UTC on the 26th) digests the 26th.
    expect(digestDay(new Date('2026-08-26T23:30:00Z'), 1)).toBe('2026-08-26');
    expect(digestDay(new Date('2026-08-26T09:00:00Z'), 1)).toBe('2026-08-25');
  });
});

describe('phrase', () => {
  // The rule that makes the digest trustworthy: a quiet day still says
  // something. A card that only appears when there is news cannot be trusted
  // when it is silent, because absence stops meaning anything.
  it('reports a completely quiet day with the state of the ledger', () => {
    const line = phrase(empty);
    expect(line).toContain('Nothing new yesterday');
    expect(line).toContain('236 days of data');
    expect(line).toContain('78 still waiting');
  });

  it('reports questions asked and how they turned out', () => {
    const line = phrase({ ...empty, questionsAsked: 4, questionsAnswered: 4, held: 1, refuted: 2, underpowered: 1 });
    expect(line).toContain('Asked 4 new questions');
    expect(line).toContain('answered 4');
    expect(line).toContain('1 holding');
    expect(line).toContain('2 came back empty');
    expect(line).toContain('1 still short of data');
  });

  // Refutation is reported as an outcome, not hidden as a non-event.
  it('says so when everything came back empty', () => {
    const line = phrase({ ...empty, questionsAnswered: 3, refuted: 3 });
    expect(line).toContain('3 came back empty');
  });

  it('says when it noticed things and stayed quiet about them', () => {
    const line = phrase({ ...empty, thoughtsRaised: 6, thoughtsDelivered: 0 });
    expect(line).toContain('oticed 6 things');
    expect(line).toContain('said nothing');
  });

  it('gets the singular right', () => {
    expect(phrase({ ...empty, questionsAsked: 1 })).toContain('1 new question');
    expect(phrase({ ...empty, thoughtsRaised: 1 })).toContain('oticed 1 thing');
  });
});
