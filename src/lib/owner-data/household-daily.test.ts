import { describe, expect, it } from 'vitest';
import { rankDaily, renderDaily, statsOf, type PersonDays } from './household-daily';

const DATES = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'];
const series = (...v: Array<number | null>) => Object.fromEntries(DATES.map((d, i) => [d, v[i] ?? null]));

describe('household health day by day', () => {
  it('averages only the days with a reading — a missing day is not zero', () => {
    const s = statsOf(series(10_000, null, 8_000, null, 12_000, null), DATES)!;
    expect(s).toMatchObject({ n: 3, mean: 10_000, median: 10_000, total: 30_000, max: { value: 12_000, date: '2026-10-30' }, min: { value: 8_000, date: '2026-10-28' } });
    expect(statsOf(series(), DATES)).toBeNull();
  });

  it('answers "who has the most average steps over the last 6 days" with the sums done', () => {
    const people: PersonDays[] = [
      { subject: 'alex', name: 'Alex', values: series(9_000, 9_000, 9_000, 9_000, 9_000, 9_000) },
      { subject: 'sam', name: 'Sam', values: series(14_000, 4_000, 11_000, 12_000, 10_000, 13_000) },
      { subject: 'robin', name: 'Robin', values: null, missing: 'no app account' },
    ];
    const { text, rows } = renderDaily({ metric: 'steps', dates: DATES, people, today: { date: '2026-11-01', asOf: '10:00', values: { alex: 2_000, sam: 500 } } });
    expect(rows.map((r) => [r.rank, r.name, r.mean])).toEqual([[1, 'Sam', 10_666.666666666666], [2, 'Alex', 9_000]]);
    expect(text).toContain('1. Sam: mean 10,667 steps a day over 6 of 6 days; total 64,000');
    expect(text).toContain('Sam leads Alex by 1,667 steps (19%)');
    expect(text).toContain('Mon 26 Oct: 9,000 | 14,000');
    expect(text).toContain('Today so far (Sun 1 Nov, to 10:00; a part day, not in the figures above): Alex 2,000; Sam 500.');
    expect(text).toContain('Not readable: Robin (no app account).');
  });

  it('ranks workouts by total and resting heart rate lowest first, and shares a rank on a tie', () => {
    const w = rankDaily('workouts', [
      { subject: 'a', name: 'A', values: series(30, 0, 0, 0, 0, 0), sessions: 1 },
      { subject: 'b', name: 'B', values: series(10, 10, 10, 0, 0, 0), sessions: 3 },
    ], DATES);
    expect(w.map((r) => [r.rank, r.name, r.total])).toEqual([[1, 'A', 30], [1, 'B', 30]]);
    const hr = rankDaily('resting_hr', [
      { subject: 'a', name: 'A', values: series(60, 62) },
      { subject: 'b', name: 'B', values: series(52, 54) },
    ], DATES);
    expect(hr.map((r) => r.name)).toEqual(['B', 'A']);
  });
});

describe('the window', () => {
  it('ends yesterday by default, today on request, and never past today', async () => {
    const { windowDates } = await import('./household-daily.server');
    const now = new Date('2026-11-01T21:00:00Z');
    expect(windowDates(3, now)).toEqual(['2026-10-29', '2026-10-30', '2026-10-31']);
    expect(windowDates(2, now, { includeToday: true })).toEqual(['2026-10-31', '2026-11-01']);
    expect(windowDates(2, now, { to: '2026-10-25' })).toEqual(['2026-10-24', '2026-10-25']);
    expect(windowDates(1, now, { to: '2026-12-01' })).toEqual(['2026-10-31']);
  });
});
