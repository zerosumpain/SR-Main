import { describe, expect, it } from 'vitest';
import { calendarSummary, dayLabel, dayName, releaseCalendar, shipDays, shipStats, stepsSummary, thinkSchedule } from './rhythm';

describe('ship days', () => {
  const cadence = [
    { date: '2026-10-01', count: 3 },
    { date: '2026-10-02', count: 0 },
    { date: '2026-10-07', count: 5 },
  ];

  it('ends on today even when the record stopped days ago', () => {
    const days = shipDays(cadence, '2026-10-09', 10);
    expect(days).toHaveLength(10);
    expect(days[0].date).toBe('2026-09-30');
    expect(days.at(-1)).toEqual({ date: '2026-10-09', count: 0 });
    expect(days.find((d) => d.date === '2026-10-07')!.count).toBe(5);
    expect(days.find((d) => d.date === '2026-10-04')!.count).toBe(0);
  });

  it('defaults to forty days and crosses month ends', () => {
    const days = shipDays([], '2026-03-01');
    expect(days).toHaveLength(40);
    expect(days[38].date).toBe('2026-02-28');
  });

  it('announces a day as the row reads it', () => {
    expect(dayName('2026-10-07')).toBe('Wed 7 Oct');
    expect(dayLabel({ date: '2026-10-06', count: 3 })).toBe('Tue 6 Oct · 3 deploys');
    expect(dayLabel({ date: '2026-10-06', count: 1 })).toBe('Tue 6 Oct · 1 deploy');
    expect(dayLabel({ date: '2026-10-06', count: 0 })).toBe('Tue 6 Oct · no deploys');
  });

  it('sums the window, finds the busiest day and counts the quiet ones', () => {
    const days = shipDays(cadence, '2026-10-09', 10);
    expect(shipStats(days)).toEqual({ total: 8, busiest: { date: '2026-10-07', count: 5 }, quiet: 8 });
    expect(shipStats(shipDays([], '2026-10-09', 5))).toEqual({ total: 0, busiest: null, quiet: 5 });
  });
});

describe('release calendar', () => {
  it('lays every day from the first deploy to today out a month to a row', () => {
    const cal = releaseCalendar(
      [
        { date: '2026-03-20', count: 4 },
        { date: '2026-03-21', count: 0 },
        { date: '2026-04-02', count: 7 },
      ],
      '2026-05-03',
    );
    expect(cal.map((m) => m.label)).toEqual(['Mar', 'Apr', 'May']);
    // Before the first deploy is off the record (null); a quiet day on it is 0.
    expect(cal[0].days.slice(17, 22)).toEqual([null, null, 4, 0, 0]);
    expect(cal[0].total).toBe(4);
    // April has thirty days; the 31st slot is not a day.
    expect(cal[1].days[1]).toBe(7);
    expect(cal[1].days[29]).toBe(0);
    expect(cal[1].days[30]).toBeNull();
    // Nothing after today.
    expect(cal[2].days.slice(0, 4)).toEqual([0, 0, 0, null]);
  });

  it('is empty with no record', () => {
    expect(releaseCalendar([], '2026-10-09')).toEqual([]);
  });
});

describe('think schedule', () => {
  const HOURS = { start: 7, end: 23 };
  // 14:40 BST on 9 October 2026.
  const NOW = Date.parse('2026-10-09T13:40:00Z');

  it('anchors to the live next think and marks earlier, next and later', () => {
    const next = new Date(NOW + 20 * 60_000).toISOString(); // 15:00 BST
    const s = thinkSchedule(NOW, 45, HOURS, next);
    const at = s.map((t) => t.at);
    expect(at).toContain('15:00');
    expect(s.find((t) => t.state === 'next')!.at).toBe('15:00');
    expect(s.filter((t) => t.state === 'next')).toHaveLength(1);
    expect(at[0] >= '07:00').toBe(true);
    expect(at.at(-1)! < '23:00').toBe(true);
    // 45 minutes apart, all day.
    expect(at.slice(at.indexOf('15:00'), at.indexOf('15:00') + 3)).toEqual(['15:00', '15:45', '16:30']);
    expect(s.every((t) => (t.at < '15:00' ? t.state === 'earlier' : true))).toBe(true);
  });

  it('falls back to the cadence grid with no live time', () => {
    const s = thinkSchedule(NOW, 45, HOURS);
    expect(s.length).toBeGreaterThanOrEqual(21);
    expect(s.filter((t) => t.state === 'next')).toHaveLength(1);
  });

  it('is all to come before the hours open, and all gone by after they close', () => {
    const early = thinkSchedule(Date.parse('2026-10-09T04:00:00Z'), 45, HOURS); // 05:00 BST
    expect(early[0].state).toBe('next');
    expect(early.slice(1).every((t) => t.state === 'later')).toBe(true);
    const late = thinkSchedule(Date.parse('2026-10-09T22:30:00Z'), 45, HOURS); // 23:30 BST
    expect(late.every((t) => t.state === 'earlier')).toBe(true);
  });

  it('keeps London time across the clock change', () => {
    // 25 October 2026, the clocks go back at 02:00: the 07:00–23:00 window is still 16 hours.
    const s = thinkSchedule(Date.parse('2026-10-25T12:00:00Z'), 60, HOURS);
    expect(s.map((t) => t.at)).toEqual(Array.from({ length: 16 }, (_, i) => `${String(7 + i).padStart(2, '0')}:00`));
  });
});

describe('the footnote pictures in words', () => {
  it('reads the release calendar a month at a time', () => {
    const months = releaseCalendar([{ date: '2026-09-30', count: 1 }, { date: '2026-10-01', count: 4 }], '2026-10-02');
    expect(calendarSummary(months)).toBe('Sep: 1 release, Oct: 4 releases');
    expect(calendarSummary([])).toBe('');
  });

  it('reads the ruler of the day: busiest quarter-hour and the last steps, nothing after now', () => {
    const bins = new Array(96).fill(0);
    bins[32] = 520;
    bins[48] = 300;
    bins[57] = 12;
    bins[70] = 999; // the future: never read out
    expect(stepsSummary({ bins, total: 832, nowBin: 58 })).toBe(
      'Busiest quarter-hour so far from 08:00, 520 steps; the last steps came in during the quarter-hour from 14:15, and the rest of the day is pending.',
    );
    expect(stepsSummary({ bins: new Array(96).fill(0), total: 0, nowBin: 40 })).toMatch(/^No steps recorded yet today/);
    expect(stepsSummary({ bins: new Array(96).fill(0), total: null, nowBin: 40 })).toMatch(/^No steps have come in today/);
    expect(stepsSummary(null)).toMatch(/^No steps have come in today/);
  });
});
