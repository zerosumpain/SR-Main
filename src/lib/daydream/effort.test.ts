import { describe, expect, it } from 'vitest';
import { DEFAULT_EFFORT, applyEffort, clampEffort, describeEffort, resolveEffort } from './effort';

describe('resolveEffort', () => {
  it('at the default shares every number is what the engine shipped with', () => {
    const r = resolveEffort(DEFAULT_EFFORT);
    expect(r.hypothesise.maxProposals).toBe(4);
    expect(r.ponder.maxMusings).toBe(4);
    expect(r.ponder.maxLeads).toBe(2);
    expect(r.ponder.lookupBudget).toBe(6);
    expect(r.sweep.maxSignals).toBe(120);
    expect(r.explore.maxLeads).toBe(3);
    expect(r.review.maxPerRun).toBe(4);
    expect(r.review.backfillPerRun).toBe(10);
    expect(r.compose.extraCandidates).toBe(1);
    expect(r.compose.verify).toBe(true);
  });

  it('turns the discover share into breadth and the test share into throughput', () => {
    const quiet = resolveEffort({ discover: 0, test: 0, propose: 0 });
    const loud = resolveEffort({ discover: 100, test: 100, propose: 100 });
    expect(quiet.hypothesise.maxProposals).toBe(1);
    expect(loud.hypothesise.maxProposals).toBe(8);
    expect(quiet.sweep.maxSignals).toBe(60);
    expect(loud.sweep.maxSignals).toBe(240);
    expect(quiet.review.maxPerRun).toBe(1);
    expect(loud.review.maxPerRun).toBe(8);
    expect(quiet.compose.verify).toBe(false);
    expect(loud.compose.extraCandidates).toBe(2);
  });

  it('clamps and defaults nonsense', () => {
    expect(clampEffort({ discover: 900, test: -4, propose: Number.NaN })).toEqual({ discover: 100, test: 0, propose: 50 });
    expect(clampEffort(null)).toEqual(DEFAULT_EFFORT);
  });
});

describe('applyEffort', () => {
  it('lets an explicit heartbeat config value win over the dial', () => {
    const out = applyEffort({ maxProposals: 2 }, { maxProposals: 8, other: 1 });
    expect(out).toEqual({ maxProposals: 2, other: 1 });
    expect(applyEffort({}, { maxProposals: 8 })).toEqual({ maxProposals: 8 });
    expect(applyEffort({ maxProposals: null }, { maxProposals: 8 })).toEqual({ maxProposals: 8 });
  });
});

describe('describeEffort', () => {
  it('says the numbers, one line per share', () => {
    const lines = describeEffort(DEFAULT_EFFORT);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^discover 50: 4 proposals/);
    expect(lines[1]).toMatch(/verify on/);
  });
});
