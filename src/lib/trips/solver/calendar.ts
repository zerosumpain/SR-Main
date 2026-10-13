// src/lib/trips/solver/calendar.ts
//
// Calendar arithmetic on local `YYYY-MM-DD` dates and minute-of-day times.
// Pure integer maths (Howard Hinnant's civil-day algorithms), so a date's
// weekday never depends on the machine's time zone.

import type { LocalDate } from '../model';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

function parts(date: LocalDate): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Not a local date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Days since 1970-01-01 for a local calendar date. */
export function dayNumber(date: LocalDate): number {
  const [yy, m, d] = parts(date);
  const y = m <= 2 ? yy - 1 : yy;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The local date `n` days after 1970-01-01. */
export function fromDayNumber(n: number): LocalDate {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. 1970-01-01 was a Thursday. */
export function isoWeekday(date: LocalDate): IsoWeekday {
  const n = dayNumber(date);
  return (((((n + 3) % 7) + 7) % 7) + 1) as IsoWeekday;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromDayNumber(dayNumber(date) + days);
}

/** Every date from `start` to `end`, both included. Empty when end < start. */
export function datesBetween(start: LocalDate, end: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let n = dayNumber(start); n <= dayNumber(end); n++) out.push(fromDayNumber(n));
  return out;
}

/** "Tue 27 Oct". */
export function dayLabel(date: LocalDate): string {
  const [, m, d] = parts(date);
  return `${WEEKDAYS[isoWeekday(date) - 1]} ${d} ${MONTHS[m - 1]}`;
}

/** Minutes after midnight as "HH:MM" (wraps past midnight). */
export function fmtMin(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
