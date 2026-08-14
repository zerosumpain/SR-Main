import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBudget, NO_BUDGET } from './budget';

describe('createBudget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports the full budget as remaining at the start', () => {
    const b = createBudget(120_000);
    expect(b.remaining()).toBe(120_000);
    expect(b.expired()).toBe(false);
  });

  it('counts down as the clock advances', () => {
    const b = createBudget(120_000);
    vi.advanceTimersByTime(30_000);
    expect(b.remaining()).toBe(90_000);
  });

  it('clamps remaining at zero rather than going negative', () => {
    const b = createBudget(10_000);
    vi.advanceTimersByTime(25_000);
    expect(b.remaining()).toBe(0);
    expect(b.expired()).toBe(true);
  });

  // The whole point of a reserve: synthesis must still get its slice even when
  // gathering would happily eat the entire budget. `remainingFor` is what the
  // GATHERING stages consult, so it hides the reserved tail from them.
  it('hides the reserved tail from non-reserved stages', () => {
    const b = createBudget(120_000, { synthesis: 20_000 });
    expect(b.remainingFor('gather')).toBe(100_000);
    expect(b.remaining()).toBe(120_000);
  });

  it('gives the reserved stage the whole remaining budget', () => {
    const b = createBudget(120_000, { synthesis: 20_000 });
    vi.advanceTimersByTime(100_000);
    expect(b.remainingFor('gather')).toBe(0);
    expect(b.remainingFor('synthesis')).toBe(20_000);
  });

  it('expiredFor is true for a gathering stage once the reserve is all that is left', () => {
    const b = createBudget(120_000, { synthesis: 20_000 });
    vi.advanceTimersByTime(100_001);
    expect(b.expiredFor('gather')).toBe(true);
    expect(b.expiredFor('synthesis')).toBe(false);
  });

  it('a reserve larger than the budget still leaves the reserved stage some time', () => {
    const b = createBudget(10_000, { synthesis: 30_000 });
    expect(b.remainingFor('gather')).toBe(0);
    expect(b.remainingFor('synthesis')).toBe(10_000);
  });

  // `AbortSignal.timeout` runs on a native timer that fake clocks do not drive,
  // and it is deliberately kept in production because those timers are unref'd —
  // a long-lived budget handing out signals cannot hold the event loop open.
  // These assertions therefore run on the real clock with tiny budgets.
  describe('signal (real timers)', () => {
    beforeEach(() => {
      vi.useRealTimers();
    });

    const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

    it('produces a signal that aborts when the stage budget runs out', async () => {
      const b = createBudget(20);
      const sig = b.signalFor('gather');
      expect(sig.aborted).toBe(false);
      await tick(60);
      expect(sig.aborted).toBe(true);
    });

    // A stage must never be handed a signal that is already dead on arrival
    // without the caller being able to tell: expiredFor() is the guard, and the
    // signal reflects it immediately rather than on the next tick.
    it('returns an already-aborted signal when the stage budget is gone', async () => {
      const b = createBudget(10);
      await tick(40);
      expect(b.signalFor('gather').aborted).toBe(true);
    });

    it('caps a stage signal at the caller-supplied ceiling', async () => {
      const b = createBudget(120_000);
      const sig = b.signalFor('gather', 20);
      await tick(60);
      expect(sig.aborted).toBe(true);
    });
  });

  describe('NO_BUDGET', () => {
    it('never expires and reports Infinity', () => {
      expect(NO_BUDGET.remaining()).toBe(Infinity);
      expect(NO_BUDGET.expired()).toBe(false);
      expect(NO_BUDGET.remainingFor('gather')).toBe(Infinity);
      expect(NO_BUDGET.expiredFor('synthesis')).toBe(false);
    });

    it('still honours a caller-supplied ceiling on its signal', async () => {
      vi.useRealTimers();
      const sig = NO_BUDGET.signalFor('gather', 20);
      await new Promise((r) => setTimeout(r, 60));
      expect(sig.aborted).toBe(true);
    });

    it('gives an unbounded signal when no ceiling is supplied', () => {
      expect(NO_BUDGET.signalFor('gather').aborted).toBe(false);
    });
  });
});
