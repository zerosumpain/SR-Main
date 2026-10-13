// src/lib/trips/routing.ts
//
// The pure half of the routing layer: how a big matrix is cut into requests a
// router accepts, how a pair of points is keyed in the cache, how the cache's
// answers are assembled into a `TravelMatrix`, and local time → UTC for a
// timetable query. The I/O is in ./routing.server.

import type { LatLng, LocalDate, TravelMatrix, TravelMode } from './model';

export interface RoutePoint {
  id: string;
  location: LatLng;
}

/** Cache key for a directed pair: coordinates to 5 decimals (about a metre). */
export function pairKey(a: LatLng, b: LatLng): string {
  const f = (p: LatLng) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  return `${f(a)}>${f(b)}`;
}

export interface MatrixBlock {
  /** Indices into the full point list, in request order. */
  coords: number[];
  /** Positions within `coords` that are sources / destinations. */
  sources: number[];
  destinations: number[];
}

/**
 * Cut an N×N matrix into requests of at most `cap` coordinates: the points
 * are split into groups of ⌊cap/2⌋, and every ordered pair of groups (A, B)
 * is one request with A as sources and B as destinations. With N ≤ cap it is
 * one request with everything.
 */
export function matrixBlocks(n: number, cap: number): MatrixBlock[] {
  if (n <= 0) return [];
  if (n <= cap) {
    const all = [...Array(n).keys()];
    return [{ coords: all, sources: all, destinations: all }];
  }
  const size = Math.max(1, Math.floor(cap / 2));
  const groups: number[][] = [];
  for (let i = 0; i < n; i += size) groups.push([...Array(Math.min(size, n - i)).keys()].map((k) => i + k));
  const blocks: MatrixBlock[] = [];
  for (const a of groups) {
    for (const b of groups) {
      if (a === b) {
        blocks.push({ coords: a, sources: a.map((_, i) => i), destinations: a.map((_, i) => i) });
      } else {
        blocks.push({ coords: [...a, ...b], sources: a.map((_, i) => i), destinations: b.map((_, i) => a.length + i) });
      }
    }
  }
  return blocks;
}

export type PairAnswer = { s: number | null; m: number | null };

/**
 * One mode's square of seconds and metres from answers keyed by pair, with
 * the diagonal zero. A missing pair is filled by `fallback`; returns whether
 * any cell needed it.
 */
export function assembleMode(
  points: RoutePoint[],
  answers: Map<string, PairAnswer>,
  fallback: (a: RoutePoint, b: RoutePoint) => PairAnswer,
): { seconds: Array<Array<number | null>>; metres: Array<Array<number | null>>; estimatedCells: number } {
  let estimatedCells = 0;
  const seconds: Array<Array<number | null>> = [];
  const metres: Array<Array<number | null>> = [];
  for (const a of points) {
    const sRow: Array<number | null> = [];
    const mRow: Array<number | null> = [];
    for (const b of points) {
      if (a === b) {
        sRow.push(0);
        mRow.push(0);
        continue;
      }
      let hit = answers.get(pairKey(a.location, b.location));
      if (!hit) {
        hit = fallback(a, b);
        estimatedCells++;
      }
      sRow.push(hit.s === null ? null : Math.round(hit.s));
      mRow.push(hit.m === null ? null : Math.round(hit.m));
    }
    seconds.push(sRow);
    metres.push(mRow);
  }
  return { seconds, metres, estimatedCells };
}

/** Modes the matrix carries for a trip: walk always, then the ones chosen, in canonical order. */
export function matrixModes(modes: TravelMode[]): TravelMode[] {
  return (['walk', 'cycle', 'drive', 'transit'] as TravelMode[]).filter((m) => m === 'walk' || modes.includes(m));
}

/** An empty matrix over the given points (no modes yet). */
export function emptyMatrix(points: RoutePoint[]): TravelMatrix {
  return { points: points.map((p) => p.id), seconds: {}, metres: {}, estimated: {} };
}

/** Offset of `timeZone` from UTC at `utcMs`, minutes (Europe/Rome in summer → 120). */
export function zoneOffsetMin(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'));
  return Math.round((asUtc - Math.floor(utcMs / 60_000) * 60_000) / 60_000);
}

/** Local date + minutes in a zone → ISO instant. */
export function localToIso(date: LocalDate, minutes: number, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  // Two passes settle the offset across a DST change.
  let utc = naive - zoneOffsetMin(timeZone, naive) * 60_000;
  utc = naive - zoneOffsetMin(timeZone, utc) * 60_000;
  return new Date(utc).toISOString();
}

/** The local calendar date in a zone at an instant. */
export function localDateIn(timeZone: string, at: Date): LocalDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/**
 * The day to ask a timetable about: the trip's own first day when its
 * timetable is likely published (within 60 days), else the same weekday next
 * week — the usual service pattern is what a plan weeks away needs.
 */
export function timetableDate(tripStart: LocalDate, today: LocalDate): LocalDate {
  const p = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const ahead = Math.round((p(tripStart) - p(today)) / 86_400_000);
  if (ahead >= 0 && ahead <= 60) return tripStart;
  const weekday = new Date(p(tripStart)).getUTCDay();
  let t = p(today) + 86_400_000;
  while (new Date(t).getUTCDay() !== weekday) t += 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
