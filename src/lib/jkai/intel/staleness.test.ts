import { describe, it, expect } from 'vitest';
import {
  entityRelevance,
  recencyWeight,
  decayWeight,
  RECENCY_FLOOR,
  DEFAULT_HALF_LIFE_DAYS,
  MS_PER_DAY,
} from './staleness';

const NOW = Date.UTC(2026, 7, 5);
const daysAgo = (d: number) => NOW - d * MS_PER_DAY;

describe('recencyWeight', () => {
  it('is 1 for something observed right now', () => {
    expect(recencyWeight(0)).toBeCloseTo(1, 6);
  });

  it('halves over one half-life', () => {
    expect(recencyWeight(DEFAULT_HALF_LIFE_DAYS)).toBeCloseTo(0.5, 6);
  });

  it('never falls below the floor, however old', () => {
    expect(recencyWeight(10_000)).toBe(RECENCY_FLOOR);
  });

  it('treats a future timestamp as current rather than better than current', () => {
    // Clock skew on a sending server does happen; it must not out-rank the present.
    expect(recencyWeight(-50)).toBe(1);
  });
});

describe('entityRelevance', () => {
  it('shows its working — confidence and freshness come back with the score', () => {
    const r = entityRelevance({ confidence: 0.9, evidenceAt: daysAgo(0) }, NOW);
    expect(r.confidence).toBeCloseTo(0.9, 6);
    expect(r.freshness).toBeCloseTo(1, 6);
    expect(r.ageDays).toBeCloseTo(0, 6);
    expect(r.score).toBeCloseTo(0.9, 6);
  });

  it('discounts an old entity without gutting it', () => {
    const fresh = entityRelevance({ confidence: 0.8, evidenceAt: daysAgo(0) }, NOW);
    const old = entityRelevance({ confidence: 0.8, evidenceAt: daysAgo(365) }, NOW);
    expect(old.score).toBeLessThan(fresh.score);
    // Half the score is earned by confidence and is not on the table.
    expect(old.score).toBeGreaterThan(fresh.score * 0.5);
  });

  it('keeps a well-established old entity above a fresh guess', () => {
    // The reason this is not confidence x freshness. Multiplying would put the
    // fresh guess (0.3) above the established entity (0.95 x 0.15 = 0.14).
    const established = entityRelevance({ confidence: 0.95, evidenceAt: daysAgo(400) }, NOW);
    const guess = entityRelevance({ confidence: 0.3, evidenceAt: daysAgo(0) }, NOW);
    expect(established.score).toBeGreaterThan(guess.score);
  });

  it('treats an undated entity as stale, not as brand new', () => {
    const r = entityRelevance({ confidence: 0.9, evidenceAt: null }, NOW);
    expect(r.ageDays).toBeNull();
    expect(r.freshness).toBe(RECENCY_FLOOR);
    expect(r.score).toBeCloseTo(decayWeight(0.9, RECENCY_FLOOR), 6);
  });

  it('scores an entity with no confidence at zero however fresh it is', () => {
    expect(entityRelevance({ confidence: 0, evidenceAt: daysAgo(0) }, NOW).score).toBe(0);
  });

  it('clamps a confidence outside 0..1 rather than propagating it', () => {
    expect(entityRelevance({ confidence: 4, evidenceAt: daysAgo(0) }, NOW).score).toBeLessThanOrEqual(1);
    expect(entityRelevance({ confidence: -1, evidenceAt: daysAgo(0) }, NOW).score).toBe(0);
  });

  it('is monotone in age — older never scores higher', () => {
    let previous = Infinity;
    for (const d of [0, 7, 30, 90, 180, 365, 1000]) {
      const s = entityRelevance({ confidence: 0.7, evidenceAt: daysAgo(d) }, NOW).score;
      expect(s).toBeLessThanOrEqual(previous);
      previous = s;
    }
  });

  it('is stable — the same inputs give the same score', () => {
    // The watchlist alerts on change, so drift here would invent notifications.
    const input = { confidence: 0.62, evidenceAt: daysAgo(14) };
    expect(entityRelevance(input, NOW).score).toBe(entityRelevance(input, NOW).score);
  });
});
