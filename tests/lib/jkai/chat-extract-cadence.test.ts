import { describe, it, expect } from 'vitest';
import { shouldExtractAtTurn } from '$lib/jkai/intel/chat-extract';

// The cadence is the spend control on thread concept extraction: it puts an
// LLM call behind some turns and not others. Getting it wrong either bills a
// call per reply or never builds a graph at all.
//
// It used to be "turn 2, then every 4th", which failed the second way. Measured
// on production 2026-07-27, the median /jkai thread runs 3–5 real assistant
// turns — shorter than the gap — so almost every thread extracted exactly once
// and lost everything said after its opening exchange. The cadence now ramps:
// dense over the range threads actually occupy, sparse only where a long thread
// would otherwise bill for repetition.
describe('shouldExtractAtTurn', () => {
  it('never fires before the first reply exists', () => {
    expect(shouldExtractAtTurn(0)).toBe(false);
  });

  it('fires on every turn of a normal-length thread', () => {
    // This is the case the old cadence got wrong: a 3–5 turn thread must have
    // its later turns extracted, not just its first exchange.
    for (const turn of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(shouldExtractAtTurn(turn)).toBe(true);
    }
  });

  it('thins out once a thread runs long', () => {
    expect(shouldExtractAtTurn(9)).toBe(false);
    expect(shouldExtractAtTurn(11)).toBe(true);
    expect(shouldExtractAtTurn(14)).toBe(true);
    expect(shouldExtractAtTurn(23)).toBe(true);
    // Past the mid band the gap widens again.
    expect(shouldExtractAtTurn(25)).toBe(false);
    expect(shouldExtractAtTurn(30)).toBe(true);
    expect(shouldExtractAtTurn(36)).toBe(true);
  });

  it('stays bounded over a marathon thread', () => {
    const fired = Array.from({ length: 60 }, (_, i) => shouldExtractAtTurn(i)).filter(Boolean);
    // 60 turns must still not mean 60 extraction calls.
    expect(fired.length).toBeLessThanOrEqual(20);
  });
});
