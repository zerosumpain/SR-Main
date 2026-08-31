import { describe, it, expect } from 'vitest';
import { isJudgeable, rankLeads, scoreLead, shouldAbandon, STALE_AFTER_DAYS } from './score';

const now = new Date('2026-08-26T12:00:00Z');
const base = {
  hypothesesSpawned: 0,
  hypothesesHeld: 0,
  barrenRounds: 0,
  roundsRun: 0,
  lastRoundAt: null,
  fromSteer: false,
};

describe('scoreLead', () => {
  // A brand-new lead must sit at neutral. Born at zero, it could never collect
  // the evidence needed to prove itself — the same argument the kind weights
  // make, and the same failure Wilson lower bound has at n = 0.
  it('starts a lead with no results at exactly neutral', () => {
    expect(scoreLead(base, now).score).toBeCloseTo(0.5, 2);
  });

  it('rises for a lead whose hypotheses hold', () => {
    const s = scoreLead({ ...base, hypothesesSpawned: 6, hypothesesHeld: 5 }, now).score;
    expect(s).toBeGreaterThan(0.5);
  });

  it('falls for a lead that keeps coming back empty', () => {
    const s = scoreLead({ ...base, hypothesesSpawned: 6, hypothesesHeld: 0 }, now).score;
    expect(s).toBeLessThan(0.5);
  });

  // Decay rather than subtraction, so a lead that goes quiet fades instead of
  // falling off a cliff — thin data is not the same as a wrong idea.
  it('fades a barren lead without driving it negative', () => {
    const one = scoreLead({ ...base, barrenRounds: 1 }, now).score;
    const four = scoreLead({ ...base, barrenRounds: 4 }, now).score;
    expect(four).toBeLessThan(one);
    expect(four).toBeGreaterThan(0);
  });

  it('deprioritises a lead nobody has run for weeks', () => {
    const fresh = scoreLead({ ...base, lastRoundAt: now }, now).score;
    const old = scoreLead(
      { ...base, lastRoundAt: new Date(now.getTime() - (STALE_AFTER_DAYS + 40) * 86_400_000) },
      now,
    ).score;
    expect(old).toBeLessThan(fresh);
    expect(old).toBeGreaterThan(0);
  });

  // A line he asked for cannot be starved out by arithmetic before it has had
  // a fair run. His asking is evidence even when the statistics have not caught up.
  it('gives a steered lead a floor, not a boost', () => {
    const starved = { ...base, hypothesesSpawned: 8, hypothesesHeld: 0, barrenRounds: 5 };
    expect(scoreLead(starved, now).score).toBeLessThan(0.3);
    expect(scoreLead({ ...starved, fromSteer: true }, now).score).toBeGreaterThanOrEqual(0.45);
  });

  it('shows its working', () => {
    const c = scoreLead({ ...base, hypothesesSpawned: 4, hypothesesHeld: 2 }, now).components;
    for (const k of ['yield', 'barrenDecay', 'staleness', 'held', 'empty']) {
      expect(c).toHaveProperty(k);
    }
  });
});

describe('shouldAbandon', () => {
  it('gives up on a line that has produced nothing for its own limit', () => {
    expect(shouldAbandon({ ...base, barrenRounds: 4 }, 4)).toBe(true);
    expect(shouldAbandon({ ...base, barrenRounds: 3 }, 4)).toBe(false);
  });

  // Quietly dropping something he explicitly asked about is the exact behaviour
  // that would make the steer box worthless.
  it('never abandons a line John asked for', () => {
    expect(shouldAbandon({ ...base, barrenRounds: 99, fromSteer: true }, 4)).toBe(false);
  });
});

describe('rankLeads', () => {
  it('puts the best-performing line first', () => {
    const ranked = rankLeads([
      { score: 0.3, roundsRun: 1 },
      { score: 0.8, roundsRun: 5 },
      { score: 0.5, roundsRun: 2 },
    ]);
    expect(ranked[0].score).toBe(0.8);
  });

  it('gives a new lead a look before re-running an old one on a tie', () => {
    const ranked = rankLeads([
      { score: 0.5, roundsRun: 9 },
      { score: 0.5, roundsRun: 0 },
    ]);
    expect(ranked[0].roundsRun).toBe(0);
  });
});

describe('isJudgeable — the four-hour death', () => {
  const round = new Date('2026-08-31T06:46:00Z');

  it('refuses to judge a round no question has been asked since', () => {
    // The fault it prevents: explore runs HOURLY and hypothesise DAILY, so a
    // new lead collected a barren round every hour against a threshold of 4
    // and died four hours after birth — twelve hours before the only activity
    // that could have vindicated it next ran.
    expect(isJudgeable(round, new Date('2026-08-30T22:46:00Z'))).toBe(false);
  });

  it('judges once the question-asker has run since the round began', () => {
    expect(isJudgeable(round, new Date('2026-08-31T22:46:00Z'))).toBe(true);
  });

  it('treats a lead that has never had a round as having nothing pending', () => {
    expect(isJudgeable(null, null)).toBe(true);
    expect(isJudgeable(null, new Date('2026-08-31T22:46:00Z'))).toBe(true);
  });

  it('refuses when nothing has ever been asked', () => {
    // Exactly the state daydream_leads was in this morning: a lead exists and
    // the hypothesis engine has produced nothing for it yet.
    expect(isJudgeable(round, null)).toBe(false);
  });

  it('is exclusive at the boundary — the same instant is not "since"', () => {
    expect(isJudgeable(round, new Date(round))).toBe(false);
  });
});
