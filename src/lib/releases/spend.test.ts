import { describe, it, expect } from 'vitest';
import {
  buildSpendBand,
  siteAreaOf,
  touchedAreaOf,
  areaLabel,
  isoWeek,
  type SpendReleaseRow,
  type SpendSessionRow,
} from './spend';

function session(over: Partial<SpendSessionRow>): SpendSessionRow {
  return {
    id: 's',
    title: 'A session',
    project: 'strange-rambling-svelte',
    startedAt: '2026-09-01T10:00:00Z',
    costUsd: 10,
    costKnown: true,
    prs: [],
    touched: [],
    tokens: {},
    breakdown: [],
    stages: [],
    messageCount: 20,
    ...over,
  };
}

function release(over: Partial<SpendReleaseRow>): SpendReleaseRow {
  return { id: 1, deployedAt: '2026-09-02T10:00:00Z', prs: [], files: [], items: [], ...over };
}

describe('feature areas', () => {
  it('folds the many homes of one feature into one area', () => {
    expect(siteAreaOf('src/routes/releases/+page.svelte')).toBe('releases');
    expect(siteAreaOf('src/routes/api/releases/ingest/+server.ts')).toBe('releases');
    expect(siteAreaOf('src/lib/components/releases/hub/VersionLog.svelte')).toBe('releases');
    expect(siteAreaOf('src/lib/releases/console.ts')).toBe('releases');
    expect(siteAreaOf('scripts/claude-changelog/ingest.mjs')).toBe('releases');
    expect(siteAreaOf('tests/lib/releases/x.test.ts')).toBe('releases');
  });

  it('splits route families into their children', () => {
    expect(siteAreaOf('src/routes/projects/engine-room/+page.svelte')).toBe('projects/engine-room');
    expect(siteAreaOf('src/routes/projects/+page.svelte')).toBe('projects');
    expect(siteAreaOf('src/routes/projects/[slug]/+page.svelte')).toBe('projects');
    expect(areaLabel('projects/engine-room')).toBe('/projects/engine-room');
  });

  it('strips route groups and treats loose library files as core', () => {
    expect(siteAreaOf('src/routes/(app)/health/+page.svelte')).toBe('health');
    expect(siteAreaOf('src/lib/auth.ts')).toBe('core');
    expect(siteAreaOf('docs/README.md')).toBe('docs');
  });

  it('reads a touched path relative to its checkout, and other repositories whole', () => {
    expect(touchedAreaOf('sr-main-x-20261004/src/lib/releases/spend.ts', 'strange-rambling-svelte')).toBe('releases');
    expect(touchedAreaOf('strange_rambling_svelte/.worktrees/w/src/routes/health/a.ts', 'strange-rambling-svelte')).toBe('health');
    expect(touchedAreaOf('sr-health-x/src/a.ts', 'sr-health')).toBe('repo:sr-health');
    expect(areaLabel('repo:sr-health')).toBe('SR-Health');
  });
});

describe('isoWeek', () => {
  it('uses the Thursday rule across a year boundary', () => {
    expect(isoWeek(new Date('2026-01-01T12:00:00Z'))).toEqual({ week: '2026-W01', start: '2025-12-29' });
    expect(isoWeek(new Date('2026-10-04T12:00:00Z'))).toEqual({ week: '2026-W40', start: '2026-09-28' });
  });
});

describe('buildSpendBand', () => {
  const releases = [
    release({
      id: 1,
      prs: [101],
      items: ['Session timeline'],
      files: [
        { path: 'src/routes/releases/+page.svelte', insertions: 75, deletions: 0 },
        { path: 'src/lib/health/a.ts', insertions: 25, deletions: 0 },
      ],
    }),
    // A release carrying two PRs splits its churn between them.
    release({ id: 2, prs: [102, 999], files: [{ path: 'src/lib/releases/x.ts', insertions: 100, deletions: 0 }] }),
  ];

  it('credits a PR-linked session to the areas its releases changed, by churn', () => {
    const band = buildSpendBand([session({ id: 'a', costUsd: 100, prs: [101] })], releases);
    const by = Object.fromEntries(band.areas.map((a) => [a.key, a.costUsd]));
    expect(by.releases).toBeCloseTo(75);
    expect(by.health).toBeCloseTo(25);
    expect(band.sessions[0].basis).toBe('pull-request');
    expect(band.sessions[0].items).toEqual(['Session timeline']);
    expect(band.totals.linkedUsd).toBe(100);
  });

  it('adds a feature up across sessions, cumulatively by date', () => {
    const band = buildSpendBand(
      [
        session({ id: 'a', costUsd: 40, prs: [102], startedAt: '2026-09-01T10:00:00Z' }),
        session({ id: 'b', costUsd: 60, touched: [{ path: 'wt/src/lib/releases/y.ts', count: 3 }], startedAt: '2026-09-05T10:00:00Z' }),
      ],
      releases,
    );
    const area = band.areas.find((a) => a.key === 'releases')!;
    expect(area.costUsd).toBeCloseTo(100);
    expect(area.sessions).toBe(2);
    expect(area.path).toEqual([['2026-09-01', 40], ['2026-09-05', 100]]);
    expect(area.prs).toBe(1);
    expect(area.linkedShare).toBeCloseTo(0.4);
  });

  it('keeps a session with no trail visible under its project', () => {
    const band = buildSpendBand([session({ id: 'c', project: 'porkserv', costUsd: 5 })], []);
    expect(band.areas[0].key).toBe('none:porkserv');
    expect(band.areas[0].label).toBe('porkserv · no code trail');
    expect(band.totals.unlinkedUsd).toBe(5);
  });

  it('respects the date window and fills empty weeks', () => {
    const band = buildSpendBand(
      [
        session({ id: 'a', startedAt: '2026-09-01T10:00:00Z' }),
        session({ id: 'b', startedAt: '2026-09-22T10:00:00Z' }),
        session({ id: 'c', startedAt: '2026-10-02T10:00:00Z' }),
      ],
      [],
      { from: '2026-09-01', to: '2026-09-30' },
    );
    expect(band.totals.sessions).toBe(2);
    expect(band.weeks.map((w) => w.week)).toEqual(['2026-W36', '2026-W37', '2026-W38', '2026-W39']);
    expect(band.weeks.at(-1)!.cumulative).toBe(20);
  });

  it('measures subagents only where the parser recorded them', () => {
    const band = buildSpendBand(
      [
        session({ id: 'old', breakdown: [{ model: 'claude-opus-4-8', costUsd: 8 }] }),
        session({
          id: 'new',
          breakdown: [
            { model: 'claude-opus-5-5', source: 'main', costUsd: 6 },
            { model: 'claude-opus-5-5', source: 'subagent', costUsd: 4 },
          ],
        }),
      ],
      [],
    );
    expect(band.totals.subagentUsd).toBe(4);
    expect(band.totals.subagentMeasuredSessions).toBe(1);
    expect(band.byModel.map((m) => m.key)).toEqual(['claude-opus-5-5', 'claude-opus-4-8']);
  });

  it('computes rework from the fixes stage and writes insights from the numbers', () => {
    const band = buildSpendBand(
      [session({ id: 'a', costUsd: 100, prs: [101], stages: [{ stage: 'result', costUsd: 80 }, { stage: 'fixes', costUsd: 20 }] })],
      releases,
    );
    expect(band.totals.reworkShare).toBeCloseTo(0.2);
    expect(band.insights.some((i) => i.includes('Shipped (/releases)'))).toBe(true);
    expect(band.insights.some((i) => i.includes('20% of session cost went on follow-up fixes'))).toBe(true);
  });

  it('keeps sessions parsed before PR extraction out of the shipped shares', () => {
    const band = buildSpendBand(
      [
        session({ id: 'old', costUsd: 70, schemaVersion: 3, startedAt: '2026-07-01T10:00:00Z' }),
        session({ id: 'shipped', costUsd: 20, prs: [101], schemaVersion: 5, startedAt: '2026-09-01T10:00:00Z' }),
        session({ id: 'unshipped', costUsd: 10, schemaVersion: 5, startedAt: '2026-09-02T10:00:00Z' }),
      ],
      releases,
    );
    expect(band.totals.unrecordedUsd).toBe(70);
    expect(band.totals.unlinkedUsd).toBe(10);
    expect(band.totals.linkedUsd).toBe(20);
    expect(band.weeks[0].unrecorded).toBe(70);
    expect(band.weeks[0].unlinked).toBe(0);
    expect(band.sessions.find((x) => x.id === 'old')!.prRecorded).toBe(false);
    // 10 of the 30 recorded dollars is a third — under the 20% bar it would be, at 10 of 100.
    expect(band.insights.some((i) => i.startsWith('33% of spend with a PR record'))).toBe(true);
    expect(band.insights.some((i) => i.includes('$70.00 comes from sessions parsed before PR numbers'))).toBe(true);
  });

  it('names the same top feature, at the same total, as the ledger group', () => {
    const band = buildSpendBand(
      [
        session({ id: 'a', costUsd: 30, touched: [{ path: 'wt/src/routes/jkai/+page.svelte', count: 1 }] }),
        session({ id: 'b', costUsd: 25, touched: [{ path: 'wt/src/routes/jkai/intel/x/+page.svelte', count: 1 }] }),
        session({ id: 'c', costUsd: 40, touched: [{ path: 'wt/src/routes/health/+page.svelte', count: 1 }] }),
      ],
      [],
    );
    // /health is the biggest single area, but the /jkai family is bigger.
    expect(band.areas[0].key).toBe('health');
    expect(band.groups[0]).toMatchObject({ key: 'jkai', costUsd: 55, sessions: 2 });
    expect(band.insights[0]).toContain('/jkai is the most expensive feature area: $55.00 across 2 sessions');
  });
});
