import { describe, it, expect, vi, beforeEach } from 'vitest';

// change-request.ts pulls the db client, the builder socket client and the
// GitHub client in at import time. Stubbed here; the db stub answers the
// dedup lookup (select … from … where … orderBy … limit) with `h.openRows`,
// and records an insert so a test can assert no second build was created.
const h = vi.hoisted(() => ({
  openRows: [] as unknown[],
  lookupThrows: false,
  inserted: 0,
  issues: 0,
}));

vi.mock('$lib/db', () => {
  const select: Record<string, unknown> = {};
  select.from = () => select;
  select.where = () => select;
  select.orderBy = () => select;
  select.limit = async () => {
    if (h.lookupThrows) throw new Error('db down');
    return h.openRows;
  };
  const insert = {
    values: () => insert,
    returning: async () => {
      h.inserted++;
      return [{ id: 'new-build' }];
    },
  };
  return { db: { select: () => select, insert: () => insert, update: () => ({ set: () => ({ where: async () => {} }) }) } };
});
vi.mock('./builder-client', () => ({ builderClient: { startBuild: async () => {} } }));
vi.mock('$lib/server/models/workload-settings', () => ({
  resolveBuilderModel: async () => ({ provider: 'openrouter', modelId: 'test/model' }),
}));
vi.mock('$lib/server/models/price-snapshot', () => ({ snapshotPrice: async () => null }));
vi.mock('$lib/github/issues', () => ({
  createIssue: async () => {
    h.issues++;
    return { number: 41, url: 'https://github.com/zerosumpain/SR-Main/issues/41' };
  },
  commentOnIssue: async () => {},
  githubConfigured: () => true,
  REPO_SLUG: 'zerosumpain/SR-Main',
}));

import {
  CHANGE_REQUEST_BUDGET,
  OPEN_PR_WINDOW_DAYS,
  createChangeRequest,
  matchOpenChangeRequest,
  type ChangeRequestRow,
} from './change-request';

beforeEach(() => {
  h.openRows = [];
  h.lookupThrows = false;
  h.inserted = 0;
  h.issues = 0;
});

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

describe('change-request dedup — one idea, one build', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');
  const cr = (over: Partial<ChangeRequestRow>): ChangeRequestRow => ({
    id: 'b1',
    title: 'Change request #12: Show train delays on the homepage',
    status: 'running',
    outcome: null,
    gitTargetConfig: { issueNumber: 12, requestTitle: 'Show train delays on the homepage' },
    createdAt: new Date(now - 3_600_000),
    ...over,
  });

  it('matches a live build for the same backlog slug, whatever its title', () => {
    const row = cr({ gitTargetConfig: { issueNumber: 12, requestTitle: 'Something else entirely', backlogSlug: 'rail' } });
    expect(matchOpenChangeRequest([row], { title: 'Unrelated words', backlogSlug: 'rail' }, now)?.id).toBe('b1');
  });

  it('matches a near-identical title from another asker', () => {
    expect(matchOpenChangeRequest([cr({})], { title: 'Show my train delays on the home page' }, now)?.id).toBe('b1');
  });

  it('falls back to the display title for builds that predate requestTitle', () => {
    const legacy = cr({ gitTargetConfig: { issueNumber: 12 } });
    expect(matchOpenChangeRequest([legacy], { title: 'Show train delays on the homepage' }, now)?.id).toBe('b1');
  });

  it('counts a finished build with an open PR only inside the window', () => {
    const recent = cr({ status: 'completed', outcome: 'pr_open', createdAt: new Date(now - (OPEN_PR_WINDOW_DAYS - 1) * 86_400_000) });
    const stale = cr({ status: 'completed', outcome: 'pr_open', createdAt: new Date(now - (OPEN_PR_WINDOW_DAYS + 1) * 86_400_000) });
    expect(matchOpenChangeRequest([recent], { title: 'Show train delays on the homepage' }, now)).not.toBeNull();
    expect(matchOpenChangeRequest([stale], { title: 'Show train delays on the homepage' }, now)).toBeNull();
  });

  it('never matches a failed or delivered build, or a different idea', () => {
    expect(matchOpenChangeRequest([cr({ status: 'failed' })], { title: 'Show train delays on the homepage' }, now)).toBeNull();
    expect(matchOpenChangeRequest([cr({ status: 'completed', outcome: 'delivered' })], { title: 'Show train delays on the homepage' }, now)).toBeNull();
    expect(matchOpenChangeRequest([cr({})], { title: 'A mortgage rate watch' }, now)).toBeNull();
  });

  it('returns the open change request instead of opening a second issue and build', async () => {
    h.openRows = [cr({ id: 'open-build', gitTargetConfig: { issueNumber: 12, backlogSlug: 'rail' } })];

    const res = await createChangeRequest({ title: 'A rail feed', request: 'do it', backlogSlug: 'rail' });

    expect(res).toEqual({
      buildId: 'open-build',
      issueNumber: 12,
      issueUrl: 'https://github.com/zerosumpain/SR-Main/issues/12',
      reused: true,
    });
    expect(h.issues).toBe(0);
    expect(h.inserted).toBe(0);
  });

  it('opens a new one when nothing live matches', async () => {
    const res = await createChangeRequest({ title: 'A rail feed', request: 'do it', backlogSlug: 'rail' });
    expect(res).toMatchObject({ buildId: 'new-build', issueNumber: 41 });
    expect(res.reused).toBeUndefined();
    expect(h.issues).toBe(1);
    expect(h.inserted).toBe(1);
  });

  it('degrades to opening one when the lookup itself fails — the ask is not lost', async () => {
    h.lookupThrows = true;
    const res = await createChangeRequest({ title: 'A rail feed', request: 'do it' });
    expect(res.buildId).toBe('new-build');
  });
});
