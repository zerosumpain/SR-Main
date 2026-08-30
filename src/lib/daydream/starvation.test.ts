import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  metricRows: [] as Array<{ metric: string; proposals: number; best_pairs: number }>,
  sourceRows: [] as Array<{ source: string; signals: number }>,
  throwOnExecute: false,
}));

vi.mock('$lib/db', () => ({
  db: {
    execute: async () => {
      if (h.throwOnExecute) throw new Error('database is unhappy');
      // The SQL applies the filters; the mock returns what that query WOULD
      // return, so the test pins the caller's contract rather than re-deriving
      // the predicate in JavaScript and testing itself.
      return h.metricRows;
    },
    select: () => ({
      from: () => ({
        where: () => ({ groupBy: async () => h.sourceRows }),
      }),
    }),
  },
}));
vi.mock('$lib/db/schema', () => ({
  daydreamHypotheses: { metricA: 'metric_a', metricB: 'metric_b', verdict: 'verdict', pairs: 'pairs' },
  daydreamSignals: { source: 'source', status: 'status', observedDays: 'observed_days', firstSeenAt: 'first_seen_at' },
}));
vi.mock('drizzle-orm', () => ({
  sql: Object.assign((s: unknown, ...v: unknown[]) => ({ s, v }), { raw: () => 'sql' }),
}));

import {
  collectStarvation,
  metricIdea,
  starvedMetrics,
  silentSources,
  MIN_PROPOSALS,
  MAX_IDEAS,
} from './starvation';

beforeEach(() => {
  h.metricRows = [];
  h.sourceRows = [];
  h.throwOnExecute = false;
});

describe('starvedMetrics', () => {
  it('reads the production shape', async () => {
    h.metricRows = [
      { metric: 'sleepPerformance', proposals: 9, best_pairs: 0 },
      { metric: 'recoveryScore', proposals: 8, best_pairs: 0 },
    ];
    expect(await starvedMetrics()).toEqual([
      { metric: 'sleepPerformance', proposals: 9, bestPairs: 0 },
      { metric: 'recoveryScore', proposals: 8, bestPairs: 0 },
    ]);
  });

  it('returns nothing rather than throwing when the query fails', async () => {
    h.throwOnExecute = true;
    expect(await starvedMetrics()).toEqual([]);
  });
});

describe('the idea a starved metric produces', () => {
  it('says the data is absent, not merely thin', async () => {
    // The distinction is the whole point: zero pairs is "nothing writes this",
    // which a tool can fix. Too-few pairs is "wait longer", which it cannot.
    const idea = metricIdea({ metric: 'sleepPerformance', proposals: 9, bestPairs: 0 });
    expect(idea.detail).toMatch(/ZERO overlapping days/);
    expect(idea.detail).toMatch(/not too few, none at all/);
    expect(idea.title).toBe('A source for sleepPerformance');
  });

  it('asks for a tool the daily sweep can actually sample', async () => {
    // M4 samples only tools that declare no required arguments, so an idea that
    // does not say so produces a tool the loop cannot close on.
    const idea = metricIdea({ metric: 'strain', proposals: 5, bestPairs: 0 });
    expect(idea.detail).toMatch(/no required arguments/);
    expect(idea.detail).toMatch(/plain number/);
    expect(idea.kind).toBe('tool');
  });

  it('outranks a question-mined idea', () => {
    // Question-mined ideas are queued at priority 2. This one has a caller
    // waiting, so it must not sort below them.
    expect(metricIdea({ metric: 'x', proposals: 2, bestPairs: 0 }).priority).toBeLessThanOrEqual(2);
  });

  it('carries the measurement behind it', () => {
    expect(metricIdea({ metric: 'x', proposals: 7, bestPairs: 0 }).evidence).toBe(
      '7 underpowered hypotheses, best pairs 0',
    );
  });
});

describe('silentSources', () => {
  it('reports a source that registered signals and never recorded one', async () => {
    h.sourceRows = [{ source: 'tool', signals: 12 }];
    expect(await silentSources()).toEqual([{ source: 'tool', signals: 12 }]);
  });

  it('survives a failing query', async () => {
    h.sourceRows = [];
    expect(await silentSources()).toEqual([]);
  });
});

describe('collectStarvation', () => {
  it('puts a broken source ahead of a missing metric', async () => {
    // A source that registered and never recorded is a fault; a metric with no
    // source is merely absent. The fault is the better use of a build slot.
    h.sourceRows = [{ source: 'tool', signals: 3 }];
    h.metricRows = [{ metric: 'sleepPerformance', proposals: 9, best_pairs: 0 }];
    const ideas = await collectStarvation();
    expect(ideas[0].title).toMatch(/records nothing/);
    expect(ideas[1].title).toMatch(/sleepPerformance/);
  });

  it('caps what one starving domain can queue', async () => {
    h.metricRows = Array.from({ length: 20 }, (_, n) => ({
      metric: `m${n}`,
      proposals: 5,
      best_pairs: 0,
    }));
    expect(await collectStarvation()).toHaveLength(MAX_IDEAS);
  });

  it('is empty when nothing is starving', async () => {
    expect(await collectStarvation()).toEqual([]);
  });

  it('needs a metric asked about more than once', () => {
    // Once is an accident of the proposer's vocabulary; twice is an appetite.
    expect(MIN_PROPOSALS).toBeGreaterThanOrEqual(2);
  });
});
