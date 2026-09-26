// src/lib/home/presence/day-timeline.ts
//
// "Your day" on /home/people/[subject]: one day's track with the day's health
// under it, ported from the pilot's retired Movement tab (SR-AppleApp
// server/public/movement.js + map.js). PURE — no DOM, no fetch — so the
// endpoint, the component and the tests share one reading of the day.
//
// The behaviour that came across on purpose:
//  - A day is bucketed in the BROWSER's timezone offset (`getTimezoneOffset()`,
//    minutes behind UTC), or a walk at half past midnight in summer lands on
//    the day before. One offset for the whole window: across a clock change an
//    hour lands on the neighbouring day, as it did on the dashboard.
//  - Recording is split into segments wherever two fixes are more than the gap
//    (600 s) apart. Inside a segment the line is solid; between segments it is
//    a DASHED hop, because the phone was asleep and the route is not known.
//  - The scrub cursor shows a position only when a fix is within that gap of
//    the moment; otherwise it says the phone was asleep rather than guess.
//  - Sleep is a UNION of the asleep stages, clipped to the day: sources
//    overlap, and adding a watch's `deep` to a phone's `asleep` would report a
//    night longer than the night was.
//  - Steps are RECORDS: the phone uploads one cumulative row per calendar day,
//    so the day's figure is the record that overlaps it most — never a sum.

import type { DayPoint, DayTimeline, DayTrack } from './companion-accounts';

export const SEGMENT_GAP_SECONDS = 600;
/** How far back the day picker reaches: today and the thirty days before it. */
export const DAY_CHOICES = 31;
/** The stages that count as asleep. `awake` and `in_bed` do not. */
export const ASLEEP_STAGES: ReadonlySet<string> = new Set(['asleep', 'core', 'deep', 'rem']);

export type LngLat = [number, number];

/** The calendar date an instant falls on, for a reader `offsetMinutes` behind UTC. */
export function localDate(epochSeconds: number, offsetMinutes: number): string {
  return new Date((epochSeconds - offsetMinutes * 60) * 1000).toISOString().slice(0, 10);
}

/** Start and end of a local calendar date, epoch seconds. */
export function dayBounds(date: string, offsetMinutes: number): [number, number] {
  const start = Date.parse(`${date}T00:00:00Z`) / 1000 + offsetMinutes * 60;
  return [start, start + 86_400];
}

/** HH:MM on the reader's clock. */
export function clockAt(epochSeconds: number, offsetMinutes: number): string {
  return new Date((epochSeconds - offsetMinutes * 60) * 1000).toISOString().slice(11, 16);
}

const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

/** The picker's options, newest first: today, yesterday, then dates. */
export function dayChoices(nowSeconds: number, offsetMinutes: number, count = DAY_CHOICES): Array<{ date: string; label: string }> {
  const today = localDate(nowSeconds, offsetMinutes);
  const base = Date.parse(`${today}T00:00:00Z`);
  const out: Array<{ date: string; label: string }> = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base - i * 86_400_000);
    const date = d.toISOString().slice(0, 10);
    out.push({ date, label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : DAY_LABEL.format(d) });
  }
  return out;
}

/**
 * The window a `?date=&tz=` request asks for, or why it is refused. Today and
 * the thirty days before it, on the reader's own calendar; the pilot keeps
 * thirty days of location, so further back would only ever be empty.
 */
export function dayWindowFor(
  date: string | null,
  tzRaw: string | null,
  nowSeconds: number,
): { ok: true; from: number; to: number; tz: number; date: string } | { ok: false; error: string } {
  // `Number(null)` and `Number('')` are both 0: recognise absence first.
  const tz = tzRaw === null || tzRaw === '' ? 0 : Number(tzRaw);
  if (!Number.isInteger(tz) || Math.abs(tz) > 840) return { ok: false, error: 'Invalid timezone offset' };
  if (!date || !/^\d{4}-\d\d-\d\d$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) {
    return { ok: false, error: 'Invalid date' };
  }
  const allowed = dayChoices(nowSeconds, tz).map((c) => c.date);
  if (!allowed.includes(date)) return { ok: false, error: `Only the last ${DAY_CHOICES} days can be read` };
  const [from, to] = dayBounds(date, tz);
  return { ok: true, from, to, tz, date };
}

/** Runs of continuous recording, as inclusive index pairs — the pilot's own rule. */
export function segmentsOf(points: readonly DayPoint[], gapSeconds = SEGMENT_GAP_SECONDS): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i][2] - points[i - 1][2] > gapSeconds) {
      out.push([start, i - 1]);
      start = i;
    }
  }
  if (points.length) out.push([start, points.length - 1]);
  return out;
}

/** The track's segments, rebuilt here when the pilot sent none that line up. */
export function segmentsFor(track: Pick<DayTrack, 'points' | 'segments' | 'gapSeconds'>): Array<[number, number]> {
  return track.segments.length || !track.points.length ? track.segments : segmentsOf(track.points, track.gapSeconds);
}

export interface TrackShapes {
  /** One solid line per segment of two or more fixes. */
  lines: LngLat[][];
  /** Dashed hops from where recording stopped to where it began again. */
  gaps: Array<[LngLat, LngLat]>;
  /** Segments of a single fix: a real observation with no line to draw. */
  lone: LngLat[];
  start: LngLat | null;
  end: LngLat | null;
}

/** What the map draws for a day. PURE. */
export function trackShapes(points: readonly DayPoint[], segments: ReadonlyArray<readonly [number, number]>): TrackShapes {
  const at = (i: number): LngLat => [points[i][0], points[i][1]];
  const lines: LngLat[][] = [];
  const lone: LngLat[] = [];
  const gaps: Array<[LngLat, LngLat]> = [];
  segments.forEach(([first, last], n) => {
    if (last > first) lines.push(points.slice(first, last + 1).map((p) => [p[0], p[1]] as LngLat));
    else lone.push(at(first));
    const next = segments[n + 1];
    if (next) gaps.push([at(last), at(next[0])]);
  });
  return {
    lines,
    gaps,
    lone,
    start: points.length ? at(0) : null,
    end: points.length ? at(points.length - 1) : null,
  };
}

/**
 * Spans clipped to a window and merged where they overlap, in time order.
 * Each input span is `[startSeconds, endSeconds]`. PURE.
 */
export function unionSpans(spans: ReadonlyArray<readonly [number, number]>, from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
    const start = Math.max(s, from);
    const end = Math.min(e, to);
    if (end <= start) continue;
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

export function unionSeconds(spans: ReadonlyArray<readonly [number, number]>, from: number, to: number): number {
  return unionSpans(spans, from, to).reduce((sum, [s, e]) => sum + (e - s), 0);
}

const secs = (iso: string) => Date.parse(iso) / 1000;

/** The day's sleep as unioned bands of the asleep stages. */
export function sleepBands(sleep: DayTimeline['sleep'], from: number, to: number): Array<[number, number]> {
  return unionSpans(
    sleep.filter((s) => ASLEEP_STAGES.has(s.stage)).map((s) => [secs(s.start), secs(s.end)] as [number, number]),
    from,
    to,
  );
}

/** Workouts clipped to the day, each keeping its name and full duration. */
export function workoutSpans(workouts: DayTimeline['workouts'], from: number, to: number) {
  return workouts
    .map((w) => ({ ...w, from: Math.max(secs(w.start), from), to: Math.min(secs(w.end), to) }))
    .filter((w) => w.to > w.from)
    .sort((a, b) => a.from - b.from);
}

/** The day's step total: the record overlapping the day most, or null. Never a sum. */
export function stepsForDay(steps: DayTimeline['steps'], from: number, to: number): number | null {
  let best: { value: number; overlap: number } | null = null;
  for (const s of steps) {
    const overlap = Math.min(secs(s.end), to) - Math.max(secs(s.start), from);
    if (overlap > 0 && (!best || overlap > best.overlap)) best = { value: s.value, overlap };
  }
  return best ? best.value : null;
}

/**
 * Heart rate at a moment from the binned series, or null when the nearest bin
 * is more than one bin away — the watch came off, and a value carried across
 * the hole would state a reading nobody measured.
 */
export function heartRateAt(series: DayTimeline['heartRate'], epochSeconds: number): number | null {
  let best: number | null = null;
  let bestGap = Infinity;
  for (const [at, value] of series.bins) {
    const gap = Math.abs(at + series.seconds / 2 - epochSeconds);
    if (gap < bestGap) {
      bestGap = gap;
      best = value;
    }
  }
  return bestGap <= series.seconds ? best : null;
}

/**
 * The heart-rate line as separate runs: a bin more than two and a half bins
 * after the last one is a hole, not a slope. Each point is the bin's middle.
 */
export function heartRateRuns(series: DayTimeline['heartRate']): Array<Array<[number, number]>> {
  const runs: Array<Array<[number, number]>> = [];
  let previous: number | null = null;
  for (const [at, value] of series.bins) {
    if (previous === null || at - previous > series.seconds * 2.5) runs.push([]);
    runs[runs.length - 1].push([at + series.seconds / 2, value]);
    previous = at;
  }
  return runs;
}

/**
 * Where the reader was at a moment on the timeline: the nearest fix, if it is
 * within the segment gap. Further than that the phone was asleep, and a dot
 * would claim to know something the recording does not.
 */
export function momentAt(
  points: readonly DayPoint[],
  epochSeconds: number,
  gapSeconds = SEGMENT_GAP_SECONDS,
): { point: DayPoint | null; gap: number | null } {
  let nearest: DayPoint | null = null;
  let gap = Infinity;
  for (const p of points) {
    const d = Math.abs(p[2] - epochSeconds);
    if (d < gap) {
      gap = d;
      nearest = p;
    }
  }
  if (!nearest) return { point: null, gap: null };
  return gap <= gapSeconds ? { point: nearest, gap } : { point: null, gap };
}

export function kilometres(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(metres >= 10_000 ? 0 : 1)} km` : `${Math.round(metres)} m`;
}

export function duration(seconds: number): string {
  const total = Math.round(seconds / 60);
  return total >= 60 ? `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m` : `${total}m`;
}
