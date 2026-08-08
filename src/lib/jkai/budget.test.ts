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
});
