import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Only the quotaGuard cases reach these; the pure-function cases never do.
const q = vi.hoisted(() => ({
  usage: [] as Array<unknown>,
  clears: 0,
  pulses: [] as Array<{ details: unknown }>,
}));
vi.mock('$lib/server/models/codex-usage', () => ({
  getCodexUsage: async () => q.usage.shift() ?? null,
  clearCodexUsageCache: () => {
    q.clears++;
  },
}));
vi.mock('$lib/db', () => {
  const b: Record<string, unknown> = {};
  b.from = () => b;
  b.innerJoin = () => b;
  b.where = () => Promise.resolve(q.pulses);
  return { db: { select: () => b } };
});

import {
  attributeSpend,
  dayProgress,
  DAILY_WEEKLY_CAP_PCT,
  DEPTH_PLANS,
  FIVE_HOUR_SECONDS,
  localDayStart,
  pickWindows,
  hasThinkingHeadroom,
  planDepth,
  quotaGuard,
  SPENDING_ACTIONS,
  windowStart,
  type BudgetStatus,
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

describe('hasThinkingHeadroom', () => {
  const full = (over: Partial<BudgetStatus> = {}): BudgetStatus => ({
    applies: true,
    reachable: true,
    spentTodayWeeklyPct: 0,
    spentThisWindowPct: 0,
    dailyCapPct: 10,
    fiveHourCapPct: 50,
    remainingTodayPct: 10,
    remainingWindowPct: 50,
    pacedTargetPct: 0.4,
    blocked: false,
    blockedReason: null,
    plan: DEPTH_PLANS.minimal,
    ...over,
  });

  it('affords an extra pass when both caps are largely unspent', () => {
    expect(hasThinkingHeadroom(full())).toBe(true);
  });

  it('affords one at breakfast, when the day is "ahead of pace" but nothing is spent', () => {
    // The bug this replaced: overnight jobs spend from 02:30 against a paced
    // target that only starts accruing at 07:00, so `plan.depth` resolved to
    // `minimal` every morning and the second pass never ran before evening.
    const morning = full({ plan: DEPTH_PLANS.minimal, pacedTargetPct: 0.4, spentTodayWeeklyPct: 0.9 });
    expect(morning.plan.depth).toBe('minimal');
    expect(hasThinkingHeadroom(morning)).toBe(true);
  });

  it('refuses once the day is mostly spent', () => {
    expect(hasThinkingHeadroom(full({ remainingTodayPct: 2 }))).toBe(false);
  });

  it('refuses once the five-hour window is mostly spent', () => {
    expect(hasThinkingHeadroom(full({ remainingWindowPct: 10 }))).toBe(false);
  });

  it('sits exactly on the share boundary', () => {
    expect(hasThinkingHeadroom(full({ remainingTodayPct: 2.5, remainingWindowPct: 12.5 }))).toBe(true);
    expect(hasThinkingHeadroom(full({ remainingTodayPct: 2.49 }))).toBe(false);
  });

  it('refuses on a non-Codex model — the spend is cash, not slack', () => {
    expect(hasThinkingHeadroom(full({ applies: false }))).toBe(false);
  });

  it('refuses when the meter cannot be read — minimum, never a guess', () => {
    expect(hasThinkingHeadroom(full({ reachable: false }))).toBe(false);
  });

  it('refuses when the budget is blocked', () => {
    expect(hasThinkingHeadroom(full({ blocked: true, blockedReason: 'daily cap reached' }))).toBe(false);
  });

  it('refuses rather than dividing by a zero cap', () => {
    expect(hasThinkingHeadroom(full({ dailyCapPct: 0 }))).toBe(false);
    expect(hasThinkingHeadroom(full({ fiveHourCapPct: 0 }))).toBe(false);
  });
});

function usage(fiveHour: number, weekly: number, extra: Record<string, unknown> = {}) {
  return {
    limitReached: false,
    windows: [
      { usedPercent: fiveHour, windowSeconds: 18_000, resetAt: null },
      { usedPercent: weekly, windowSeconds: 604_800, resetAt: null },
    ],
    ...extra,
  };
}

describe('quotaGuard', () => {
  beforeEach(() => {
    q.usage = [];
    q.clears = 0;
    q.pulses = [];
  });

  it('never blocks a non-Codex model and attributes it no quota', async () => {
    const g = quotaGuard({ action: 'daydream-think', isCodexModel: false });
    const v = await g.check();
    expect(v.allowed).toBe(true);
    expect(v.status.applies).toBe(false);
    await g.begin();
    expect(await g.end()).toEqual({ weeklyPct: 0, fiveHourPct: 0 });
    expect(q.clears).toBe(0);
  });

  it('fails SOFT on an unreadable meter: allowed, at minimal depth', async () => {
    const v = await quotaGuard({ action: 'daydream-think', isCodexModel: true }).check();
    expect(v.allowed).toBe(true);
    expect(v.status.reachable).toBe(false);
    expect(v.status.plan.depth).toBe('minimal');
  });

  it('blocks, non-terminally, when the subscription window is exhausted', async () => {
    q.usage = [usage(10, 10, { limitReached: true })];
    const v = await quotaGuard({ action: 'daydream-memory', isCodexModel: true }).check();
    expect(v.allowed).toBe(false);
    expect(v.terminal).toBe(false);
    expect(v.reason).toMatch(/exhausted/);
  });

  it('blocks on the daily cap from pulses already spent', async () => {
    q.usage = [usage(10, 10)];
    q.pulses = [{ details: { quota: { weeklyPct: DAILY_WEEKLY_CAP_PCT, fiveHourPct: 1 } } }];
    const v = await quotaGuard({ action: 'daydream-notebook', isCodexModel: true }).check();
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/daily cap/);
    expect(v.remaining.todayPct).toBe(0);
  });

  it('attributes the before/after delta, clearing the usage cache before each read', async () => {
    q.usage = [usage(20, 30), usage(22.5, 30.4)];
    const g = quotaGuard({ action: 'daydream-think', isCodexModel: true });
    await g.begin();
    const spend = await g.end();
    expect(spend).toEqual({ weeklyPct: 0.4, fiveHourPct: 2.5 });
    expect(g.spent).toEqual(spend);
    expect(q.clears).toBe(2);
  });
});

describe('SPENDING_ACTIONS covers every activity that reads the quota meter', () => {
  // The omission has happened three times (hypothesise + spend, then memory +
  // notebook) and the symptom is silence: the activity spends Codex quota the
  // caps never see. So the list is checked against the code, not memory.
  const dir = join(process.cwd(), 'src/lib/heartbeat/activities');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const spenders = files
    .map((f) => ({ f, src: readFileSync(join(dir, f), 'utf8') }))
    .filter(({ src }) => /\b(readQuotaMark|quotaGuard)\b/.test(src));

  it('finds the spenders it is guarding (the scan is not vacuous)', () => {
    expect(spenders.map((s) => s.f)).toEqual(
      expect.arrayContaining(['daydream-memory.ts', 'daydream-notebook.ts', 'daydream-think.ts']),
    );
  });

  it.each(spenders.map((s) => [s.f, s.src] as const))('%s is named in SPENDING_ACTIONS', (_f, src) => {
    const name =
      src.match(/const NAME = '([^']+)'/)?.[1] ?? src.match(/\bname:\s*'([^']+)'/)?.[1] ?? null;
    expect(name).not.toBeNull();
    expect(SPENDING_ACTIONS as readonly string[]).toContain(name);
  });
});
