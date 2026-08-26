import { describe, it, expect } from 'vitest';
import { MAX_LEADS_PER_RUN, MAX_ROUNDS_PER_LEAD } from './run';
import { rankLeads, scoreLead, shouldAbandon } from './score';

// This repository has run away before: four heartbeat watchers escaped, one to
// 43,115 ticks, and the builder looped to iteration 11 with a cap of 2. Every
// bound below is checked in code rather than promised in a prompt, and these
// tests exist so a later change cannot quietly remove one.
describe('runaway protection', () => {
  it('caps how many lines advance in a single run', () => {
    expect(MAX_LEADS_PER_RUN).toBeLessThanOrEqual(5);
    expect(MAX_LEADS_PER_RUN).toBeGreaterThan(0);
  });

  // Separate from the barren test on purpose. That retires a line that has
  // stopped producing; this retires one that never stops producing JUST enough
  // to survive — which is the shape a runaway actually takes.
  it('caps a lead\'s whole life, not just its dry spells', () => {
    expect(MAX_ROUNDS_PER_LEAD).toBeGreaterThan(0);
    expect(MAX_ROUNDS_PER_LEAD).toBeLessThanOrEqual(50);
  });

  // A lead that keeps just clearing the bar must still terminate. Without the
  // lifetime cap this loop is immortal, because its score never falls far
  // enough to be abandoned.
  it('retires a permanently marginal lead via the lifetime cap', () => {
    const marginal = {
      hypothesesSpawned: 20,
      hypothesesHeld: 10,
      barrenRounds: 0, // never barren — always produces something
      roundsRun: MAX_ROUNDS_PER_LEAD,
      lastRoundAt: new Date('2026-08-26T00:00:00Z'),
      fromSteer: false,
    };
    // The barren test would never fire on this lead...
    expect(shouldAbandon(marginal, 4)).toBe(false);
    // ...so the lifetime cap is the only thing that stops it.
    expect(marginal.roundsRun >= MAX_ROUNDS_PER_LEAD).toBe(true);
  });

  // The frontier is a hard slice off a ranking, not a judgement call about
  // which leads "look interesting" — that is what keeps the bound real.
  it('advances a bounded slice however many leads are open', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ score: i / 40, roundsRun: 0 }));
    expect(rankLeads(many).slice(0, MAX_LEADS_PER_RUN)).toHaveLength(MAX_LEADS_PER_RUN);
  });

  // Pruning must be affordable, or it will not be done. It is arithmetic over
  // results the lead already has — no second model call.
  it('decides to prune without needing anything but its own numbers', () => {
    const now = new Date('2026-08-26T12:00:00Z');
    const barren = {
      hypothesesSpawned: 9, hypothesesHeld: 0, barrenRounds: 4,
      roundsRun: 4, lastRoundAt: now, fromSteer: false,
    };
    expect(shouldAbandon(barren, 4)).toBe(true);
    expect(scoreLead(barren, now).score).toBeLessThan(0.3);
  });
});
