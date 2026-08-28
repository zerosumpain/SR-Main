// src/lib/heartbeat/schedule.ts
//
// When an action with an active-hours window should next be looked at.
//
// ── The bug this file exists to fix ──────────────────────────────────────────
//
// `runOne` used to compute `nextRunAt = now + cadenceSeconds` for EVERY
// outcome, including the "outside active hours" skip. For any action whose
// cadence divides evenly into a day, that leaves the run time at a fixed
// wall-clock PHASE — and if the phase sits outside the window, the action is
// locked out permanently. It never drifts back in, because nothing about a
// skip moves the phase.
//
// Measured on production 2026-08-28:
//
//   daydream-bank      86400s, window 05:00–07:00, due 07:50 BST — 3/3 pulses
//                      skipped. It had never run once.
//   daydream-weekly    21600s, window 17:00–21:00, phase 21:24/03:24/09:24/
//                      15:24 BST — 6/6 skipped. The Sunday letter had never
//                      been sent.
//   daydream-rulesmith 86400s, window 04:00–06:00, due 10:25 BST — 3/4.
//
// Short-cadence actions self-heal (a 15-minute action tries 96 times a day and
// one of them lands), which is why this went unnoticed for so long: everything
// anybody watched was fine.
//
// ── The rule ────────────────────────────────────────────────────────────────
//
// A skip is not a run, so it must not restart the cadence clock. Instead the
// action is re-scheduled to the moment its window NEXT OPENS. That is always
// later than the time it was already due, so this can only ever delay an
// action, never make one fire early — the cadence stays a floor.
//
// Everything here is pure: no database, no ambient clock. The part that goes
// wrong is the wall-clock arithmetic across a DST boundary, and that is
// exactly the part a test can pin down.

/** The fields of a heartbeat action this module needs. */
export interface WindowSpec {
  /** 'HH:MM' local wall clock, or null for "always on". */
  activeHoursStart: string | null;
  activeHoursEnd: string | null;
  /** IANA zone. Null is treated as UTC, matching withinActiveHours. */
  activeHoursTz: string | null;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * A usable IANA zone, or UTC.
 *
 * `active_hours_tz` is a free-text column, so a typo in it used to throw a
 * RangeError out of `withinActiveHours` — inside the engine tick, on every
 * pass, for as long as the bad value sat there. Degrading to UTC keeps the
 * action running on a window that is merely wrong rather than stopping it on a
 * window that cannot be read, and it keeps "is it open?" and "when does it
 * open?" answering about the SAME zone, which is what makes the reschedule
 * below coherent.
 */
export function resolveZone(tz: string | null | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Local wall-clock 'HH:MM' for an instant, in a named zone. */
export function wallClock(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: resolveZone(tz),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  // en-GB renders midnight as "24" in some ICU builds; fold it back.
  return `${hh === '24' ? '00' : hh}:${mm}`;
}

/**
 * Is `now` inside the action's window?
 *
 * A window with no start or no end is always open. A window whose start is
 * after its end wraps midnight (22:00–06:00), which is why this is not a plain
 * range test.
 */
export function withinActiveHours(row: WindowSpec, now: Date): boolean {
  if (!row.activeHoursStart || !row.activeHoursEnd) return true;
  const cur = wallClock(now, resolveZone(row.activeHoursTz));
  const start = row.activeHoursStart;
  const end = row.activeHoursEnd;
  if (start <= end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

/** The local calendar day ('YYYY-MM-DD') an instant falls on, in a zone. */
function localDay(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveZone(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * The UTC instant at which `day` (YYYY-MM-DD) shows `hhmm` on the wall clock
 * in `tz`.
 *
 * Two-pass correction — guess, read back what the guess shows locally, shift
 * by the difference — which is the same technique `features/calendar.ts` uses
 * for local midnight. Under BST that difference is an hour, and getting it
 * wrong here would move every window by one, which is precisely the class of
 * error that produced the lock-out in the first place.
 *
 * An unknown zone is read as UTC by `resolveZone`, matching the open/closed
 * test exactly — the two must never disagree about which clock they are on.
 */
export function instantAtLocalTime(day: string, hhmm: string, tz: string): Date | null {
  const m = HHMM.exec(hhmm);
  if (!m) return null;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: resolveZone(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const target = Date.parse(`${day}T${hhmm}:00Z`);
  if (!Number.isFinite(target)) return null;

  let guess = new Date(target);
  for (let i = 0; i < 3; i++) {
    const parts = fmt.formatToParts(guess);
    const num = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const shown = Date.UTC(
      num('year'),
      num('month') - 1,
      num('day'),
      num('hour') % 24,
      num('minute'),
      num('second'),
    );
    const drift = target - shown;
    if (drift === 0) break;
    guess = new Date(guess.getTime() + drift);
  }
  return guess;
}

/** How far ahead to look for an opening before giving up. Three days covers
 *  every DST transition and every midnight-wrapping window; a window that has
 *  not opened in three days is malformed, not merely awkward. */
const SEARCH_DAYS = 3;

/**
 * The next instant strictly after `now` at which the window is open.
 *
 * Null when there is nothing to compute (no window, or a window that can never
 * open — `start === end` is a range of zero width, and no amount of waiting
 * fixes it). Callers fall back to their previous behaviour on null rather than
 * inventing a time, because a wrong answer here would either spin the engine
 * or silence the action a second way.
 */
export function nextWindowOpening(row: WindowSpec, now: Date): Date | null {
  const start = row.activeHoursStart;
  const end = row.activeHoursEnd;
  if (!start || !end) return null;
  if (!HHMM.test(start) || !HHMM.test(end)) return null;
  if (start === end) return null; // never opens; see the doc comment
  const tz = resolveZone(row.activeHoursTz);

  // Already open — the caller asked the wrong question, but answering "now" is
  // the only honest reply and is safe: the engine clamps it forward.
  if (withinActiveHours(row, now)) return now;

  let day = localDay(now, tz);
  for (let i = 0; i <= SEARCH_DAYS; i++) {
    const at = instantAtLocalTime(day, start, tz);
    if (at === null) return null;
    if (at.getTime() > now.getTime()) return at;
    day = addLocalDay(day);
  }
  return null;
}

/** The next calendar day as a YYYY-MM-DD string. Midday arithmetic so a DST
 *  shift can never move the date. */
function addLocalDay(day: string): string {
  const t = Date.parse(`${day}T12:00:00Z`);
  if (!Number.isFinite(t)) return day;
  return new Date(t + 86_400_000).toISOString().slice(0, 10);
}

/** Never re-schedule closer than this. A computed opening is always in the
 *  future, but a clamp costs nothing and makes a spin impossible. */
export const MIN_RESCHEDULE_MS = 60_000;

/**
 * What `next_run_at` should become when a run was skipped for being outside
 * the window.
 *
 * `fallback` is the old behaviour (`now + cadence`) and is returned whenever
 * the opening cannot be computed, so a malformed window is no worse off than
 * it is today.
 */
export function rescheduleAfterWindowSkip(
  row: WindowSpec,
  now: Date,
  fallback: Date,
): Date {
  const opening = nextWindowOpening(row, now);
  if (opening === null) return fallback;
  const floor = now.getTime() + MIN_RESCHEDULE_MS;
  return new Date(Math.max(opening.getTime(), floor));
}
