import { describe, it, expect, vi } from 'vitest';

// change-request.ts pulls the db client, the builder socket client and the
// GitHub client in at import time. Nothing here calls createChangeRequest, so
// stubbing the modules is enough — same shape as studio.test.ts.
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('./builder-client', () => ({ builderClient: { startBuild: async () => {} } }));
vi.mock('$lib/github/issues', () => ({
  createIssue: async () => ({ number: 1, url: '' }),
  commentOnIssue: async () => {},
  githubConfigured: () => true,
  REPO_SLUG: 'zerosumpain/SR-Main',
}));

import { CHANGE_REQUEST_BUDGET } from './change-request';

describe('change-request budget', () => {
  // The observed cost of ONE ordinary iteration on a small change: 910k for the
  // first of change request #204, 1.1M for the second. The hourly ceiling is
  // measured in the same total-token unit, so anything at or below this makes
  // the first iteration end the build's hour — a stall dressed up as a limit.
  const ONE_ITERATION = 1_100_000;

  it('leaves room for more than one iteration inside the hour', () => {
    expect(CHANGE_REQUEST_BUDGET.maxTokensPerHour).toBeGreaterThan(ONE_ITERATION * 2);
  });

  it('still stops a runaway well inside the iteration cap', () => {
    // Not a licence to spend: the hourly cap must remain reachable, or it is
    // decoration and maxCostUsd is doing all the work.
    expect(CHANGE_REQUEST_BUDGET.maxTokensPerHour).toBeLessThan(
      ONE_ITERATION * CHANGE_REQUEST_BUDGET.maxIterations,
    );
  });

  it('keeps the cheaper brakes in front of it', () => {
    // The hourly window is the coarsest control and the one that produces a
    // wait rather than a stop. These are the ones that should bite first.
    expect(CHANGE_REQUEST_BUDGET.maxCostUsd).toBeGreaterThan(0);
    expect(CHANGE_REQUEST_BUDGET.maxTotalMinutes).toBeGreaterThan(0);
    expect(CHANGE_REQUEST_BUDGET.maxTokensPerIteration).toBeGreaterThan(0);
    expect(CHANGE_REQUEST_BUDGET.maxIdleIterations).toBeGreaterThan(0);
  });
});
