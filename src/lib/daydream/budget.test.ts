import { describe, it, expect } from 'vitest';
import {
  attributeSpend,
  dayProgress,
  DAILY_WEEKLY_CAP_PCT,
  DEPTH_PLANS,
  FIVE_HOUR_SECONDS,
  localDayStart,
  pickWindows,
  planDepth,
  windowStart,
} from './budget';

describe('dayProgress', () => {
  // Pacing is against the owner's waking hours. Against the full 24h the
  // allowance would sit unspent until bedtime and then burn overnight, which
  // is both useless and the opposite of "run close to the limit".
  it('is zero before the day opens', () => {
    expect(dayProgress(new Date('2026-08-26T03:00:00Z'))).toBe(0);
  });

  it('is one after it closes', () => {
    // 22:30 UTC is 23:30 BST — past the 23:00 close, same local day.
    expect(dayProgress(new Date('2026-08-26T22:30:00Z'))).toBe(1);
  });

  it('resets after local midnight rather than carrying the evening over', () => {
    // 23:30 UTC is 00:30 BST the NEXT day: a new day, nothing spent yet.
    expect(dayProgress(new Date('2026-08-26T23:30:00Z'))).toBe(0);
  });

  it('rises across the day', () => {
    // 11:00 UTC is 12:00 BST — roughly a third through a 07:00–23:00 window.
    const p = dayProgress(new Date('2026-08-26T11:00:00Z'));
    expect(p).toBeGreaterThan(0.25);
    expect(p).toBeLessThan(0.45);
  });
});

describe('localDayStart', () => {
  it('uses local midnight, not UTC midnight', () => {
    // Under BST, 00:30 local on the 26th is 23:30 UTC on the 25th.
    const start = localDayStart(new Date('2026-08-26T12:00:00Z'));
    expect(start.toISOString()).toBe('2026-08-25T23:00:00.000Z');
  });
});

describe('pickWindows', () => {
  it('identifies the 5-hour and weekly windows by length', () => {
    const { fiveHour, weekly } = pickWindows([
      { usedPercent: 12, windowSeconds: 18000, resetAt: null },
      { usedPercent: 40, windowSeconds: 604800, resetAt: null },
    ]);
    expect(fiveHour?.usedPercent).toBe(12);
    expect(weekly?.usedPercent).toBe(40);
  });

  it('returns nulls rather than guessing when a window is absent', () => {
    const { fiveHour, weekly } = pickWindows([]);
    expect(fiveHour).toBeNull();
    expect(weekly).toBeNull();
  });
});

describe('windowStart', () => {
  const now = new Date('2026-08-26T12:00:00Z');

  it('derives the start from the reported reset', () => {
    const resetAt = now.getTime() + 3_600_000; // an hour from now
    const start = windowStart(resetAt, now);
    expect(start.getTime()).toBe(resetAt - FIVE_HOUR_SECONDS * 1000);
  });

  it('falls back to a full window back when no reset is reported', () => {
    // Over-counts our own spend, which errs toward backing off — the safe way
    // to be wrong about a shared quota.
    const start = windowStart(null, now);
    expect(start.getTime()).toBe(now.getTime() - FIVE_HOUR_SECONDS * 1000);
  });
});

describe('attributeSpend', () => {
  it('takes the delta across a run', () => {
    const spend = attributeSpend(
      { weeklyPct: 10, fiveHourPct: 20 },
      { weeklyPct: 10.4, fiveHourPct: 23 },
    );
    expect(spend.weeklyPct).toBeCloseTo(0.4, 3);
    expect(spend.fiveHourPct).toBeCloseTo(3, 3);
  });

  it('treats a window rollover as zero, not a refund', () => {
    const spend = attributeSpend(
      { weeklyPct: 90, fiveHourPct: 95 },
      { weeklyPct: 1, fiveHourPct: 2 },
    );
    expect(spend.weeklyPct).toBe(0);
    expect(spend.fiveHourPct).toBe(0);
  });

  it('is zero when the meter could not be read at either end', () => {
    expect(attributeSpend(null, { weeklyPct: 5, fiveHourPct: 5 })).toEqual({
      weeklyPct: 0,
      fiveHourPct: 0,
    });
    expect(attributeSpend({ weeklyPct: 5, fiveHourPct: 5 }, null)).toEqual({
      weeklyPct: 0,
      fiveHourPct: 0,
    });
  });

  it('keeps concurrent owner usage in our ledger rather than discarding it', () => {
    // Over-attribution makes daydreaming back off early. The opposite error
    // would have a background job quietly eat a quota the owner is using.
    const spend = attributeSpend(
      { weeklyPct: 10, fiveHourPct: 10 },
      { weeklyPct: 25, fiveHourPct: 40 },
    );
    expect(spend.weeklyPct).toBe(15);
    expect(spend.fiveHourPct).toBe(30);
  });
});

describe('planDepth — spend the headroom on precision, not volume', () => {
  it('goes deep when well behind the paced target', () => {
    const plan = planDepth(9, 45, 0.5, 5);
    expect(plan.depth).toBe('deep');
    expect(plan.verify).toBe(true);
    expect(plan.composeSilent).toBe(true);
  });

  it('works at standard depth when slightly behind', () => {
    const plan = planDepth(6, 30, 4.2, 5);
    expect(plan.depth).toBe('standard');
  });

  it('drops to minimal once at or past the paced target', () => {
    expect(planDepth(5, 30, 6, 5).depth).toBe('minimal');
    expect(planDepth(5, 30, 5, 5).depth).toBe('minimal');
  });

  it('drops to minimal when almost nothing is left, however far behind', () => {
    expect(planDepth(0.1, 40, 0, 8).depth).toBe('minimal');
    expect(planDepth(9, 0.1, 0, 8).depth).toBe('minimal');
  });

  it('never lets depth raise how many thoughts are DELIVERED', () => {
    // Depth buys candidates considered and verification passes. Delivery
    // limits live in deliver.ts and no plan here can widen them.
    for (const plan of Object.values(DEPTH_PLANS)) {
      expect(Object.keys(plan)).not.toContain('maxDeliveries');
      expect(plan.maxCandidates).toBeLessThanOrEqual(3);
    }
  });

  it('keeps the caps at what the owner asked for', () => {
    expect(DAILY_WEEKLY_CAP_PCT).toBe(10);
  });
});
