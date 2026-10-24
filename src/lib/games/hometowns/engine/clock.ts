// The county clock (spec §2, A21, A22). Wall time enters the engine only as
// `now` arguments; this file turns it into grid ticks and Regional Day
// instants. Europe/London local time is computed here by integer calendar
// arithmetic (UK summer time runs from 01:00 UTC on the last Sunday of March
// to 01:00 UTC on the last Sunday of October), because Date and Intl are
// banned in the engine: their time-zone data differs between platforms.

import type { CountyState, TownState } from './types';

export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;
export const TICKS_PER_MONTH = 4;
export const TICKS_PER_YEAR = 48;

// ---- Civil calendar (proleptic Gregorian, days since 1970-01-01) -----------------------

/** [year, month 1–12, day 1–31] of a day number. */
export function civilFromDays(z: number): [number, number, number] {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

export function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday). */
export function weekday(days: number): number {
  return (((days + 4) % 7) + 7) % 7;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function lastSunday(y: number, m: number): number {
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const last = daysFromCivil(y, m, m === 2 && leap ? 29 : MONTH_DAYS[m - 1]);
  return last - weekday(last);
}

/** Europe/London's offset from UTC at a UTC instant: 1 h in British Summer Time, else 0. */
export function londonOffsetMs(utc: number): number {
  const [y] = civilFromDays(Math.floor(utc / MS_DAY));
  const start = lastSunday(y, 3) * MS_DAY + MS_HOUR;
  const end = lastSunday(y, 10) * MS_DAY + MS_HOUR;
  return utc >= start && utc < end ? MS_HOUR : 0;
}

/** The London local calendar day number of a UTC instant. */
export function londonDay(utc: number): number {
  return Math.floor((utc + londonOffsetMs(utc)) / MS_DAY);
}

/** The real calendar month 0–11 in London (tourism seasonality, §5.10). */
export function calendarMonth(utc: number): number {
  return civilFromDays(londonDay(utc))[1] - 1;
}

/**
 * The UTC instant of `hour`:00 London time on local day `day`. Correct for
 * every hour except the one-hour gaps at 01:00–02:00 on the two change-over
 * Sundays, which a Regional Day hour never uses (the default is 18).
 */
export function londonInstant(day: number, hour: number): number {
  const local = day * MS_DAY + hour * MS_HOUR;
  return local - londonOffsetMs(local - MS_HOUR);
}

// ---- The grid -----------------------------------------------------------------------------

/** Completed grid ticks at `now` (a tick runs once its grid end time has passed). */
export function gridTickAt(c: CountyState, now: number): number {
  const g = Math.floor((now - c.epoch - c.pausedMs) / c.tickMs);
  return g > 0 ? g : 0;
}

/** The instant grid tick `g` ends (= when `g + 1` ticks are complete). */
export function gridEndAt(c: CountyState, g: number): number {
  return c.epoch + c.pausedMs + (g + 1) * c.tickMs;
}

/** The first grid boundary at or after `at`. */
export function ceilToGrid(c: CountyState, at: number): number {
  const k = Math.ceil((at - c.epoch - c.pausedMs) / c.tickMs);
  return c.epoch + c.pausedMs + k * c.tickMs;
}

/** A21: the instant the county falls asleep with no hello, on the grid. */
export function napStartAt(c: CountyState, napAfterMs: number): number {
  return ceilToGrid(c, c.lastHelloAt + napAfterMs);
}

/** `now` capped at a pause, a nap, or the nap that is due (catch-up never runs past them). */
export function effectiveNow(c: CountyState, now: number, napAfterMs: number): number {
  let n = now;
  if (c.pause && c.pause.since < n) n = c.pause.since;
  if (c.nap && c.nap.since < n) n = c.nap.since;
  const nap = napStartAt(c, napAfterMs);
  if (nap < n) n = nap;
  return n;
}

/** Puts a napping county to sleep at the deterministic instant (A21). Returns whether it changed. */
export function napCheck(c: CountyState, now: number, napAfterMs: number): boolean {
  if (c.nap || c.pause) return false;
  const at = napStartAt(c, napAfterMs);
  if (now < at) return false;
  c.nap = { since: at };
  return true;
}

/**
 * Ends a pause or nap: the grid shifts by whole ticks so it stays aligned
 * (§2.2). Rounding down means the grid resumes exactly where it stopped and
 * the next tick completes within one tick of the wake-up.
 */
function shiftGrid(c: CountyState, since: number, now: number): number {
  const ticks = Math.floor(Math.max(0, now - since) / c.tickMs);
  const ms = ticks * c.tickMs;
  c.pausedMs += ms;
  c.resumedAt = now;
  return ms;
}

/** Whether the county is asleep at `now`: napping, or past the instant its nap is due (A21). */
export function asleep(c: CountyState, now: number, napAfterMs: number): boolean {
  return c.nap !== null || (!c.pause && napStartAt(c, napAfterMs) <= now);
}

/**
 * Wakes a napping county (or one whose nap is due but not yet recorded:
 * napCheck runs first, so the nap starts at its deterministic instant rather
 * than whenever the adapter last looked). The caller must have caught the
 * county up to the nap instant first; otherwise the backlog would run on the
 * shifted grid. Returns whether it woke.
 */
export function wake(c: CountyState, now: number, napAfterMs: number): boolean {
  napCheck(c, now, napAfterMs);
  if (!c.nap) return false;
  shiftGrid(c, c.nap.since, now);
  c.nap = null;
  return true;
}

/** A hello: wakes a napping county, then records presence. */
export function hello(c: CountyState, now: number, napAfterMs: number): void {
  wake(c, now, napAfterMs);
  if (now > c.lastHelloAt) c.lastHelloAt = now;
}

export function setPause(c: CountyState, on: boolean, now: number): void {
  if (on && !c.pause) c.pause = { since: ceilToGrid(c, now) };
  else if (!on && c.pause) {
    const since = c.pause.since;
    c.pauseUsedMs += shiftGrid(c, since, now);
    c.pause = null;
  }
}

// ---- Regional Days ------------------------------------------------------------------------------

/** The instant of the county's next Regional Day (index c.dayIndex). */
export function nextRegionalDayAt(c: CountyState, devRegionalTicks = 48): number {
  if (c.devTickMs !== null) return c.epoch + c.pausedMs + (c.dayIndex + 1) * devRegionalTicks * c.tickMs;
  const after = Math.max(c.lastRegionalDayAt, c.resumedAt, c.epoch);
  let day = londonDay(after);
  let at = londonInstant(day, c.regionalHour);
  while (at <= after) {
    day += 1;
    at = londonInstant(day, c.regionalHour);
  }
  return at;
}

/** Sunday's Regional Day is also the County Week (§8.9). In dev-clock mode, every 7th. */
export function isCountyWeek(c: CountyState, at: number, dayIndex: number): boolean {
  if (c.devTickMs !== null) return dayIndex % 7 === 6;
  return weekday(londonDay(at)) === 0;
}

// ---- Towns on the grid ----------------------------------------------------------------------------

/** The county grid tick a town tick runs at (sprint ticks: the founding tick). */
export function gridOfTownTick(t: TownState, tick: number): number {
  return t.gridBase === null ? t.foundGrid : t.gridBase + tick;
}

/** The town tick count a town on the grid should have reached at a completed grid tick count. */
export function townTarget(t: TownState, gridTicks: number): number {
  if (t.gridBase === null || t.archived) return t.tick;
  const target = gridTicks - t.gridBase;
  return target > t.tick ? target : t.tick;
}

/** County month of a grid tick (the World index, §2.2). */
export function countyMonth(gridTick: number): number {
  return Math.floor(gridTick / TICKS_PER_MONTH);
}
