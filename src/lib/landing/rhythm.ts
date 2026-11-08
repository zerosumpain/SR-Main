// rhythm.ts — the calendars behind the landing sentence's footnotes and its
// ship-rhythm row: forty days of deploys, every release day since March laid
// out a month to a line, and today's thinks on the daydreamer's clock.
//
// Pure, like traces.ts: dates in, rows out, so the server and the browser lay
// out the same grid and the edge cases (a quiet today, a record that stops
// before today, a clock change) are unit tests rather than surprises.

import { HEALTH_TIMEZONE } from '$lib/constants/health-day';

export interface DayCount {
  /** YYYY-MM-DD, a London calendar day (the release record's localCadence). */
  date: string;
  count: number;
}

const DAY_MS = 86_400_000;
const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const msOf = (key: string) => Date.parse(`${key}T00:00:00Z`);

/**
 * The last `n` days of deploys, oldest first and TODAY last. The record's own
 * cadence stops at the last deploy, so a quiet today (or a quiet week) would
 * otherwise slide the window back and put an old day in today's place.
 */
export function shipDays(cadence: DayCount[], todayKey: string, n = 40): DayCount[] {
  const counts = new Map(cadence.map((d) => [d.date, d.count]));
  const end = msOf(todayKey);
  return Array.from({ length: n }, (_, i) => {
    const date = keyOf(end - (n - 1 - i) * DAY_MS);
    return { date, count: counts.get(date) ?? 0 };
  });
}

/** "Tue 7 Oct". */
export function dayName(key: string): string {
  return new Date(`${key}T12:00:00Z`)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(',', '');
}

/** What the ship row says about one day: "Tue 7 Oct · 3 deploys", "Wed 8 Oct · no deploys". */
export function dayLabel(d: DayCount): string {
  const n = d.count === 0 ? 'no deploys' : `${d.count} deploy${d.count === 1 ? '' : 's'}`;
  return `${dayName(d.date)} · ${n}`;
}

export interface ShipStats {
  total: number;
  /** The busiest day (the latest, on a tie), or null when nothing shipped. */
  busiest: DayCount | null;
  quiet: number;
}

export function shipStats(days: DayCount[]): ShipStats {
  let busiest: DayCount | null = null;
  for (const d of days) if (d.count > 0 && (!busiest || d.count >= busiest.count)) busiest = d;
  return { total: days.reduce((a, d) => a + d.count, 0), busiest, quiet: days.filter((d) => d.count === 0).length };
}

export interface CalendarMonth {
  /** YYYY-MM */
  key: string;
  /** "Mar" */
  label: string;
  /**
   * One slot per day of the month, index 0 = the 1st. A number is that day's
   * releases (0 = a quiet day on the record); null is a day outside the
   * record: before the first deploy, after today, or past the month's end.
   */
  days: Array<number | null>;
  total: number;
}

/**
 * Every day from the first deploy to today, a month to a row and a slot per
 * day, so the whole record fits a small block calendar.
 */
export function releaseCalendar(cadence: DayCount[], todayKey: string): CalendarMonth[] {
  if (!cadence.length) return [];
  const counts = new Map(cadence.map((d) => [d.date, d.count]));
  const first = msOf(cadence[0].date);
  const last = Math.max(msOf(todayKey), msOf(cadence[cadence.length - 1].date));
  const months: CalendarMonth[] = [];
  for (let t = first; t <= last; t += DAY_MS) {
    const key = keyOf(t);
    const m = key.slice(0, 7);
    let row = months.at(-1);
    if (!row || row.key !== m) {
      const label = new Date(t).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }).slice(0, 3);
      row = { key: m, label, days: new Array<number | null>(31).fill(null), total: 0 };
      months.push(row);
    }
    const c = counts.get(key) ?? 0;
    row.days[Number(key.slice(8)) - 1] = c;
    row.total += c;
  }
  return months;
}

/** Release months as a screen reader hears the calendar: "Mar: 23 releases, Apr: 81 releases". */
export function calendarSummary(months: CalendarMonth[]): string {
  return months.map((m) => `${m.label}: ${m.total} release${m.total === 1 ? '' : 's'}`).join(', ');
}

/** "07:45" for a quarter-hour bin, 0 = midnight. */
const binClock = (i: number) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`;

/**
 * The ruler of the day in words, for readers who cannot see it: the busiest
 * quarter-hour so far and when the last steps came in. Only what the picture
 * already shows; nothing after now.
 */
export function stepsSummary(s: { bins: number[]; total: number | null; nowBin: number } | null): string {
  if (!s || s.total == null) return 'No steps have come in today, so the ruler is empty.';
  let busiest = -1;
  let last = -1;
  s.bins.forEach((v, i) => {
    if (i > s.nowBin || v <= 0) return;
    if (busiest < 0 || v >= s.bins[busiest]) busiest = i;
    last = i;
  });
  if (busiest < 0) return 'No steps recorded yet today; the rest of the day is pending.';
  const v = s.bins[busiest];
  return (
    `Busiest quarter-hour so far from ${binClock(busiest)}, ${v.toLocaleString('en-GB')} step${v === 1 ? '' : 's'};` +
    ` the last steps came in during the quarter-hour from ${binClock(last)}, and the rest of the day is pending.`
  );
}

/* ----------------------------------------------------- the think schedule */

export type ThinkState = 'earlier' | 'next' | 'later';

export interface Think {
  /** "07:45", London time. */
  at: string;
  state: ThinkState;
}

/** London wall-clock fields for an instant. */
function london(ms: number) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: HEALTH_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ms);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24, minute: Number(get('minute')) };
}

/**
 * Today's thinks as the daydreamer's clock lays them out: one every `cadence`
 * minutes between the active hours, London time, each marked as gone by, next
 * or still to come.
 *
 * The clock is anchored to the live `nextRunAt` when there is one, so the
 * schedule lines up with what the loop will actually do; without it (the poll
 * not in, the loop off) it falls back to the cadence's own grid. "earlier"
 * means a slot that has passed, not a claim that a think ran in it.
 */
export function thinkSchedule(
  now: number,
  cadenceMinutes: number,
  hours: { start: number; end: number },
  nextRunAt: string | null = null,
): Think[] {
  const cad = Math.max(1, cadenceMinutes) * 60_000;
  const next = nextRunAt ? Date.parse(nextRunAt) : NaN;
  const anchor = Number.isFinite(next) ? next : Math.ceil(now / cad) * cad;
  const today = london(now).date;
  const out: Think[] = [];
  // Walk a day either side of the anchor; keep today's slots inside the hours.
  const from = anchor - Math.ceil((36 * 3_600_000) / cad) * cad;
  let marked = false;
  for (let t = from; t <= anchor + 36 * 3_600_000; t += cad) {
    const l = london(t);
    const h = l.hour + l.minute / 60;
    if (l.date !== today || h < hours.start || h >= hours.end) continue;
    // Within a minute of due still counts as next: the think is starting.
    let state: ThinkState = t < now - 60_000 ? 'earlier' : 'later';
    if (state === 'later' && !marked) {
      state = 'next';
      marked = true;
    }
    out.push({ at: `${String(l.hour).padStart(2, '0')}:${String(l.minute).padStart(2, '0')}`, state });
  }
  return out;
}
