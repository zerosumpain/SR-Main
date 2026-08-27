import { describe, it, expect } from 'vitest';
import {
  dayStartUtc,
  daysBetween,
  fetchCalendarDays,
  isAllDay,
  nextDay,
  summariseChunk,
  type CalendarEventRow,
} from './calendar';

describe('dayStartUtc', () => {
  it('is 23:00 UTC the previous day under BST', () => {
    // 2026-08-26 is British Summer Time (UTC+1).
    expect(dayStartUtc('2026-08-26').toISOString()).toBe('2026-08-25T23:00:00.000Z');
  });

  it('is midnight UTC in winter', () => {
    expect(dayStartUtc('2026-01-15').toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });
});

describe('nextDay / daysBetween', () => {
  it('walks month boundaries', () => {
    expect(nextDay('2026-08-31')).toBe('2026-09-01');
  });
  it('is inclusive of both ends', () => {
    expect(daysBetween('2026-08-25', '2026-08-27')).toEqual(['2026-08-25', '2026-08-26', '2026-08-27']);
  });
});

describe('isAllDay', () => {
  it('accepts a date-only start', () => {
    expect(isAllDay({ start: '2026-08-26' })).toBe(true);
  });
  it('accepts a local-midnight whole-day span', () => {
    // Local midnight in BST is 23:00Z.
    expect(isAllDay({ start: '2026-08-25T23:00:00.000Z', end: '2026-08-26T23:00:00.000Z' })).toBe(true);
  });
  it('rejects a timed meeting', () => {
    expect(isAllDay({ start: '2026-08-26T09:00:00.000Z', end: '2026-08-26T10:00:00.000Z' })).toBe(false);
  });
});

describe('summariseChunk', () => {
  const days = ['2026-08-25', '2026-08-26', '2026-08-27'];

  it('gives a real zero to a day the diary answered about with nothing', () => {
    const out = summariseChunk([], days, false);
    expect(out.get('2026-08-26')).toEqual({ events: 0, busyMinutes: 0, partial: false });
  });

  it('counts a timed event on its start day and measures its minutes', () => {
    const events: CalendarEventRow[] = [
      { start: '2026-08-26T09:00:00+01:00', end: '2026-08-26T10:30:00+01:00' },
    ];
    const out = summariseChunk(events, days, false);
    expect(out.get('2026-08-26')).toEqual({ events: 1, busyMinutes: 90, partial: false });
    expect(out.get('2026-08-25')?.events).toBe(0);
  });

  it('merges overlapping meetings — two calls at 2pm are one busy hour', () => {
    const events: CalendarEventRow[] = [
      { start: '2026-08-26T14:00:00+01:00', end: '2026-08-26T15:00:00+01:00' },
      { start: '2026-08-26T14:30:00+01:00', end: '2026-08-26T15:00:00+01:00' },
    ];
    const out = summariseChunk(events, days, false);
    expect(out.get('2026-08-26')?.busyMinutes).toBe(60);
    expect(out.get('2026-08-26')?.events).toBe(2);
  });

  it('splits an event spanning local midnight across both days', () => {
    const events: CalendarEventRow[] = [
      { start: '2026-08-25T23:30:00+01:00', end: '2026-08-26T01:00:00+01:00' },
    ];
    const out = summariseChunk(events, days, false);
    expect(out.get('2026-08-25')?.busyMinutes).toBe(30);
    expect(out.get('2026-08-26')?.busyMinutes).toBe(60);
    // Counted once, on the day it started.
    expect(out.get('2026-08-25')?.events).toBe(1);
    expect(out.get('2026-08-26')?.events).toBe(0);
  });

  it('counts an all-day event on each covered day with no busy minutes', () => {
    const events: CalendarEventRow[] = [
      { start: '2026-08-25T23:00:00.000Z', end: '2026-08-27T23:00:00.000Z' },
    ];
    const out = summariseChunk(events, days, false);
    expect(out.get('2026-08-26')).toEqual({ events: 1, busyMinutes: 0, partial: false });
    expect(out.get('2026-08-27')?.events).toBe(1);
  });

  it('stamps every day partial when the chunk was partial', () => {
    const out = summariseChunk([], days, true);
    expect(out.get('2026-08-25')?.partial).toBe(true);
  });
});

describe('fetchCalendarDays', () => {
  it('leaves days from a failed chunk absent, not zero', async () => {
    const out = await fetchCalendarDays(
      '2026-08-20',
      '2026-08-27',
      async (from) => (from === '2026-08-20' ? null : { events: [], truncated: false, partial: false }),
      4,
    );
    // First 4-day chunk failed; second answered.
    expect(out.has('2026-08-21')).toBe(false);
    expect(out.get('2026-08-24')).toEqual({ events: 0, busyMinutes: 0, partial: false });
  });

  it('splits a truncated chunk and keeps the halves', async () => {
    const calls: string[] = [];
    const out = await fetchCalendarDays('2026-08-20', '2026-08-23', async (from, to) => {
      calls.push(`${from}..${to}`);
      // The whole 4-day chunk truncates; each 2-day half answers cleanly.
      return { events: [], truncated: from === '2026-08-20' && to === '2026-08-23', partial: false };
    }, 4);
    expect(calls).toEqual(['2026-08-20..2026-08-23', '2026-08-20..2026-08-21', '2026-08-22..2026-08-23']);
    expect(out.get('2026-08-22')?.partial).toBe(false);
    expect(out.size).toBe(4);
  });

  it('marks a single day that still truncates as partial rather than looping', async () => {
    const out = await fetchCalendarDays('2026-08-20', '2026-08-20', async () => ({
      events: [{ start: '2026-08-20T09:00:00+01:00', end: '2026-08-20T10:00:00+01:00' }],
      truncated: true,
      partial: false,
    }), 4);
    expect(out.get('2026-08-20')).toEqual({ events: 1, busyMinutes: 60, partial: true });
  });
});
