import { describe, expect, it, vi } from 'vitest';
import manifest from '$lib/native/app-manifest.json';
import type { Impact } from '$lib/daydream/impact';
import {
  TEN_THOUSAND,
  averageSleepHours,
  daysBefore,
  memoised,
  nativeCounts,
  projectApp,
  projectImpact,
  projectWeek,
  recoveryMix,
  round1,
  shiftDay,
  slotsPerDay,
  stepFigures,
  toCount,
  totalKm,
  within,
} from './showcase-data';
import { showcaseFixture } from './showcase.fixture';
import type { ShowcaseData } from './showcase';

const later = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe('within', () => {
  it('answers with the read when it is quick enough', async () => {
    await expect(within(later(5, 'read'), 200, 'fallback')).resolves.toBe('read');
  });
  it('answers with the fallback when the read is slow', async () => {
    await expect(within(later(200, 'read'), 5, 'fallback')).resolves.toBe('fallback');
  });
});

describe('memoised', () => {
  const opts = { name: 'test', ttlMs: 1000, budgetMs: 50, fallback: null as number | null };
  const at = (ms: number) => new Date(ms);

  it('reuses a good answer for the TTL, then reads again', async () => {
    const load = vi.fn(async () => 7);
    const read = memoised(load, opts);
    expect(await read(at(0))).toBe(7);
    expect(await read(at(999))).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
    await read(at(1000));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one read between concurrent callers', async () => {
    const load = vi.fn(() => later(10, 3));
    const read = memoised(load, opts);
    const [a, b] = await Promise.all([read(at(0)), read(at(0))]);
    expect([a, b]).toEqual([3, 3]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('answers a slow cold read with the fallback, and keeps the late answer for next time', async () => {
    const load = vi.fn(() => later(80, 9));
    const read = memoised(load, opts);
    expect(await read(at(0))).toBeNull();
    await later(100, null);
    expect(await read(at(10))).toBe(9);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('answers a failure with the last good value, logs one line, and waits before asking again', async () => {
    const log = vi.fn();
    let fail = false;
    const load = vi.fn(async () => {
      if (fail) throw new Error('relation does not exist');
      return 5;
    });
    const read = memoised(load, { ...opts, log, retryMs: 500 });
    expect(await read(at(0))).toBe(5);
    fail = true;
    expect(await read(at(1000))).toBe(5);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/showcase test unavailable: relation does not exist/);
    expect(await read(at(1200))).toBe(5);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('answers a cold failure with the fallback, never a zero', async () => {
    const read = memoised(async () => {
      throw new Error('down');
    }, { ...opts, log: () => {} });
    expect(await read(at(0))).toBeNull();
  });
});

describe('numbers', () => {
  it('rounds to one decimal and refuses non-numbers', () => {
    expect(round1(31.46)).toBe(31.5);
    expect(round1(NaN)).toBeNull();
    expect(round1(null)).toBeNull();
  });
  it('reads Postgres bigints that arrive as strings', () => {
    expect(toCount('1204')).toBe(1204);
    expect(toCount(null)).toBe(0);
    expect(toCount(-3)).toBe(0);
  });
});

describe('daydream', () => {
  it('counts the thinking slots in a waking day', () => {
    expect(slotsPerDay({ start: 7, end: 23 }, 45)).toBe(22);
    expect(slotsPerDay({ start: 7, end: 22 }, 60)).toBe(15);
    expect(slotsPerDay({ start: 7, end: 23 }, 0)).toBe(0);
  });

  it('turns the week aggregate into figures', () => {
    expect(projectWeek({ questions: 142, ms: '113400000', lookups: '1204', rejected: '11', drops: '7', areas: 6 })).toEqual({
      questions: 142,
      hours: 31.5,
      lookups: 1204,
      struckOut: 18,
      areasCovered: 6,
    });
  });

  it('reads a week with no thinks as real zeros', () => {
    expect(projectWeek(undefined)).toEqual({ questions: 0, hours: 0, lookups: 0, struckOut: 0, areasCovered: 0 });
  });

  it('keeps only the numbers from impact', () => {
    const stats = { noticed: 58, rated: 41, useful: 30, hitRate: 0.73, decidedShare: 0.7, medianHoursToDecide: 3 };
    const impact: Impact = {
      windowDays: 28,
      loopStart: '2026-09-25',
      current: stats,
      previous: { ...stats, hitRate: 0.64 },
      weeks: [{ start: '2026-10-05', noticed: 9, useful: 4, notUseful: 2, undecided: 3, engine: 'loop' }],
      byArea: [{ key: 'health', label: 'Health', noticed: 3, rated: 2, useful: 1 }],
      byKind: [{ key: 'suggest', label: 'Suggest', noticed: 3, rated: 2, useful: 1 }],
      funnel: { spotted: 58, decided: 41, useful: 30, actedOn: 4, result: 2 },
      checks: { awaiting: 1, running: 0, completed: 2 },
      builds: { proposed: 5, accepted: 7, shipped: 3 },
    };
    const out = projectImpact(impact);
    expect(out).toEqual({
      hitRate: 0.73,
      previousHitRate: 0.64,
      rated: 41,
      noticed: 58,
      shipped: 3,
      accepted: 7,
      weeks: [{ start: '2026-10-05', useful: 4, notUseful: 2, undecided: 3 }],
    });
    expect(JSON.stringify(out)).not.toMatch(/Health|Suggest|medianHours/);
  });
});

describe('London days', () => {
  it('shifts calendar days across a clock change and a year end', () => {
    expect(shiftDay('2026-10-26', -1)).toBe('2026-10-25');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('lists the complete days before today, oldest first', () => {
    expect(daysBefore('2026-10-10', 3)).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']);
  });
});

describe('stepFigures', () => {
  const today = '2026-10-10';

  it('takes thirty complete days, never today', () => {
    const days = Array.from({ length: 40 }, (_, i) => ({ date: shiftDay(today, i - 39), steps: 5000 + i }));
    const f = stepFigures(days, today);
    expect(f.steps30).toHaveLength(30);
    // 2026-09-10 is i = 9 and yesterday is i = 38; today (i = 39) is left out.
    expect(f.steps30![0]).toBe(5009);
    expect(f.steps30!.at(-1)).toBe(5038);
  });

  it('ends the window on the latest day with readings, so a phone that has not synced leaves no gap', () => {
    const days = Array.from({ length: 40 }, (_, i) => ({ date: shiftDay(today, i - 43), steps: 6000 + i }));
    const f = stepFigures(days, today);
    expect(f.steps30).toHaveLength(30);
    expect(f.steps30!.at(-1)).toBe(6039);
    expect(f.steps30!.every((v) => v != null)).toBe(true);
    // Nothing in the payload says which day that was.
    expect(JSON.stringify(f.steps30)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('counts the year from 1 January with today, and the 10k days and best day without it', () => {
    const f = stepFigures(
      [
        { date: '2025-12-31', steps: 30_000 },
        { date: '2026-01-01', steps: TEN_THOUSAND },
        { date: '2026-06-01', steps: 22_000 },
        { date: '2026-10-09', steps: 9_999 },
        { date: today, steps: 40_000 },
      ],
      today,
    );
    expect(f.stepsYear).toBe(TEN_THOUSAND + 22_000 + 9_999 + 40_000);
    expect(f.daysOver10k).toBe(2);
    expect(f.bestDay).toEqual({ date: '2026-06-01', steps: 22_000 });
  });

  it('marks a day with no readings null rather than drawing it as zero', () => {
    const f = stepFigures([{ date: '2026-10-06', steps: 5000 }, { date: '2026-10-08', steps: 6000 }], today);
    expect(f.steps30).toHaveLength(30);
    expect(f.steps30!.slice(-3)).toEqual([5000, null, 6000]);
    expect(f.steps30!.filter((v) => v != null)).toHaveLength(2);
  });

  it('answers null, not zero, with nothing on record', () => {
    expect(stepFigures([], today)).toEqual({ steps30: null, stepsYear: null, daysOver10k: null, bestDay: null });
  });

  it('reaches back into last year for thirty days in January', () => {
    const f = stepFigures([{ date: '2025-12-20', steps: 8000 }], '2026-01-05');
    expect(f.steps30!.at(-1)).toBe(8000);
    expect(f.stepsYear).toBeNull();
  });
});

describe('health aggregates', () => {
  it('adds distance across stored units and ignores unknown ones', () => {
    expect(totalKm([{ units: 'km', total: 1000.25 }, { units: 'm', total: 500 }, { units: 'mi', total: 1 }, { units: 'ft', total: 9 }])).toBe(1002.4);
    expect(totalKm([])).toBeNull();
  });

  it('bands recovery the way WHOOP does', () => {
    expect(recoveryMix([90, 67, 66, 34, 33, 0])).toEqual({ high: 2, mid: 2, low: 2 });
    expect(recoveryMix([])).toBeNull();
  });

  it('averages hours asleep, in bed less awake', () => {
    const h = 3_600_000;
    expect(averageSleepHours([{ inBed: 8 * h, awake: h }, { inBed: 7.5 * h, awake: 0.3 * h }])).toBe(7.1);
    expect(averageSleepHours([])).toBeNull();
  });
});

describe('the app', () => {
  const routes = [
    { kind: 'api', path: '/api/native/health/summary' },
    { kind: 'api', path: '/api/native/health/hub' },
    { kind: 'api', path: '/api/native/pair' },
    { kind: 'page', path: '/api/native/not-an-api' },
    { kind: 'api', path: '/api/vitals/state' },
  ];

  it('counts native endpoints and the areas they cover', () => {
    expect(nativeCounts(routes)).toEqual({ endpoints: 3, areas: 2 });
  });

  it('reads its facts from the manifest, names only', () => {
    const app = projectApp(manifest, routes, { pairCodeMs: 10 * 60_000, deviceTokenMs: 90 * 86_400_000 });
    expect(app.targets).toBe(manifest.targets.length);
    expect(app.tabNames).toEqual(manifest.tabs);
    expect(app.games).toEqual(manifest.games.map((g) => g.title));
    expect(app.complications.map((c) => c.name)).toContain('Readiness');
    expect(app.pairCodeMinutes).toBe(10);
    expect(app.deviceTokenDays).toBe(90);
    expect(JSON.stringify(app)).not.toMatch(/description|Complication"|Intent"|@|https?:/);
  });
});

// ── The fixture obeys the contract and the privacy rules ────────────────────

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const BAND = new Set(['low', 'mid', 'high']);

/** Every string in a value, with the path that leads to it. */
function strings(v: unknown, path: string[] = []): Array<{ path: string; value: string }> {
  if (typeof v === 'string') return [{ path: path.join('.'), value: v }];
  if (Array.isArray(v)) return v.flatMap((x) => strings(x, [...path, '*']));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => strings(x, [...path, k]));
  return [];
}

describe('the preview fixture', () => {
  const today = '2026-10-10';
  const f = showcaseFixture(today);
  const app = projectApp(manifest, [], { pairCodeMs: 1, deviceTokenMs: 1 });
  const rules = {
    cadenceMinutes: 45,
    activeHours: { start: 7, end: 23 },
    slotsPerDay: 21,
    areas: 7,
    maxLookups: 12,
    maxNotes: 2,
    dailyRaiseCap: 4,
    windowDays: 28,
    loopStart: '2026-09-25',
  };
  // Typed: the fixture must satisfy the contract as the server returns it.
  const data: ShowcaseData = { daydream: { ...f.daydream, rules }, health: f.health, app, fixture: true };

  it('has thirty complete days, every one with readings', () => {
    expect(data.health.steps30).toHaveLength(30);
    expect(data.health.steps30!.every((d) => d != null && d >= 4000 && d <= 16_000)).toBe(true);
  });

  it('has twelve weeks of verdicts, oldest first', () => {
    const weeks = data.daydream.impact!.weeks;
    expect(weeks).toHaveLength(12);
    expect(weeks.map((w) => w.start)).toEqual([...weeks.map((w) => w.start)].sort());
  });

  it('carries no string but app names, dates and bands', () => {
    const appNames = new Set([
      ...app.tabNames,
      ...app.widgets.flatMap((w) => [w.name, w.surface]),
      ...app.complications.map((c) => c.name),
      ...app.intents.map((i) => i.title),
      ...app.games,
    ]);
    for (const { path, value } of strings(data)) {
      if (path.startsWith('app.')) expect(appNames.has(value), path).toBe(true);
      else if (path === 'health.bands.sleep' || path === 'health.bands.recovery') expect(BAND.has(value), path).toBe(true);
      else expect(value, path).toMatch(DAY);
    }
  });

  it('never carries a bpm, a resting heart rate, a weight or a clock time', () => {
    expect(JSON.stringify(data)).not.toMatch(/bpm|rhr|resting|hrv|weight|vo2|T\d{2}:\d{2}/i);
  });
});
