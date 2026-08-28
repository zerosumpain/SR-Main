// src/lib/daydream/features/calendar.ts
//
// Turning calendar events into two numbers per local day, honestly.
//
// The columns existed from the first feature-store merge and were hardcoded
// null, which meant no correlation or hypothesis could ever involve the diary —
// "busy days cost you sleep" was untestable while the data to test it sat one
// tool call away. The reason it was deferred is the same reason this file is
// careful: the calendar tool caps a read at 100 merged rows and flags
// `truncated`, and a truncated read silently undercounts. So the window is
// fetched in chunks, a truncated chunk is split and retried, and a day whose
// read failed is ABSENT, never zero — a zero here means "the diary answered and
// had nothing", which is a real observation.
//
// The maths helpers are PURE (no DB, no clock, no network) so the day
// arithmetic — the part that actually goes wrong — is unit-testable. Fetching
// lives in one thin function at the bottom.

import { LOCAL_TZ } from '../types';
import { readCalendar } from '../calendar/read';
import { ExclusionSet, NO_EXCLUSIONS } from '../calendar/exclusions';

/** One calendar event as the site tool returns it, reduced to what matters. */
export interface CalendarEventRow {
  start: string;
  end?: string | null;
}

/** What the feature builder stores for one local day. */
export interface CalendarDay {
  /** Events touching this day (timed events on their start day; all-day events
   *  on every day they cover). */
  events: number;
  /** Minutes of the day covered by timed events, overlaps merged. */
  busyMinutes: number;
  /** True when the chunk covering this day was truncated or a calendar could
   *  not be read — the numbers are then a floor, not a count. */
  partial: boolean;
}

/** Days per fetch chunk. Small enough that a normal diary stays under the
 *  tool's 100-row cap; a chunk that still truncates is split further. */
export const CALENDAR_CHUNK_DAYS = 10;

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: LOCAL_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Europe/London calendar day for an instant. */
function localDayOf(d: Date): string {
  return dayFmt.format(d);
}

/**
 * The UTC instant at which a local calendar day begins.
 *
 * Two-pass correction: guess midnight UTC, see what local wall-clock that
 * shows, shift by the difference. Handles BST — under it local midnight is
 * 23:00 UTC the previous day, the exact off-by-an-hour that localDayStart()
 * in budget.ts exists to avoid.
 */
export function dayStartUtc(day: string, tz = LOCAL_TZ): Date {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const target = Date.parse(`${day}T00:00:00Z`);
  let guess = new Date(target);
  for (let i = 0; i < 2; i++) {
    const parts = fmt.formatToParts(guess);
    const num = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const shown = Date.UTC(num('year'), num('month') - 1, num('day'), num('hour') % 24, num('minute'), num('second'));
    guess = new Date(guess.getTime() + (target - shown));
  }
  return guess;
}

/** The next calendar day, as a YYYY-MM-DD string. */
export function nextDay(day: string): string {
  const d = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Structural all-day detection, because the tool's row shape does not promise
 * a flag: a date-only start, or a whole-day span starting at midnight — LOCAL
 * midnight or UTC midnight, because iCloud serialises an all-day event as a
 * floating DATE that reaches us rendered as UTC-midnight ISO, which under BST
 * is an hour off local midnight. The first production run missed that shape,
 * classified the events as timed, and every day's busy minutes clamped to
 * 1440.
 */
export function isAllDay(ev: CalendarEventRow): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(ev.start.trim())) return true;
  const start = Date.parse(ev.start);
  const end = ev.end ? Date.parse(ev.end) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const span = end - start;
  if (span < 86_400_000 || span % 86_400_000 !== 0) return false;
  if (start % 86_400_000 === 0) return true; // UTC midnight
  return dayStartUtc(localDayOf(new Date(start))).getTime() === start; // local midnight
}

/**
 * A "timed" event at least this long is not occupying anyone's attention the
 * way a meeting does — it is a holiday, a reminder span, or an all-day entry
 * in some serialisation the structural check above does not recognise. It
 * still counts as an event on its start day but contributes no busy minutes;
 * without this bound, one such event floods every day it covers to the
 * 1440-minute clamp and the metric stops meaning anything.
 */
export const MAX_TIMED_EVENT_MS = 20 * 3_600_000;

/**
 * Collapse a chunk's events into per-day counts and merged busy minutes.
 *
 * `days` is the chunk's own range — every day in it gets a row, so a day the
 * diary answered about with nothing is a real zero. Busy minutes merge
 * overlapping timed events (two meetings at 2pm are one busy hour, not two)
 * and clip at local midnight so a late call lands on the day it started and
 * the day it spilled into, minute for minute. All-day events count as events
 * on every day they cover but contribute no busy minutes — a birthday does
 * not occupy the day the way a meeting does.
 */
export function summariseChunk(
  events: CalendarEventRow[],
  days: string[],
  partial: boolean,
): Map<string, CalendarDay> {
  const out = new Map<string, CalendarDay>();
  for (const day of days) out.set(day, { events: 0, busyMinutes: 0, partial });

  const timed: Array<{ start: number; end: number }> = [];
  for (const ev of events) {
    if (isAllDay(ev)) {
      // Count on each covered day. A date-only start covers one day unless an
      // end says otherwise; a timed midnight span covers its whole-day span.
      const startMs = /^\d{4}-\d{2}-\d{2}$/.test(ev.start.trim())
        ? dayStartUtc(ev.start.trim().slice(0, 10)).getTime()
        : Date.parse(ev.start);
      const endMs = ev.end ? Date.parse(ev.end) : startMs + 86_400_000;
      if (!Number.isFinite(startMs)) continue;
      for (let t = startMs; t < (Number.isFinite(endMs) ? endMs : startMs + 86_400_000); t += 86_400_000) {
        const d = out.get(localDayOf(new Date(t)));
        if (d) d.events++;
      }
      continue;
    }
    const start = Date.parse(ev.start);
    if (!Number.isFinite(start)) continue;
    const end = ev.end ? Date.parse(ev.end) : start;
    const d = out.get(localDayOf(new Date(start)));
    if (d) d.events++;
    if (Number.isFinite(end) && end > start && end - start < MAX_TIMED_EVENT_MS) {
      timed.push({ start, end });
    }
  }

  // Merge overlapping timed intervals once, then clip per day.
  timed.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const iv of timed) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else merged.push({ ...iv });
  }

  for (const day of days) {
    const row = out.get(day);
    if (!row) continue;
    const dayStart = dayStartUtc(day).getTime();
    const dayEnd = dayStartUtc(nextDay(day)).getTime();
    let ms = 0;
    for (const iv of merged) {
      ms += Math.max(0, Math.min(iv.end, dayEnd) - Math.max(iv.start, dayStart));
    }
    row.busyMinutes = Math.min(1440, Math.round(ms / 60_000));
  }

  return out;
}

/** The local days a chunk spans, inclusive of `from`'s day, exclusive of `to`'s
 *  unless `inclusiveEnd`. */
export function daysBetween(fromDay: string, toDay: string): string[] {
  const days: string[] = [];
  for (let d = fromDay; d <= toDay; d = nextDay(d)) {
    days.push(d);
    if (days.length > 400) break; // never loop unbounded on bad input
  }
  return days;
}

type ChunkFetch = (
  fromDay: string,
  toDay: string,
) => Promise<{ events: CalendarEventRow[]; truncated: boolean; partial: boolean } | null>;

/**
 * Fetch per-day calendar facts for a window.
 *
 * A truncated chunk is split in half and retried, down to single days — a
 * single day that still truncates keeps its floor and is marked partial. A
 * chunk whose read FAILS contributes nothing at all, so its days stay absent
 * in the feature store rather than reading as a quiet diary.
 */
export async function fetchCalendarDays(
  fromDay: string,
  toDay: string,
  fetchChunk: ChunkFetch,
  chunkDays = CALENDAR_CHUNK_DAYS,
): Promise<Map<string, CalendarDay>> {
  const out = new Map<string, CalendarDay>();
  const allDays = daysBetween(fromDay, toDay);

  async function run(days: string[]): Promise<void> {
    if (days.length === 0) return;
    const res = await fetchChunk(days[0], days[days.length - 1]);
    if (res === null) return; // failed read → absent days
    if (res.truncated && days.length > 1) {
      const mid = Math.ceil(days.length / 2);
      await run(days.slice(0, mid));
      await run(days.slice(mid));
      return;
    }
    const summary = summariseChunk(res.events, days, res.partial || res.truncated);
    for (const [day, row] of summary) out.set(day, row);
  }

  for (let i = 0; i < allDays.length; i += chunkDays) {
    await run(allDays.slice(i, i + chunkDays));
  }
  return out;
}

/**
 * The default fetcher, going through the site-tools registry.
 *
 * Dynamically imported for the same reason snapshot.ts does it: a static
 * import of the registry boots platform services (WhatsApp included) in any
 * test that touches this module.
 */
export function toolChunkFetch(exclusions: ExclusionSet = NO_EXCLUSIONS): ChunkFetch {
  return async (fromDay, toDay) => {
    // Through the shared reader, so an excluded event contributes no busy
    // minutes and is not counted as an event. The rule set is passed IN rather
    // than loaded here: a 250-day rebuild calls this ~25 times, and loading
    // the same handful of rows on every chunk would be 25 queries for one
    // answer that cannot change mid-run.
    const read = await readCalendar(
      {
        dateRangeStart: fromDay,
        // The range end is exclusive at midnight, so ask through the next day.
        dateRangeEnd: nextDay(toDay),
      },
      exclusions,
    );
    // A failed read contributes NOTHING, so its days stay absent in the
    // feature store rather than reading as a quiet diary. Absent is not zero.
    if (!read.available) return null;
    return {
      events: read.events.map(
        (e): CalendarEventRow => ({ start: e.start, end: e.end }),
      ),
      truncated: read.truncated,
      partial: read.partial,
    };
  };
}
