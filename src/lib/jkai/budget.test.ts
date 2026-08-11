import { describe, it, expect, vi, beforeEach } from 'vitest';

// checkBudget reads recent iterations from the DB; stub that so the assertions
// are about the budget arithmetic, not drizzle.
const rows = vi.hoisted(() => ({ current: [] as Array<Record<string, unknown>> }));
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows.current),
      }),
    }),
  },
}));
vi.mock('$lib/db/schema', () => ({ jkaiIterations: {} }));
vi.mock('drizzle-orm', () => ({
  eq: () => ({}),
  and: () => ({}),
  gte: () => ({}),
}));

import { checkBudget } from './budget';

const build = (over: Record<string, unknown> = {}) =>
  ({
    id: 'b1',
    iterationsCompleted: 1,
    activeMinutesUsed: 5,
    costUsd: '0.10',
    budgetConfig: {},
    ...over,
  }) as never;

beforeEach(() => {
  rows.current = [];
});

describe('checkBudget', () => {
  it('proceeds when nothing is capped', async () => {
    expect((await checkBudget(build())).canProceed).toBe(true);
  });

  it('stops at the iteration cap', async () => {
    const r = await checkBudget(build({ iterationsCompleted: 25, budgetConfig: { maxIterations: 25 } }));
    expect(r.canProceed).toBe(false);
    expect(r.shouldComplete).toBe(true);
  });

  it('stops at the cost cap', async () => {
    // Tokens and minutes are proxies for spend; this is the thing itself.
    const r = await checkBudget(build({ costUsd: '2.50', budgetConfig: { maxCostUsd: 2 } }));
    expect(r.canProceed).toBe(false);
    expect(r.reason).toMatch(/Cost cap/);
  });

  it('keeps going below the cost cap', async () => {
    expect((await checkBudget(build({ costUsd: '0.5', budgetConfig: { maxCostUsd: 2 } }))).canProceed).toBe(
      true,
    );
  });

  it('counts FAILED iterations toward the hourly token budget', async () => {
    // A failed iteration costs exactly as much as a successful one. Counting
    // only completed ones meant build #126 spent 3.08M against a 1M cap that
    // never engaged (2026-08-07).
    rows.current = [
      { tokensUsed: 600_000, durationMs: 0, status: 'failed', createdAt: new Date() },
      { tokensUsed: 600_000, durationMs: 0, status: 'completed', createdAt: new Date() },
    ];
    const r = await checkBudget(build({ budgetConfig: { maxTokensPerHour: 1_000_000 } }));
    expect(r.canProceed).toBe(false);
    expect(r.reason).toMatch(/Token limit/);
  });

  it('tells the reader when the cooldown ends, not just that it started', async () => {
    // The line is re-logged every five minutes. Repeated eight times with no
    // time in it, it reads as a hang — which is why change request #204 was
    // killed rather than waited out.
    const started = new Date(Date.now() - 10 * 60 * 1000);
    rows.current = [{ tokensUsed: 2_000_000, durationMs: 0, status: 'completed', createdAt: started }];
    const r = await checkBudget(build({ budgetConfig: { maxTokensPerHour: 1_000_000 } }));
    expect(r.canProceed).toBe(false);
    // 50 minutes left of the window, but it re-checks in 5 — a rolling window
    // can free up before its oldest entry actually expires.
    expect(r.reason).toMatch(/about 50 min/);
    expect(r.reason).toMatch(/not before \d{2}:\d{2}/);
    expect(r.reason).toMatch(/no work is lost/);
    expect(r.sleepMs).toBe(5 * 60 * 1000);
  });

  it('does not stall a build whose single iteration cost more than the old 1M ceiling', async () => {
    // The unit is TOTAL tokens — input, output, and the conversation re-sent on
    // every tool call — so one iteration of even a small change costs ~1M. The
    // ceiling has to sit above one iteration or the first one ends the hour.
    rows.current = [{ tokensUsed: 1_100_000, durationMs: 0, status: 'completed', createdAt: new Date() }];
    expect((await checkBudget(build({ budgetConfig: { maxTokensPerHour: 3_000_000 } }))).canProceed).toBe(true);
  });
});
