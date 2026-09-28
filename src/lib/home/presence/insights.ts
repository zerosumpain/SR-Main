/** Pure, observation-bounded household analysis. No extrapolation across gaps. */
import { metresBetween } from './cluster';
import { circularMedianMinute, hhmm } from './stats';
import { LOCAL_TZ, MAX_USABLE_ACCURACY_M, MIN_DWELL_MINS, MIN_JOURNEY_METRES, STILL_MAX_GAP_MINS, STILL_RADIUS_M } from './types';

const MINUTE = 60_000;
const DAY = 86_400_000;
export interface InsightFix {
  subject: string; ts: Date; lat: number | null; lon: number | null;
  accuracyM?: number | null; readingAgeS?: number | null; placeId?: string | null;
  mode?: string | null; speedKmh?: number | null; isHome?: boolean | null;
}
export interface InsightPlace {
  id: string; label: string | null; kind: string; lat: number; lon: number; radiusM: number;
  source?: string; suggestedLabel?: string | null; alerts?: boolean;
}
export interface InsightPerson { subject: string; displayName: string }
type Fix = InsightFix & { lat: number; lon: number };
interface Leg { a: Fix; b: Fix; start: number; end: number; moving: boolean; active: boolean }
export interface Trip {
  subject: string; from: string; to: string; start: number; end: number; minutes: number;
  mode: string; path: Fix[];
}
export interface RouteInsight {
  id: string; subject: string; person: string; fromId: string; toId: string;
  from: string; to: string; samples: number; average: number; median: number; low: number; high: number;
  departure: string; morning: number; mode: string;
  /** Trips far beyond the usual time — an arrival the trail missed. Drawn, never averaged. */
  broken: number;
  /** Every trip, oldest first, for the dot strip. */
  trips: Array<{ start: string; minutes: number; broken: boolean }>;
}
export interface ArrivalInsight {
  id: string; subject: string; person: string; from: string; to: string; toId: string;
  departedAt: string; observedAt: string; eta: string; earliest: string; latest: string;
  minutesLeft: number; samples: number; confidence: 'established' | 'emerging'; returningHome: boolean;
}
export interface PersonInsight extends InsightPerson {
  observed: number; coverage: number; home: number; away: number; wander: number; daylight: number;
  stationary: number; longestStill: number; distanceKm: number; places: number; lastSeen: string | null;
}
export interface PresenceInsights {
  generatedAt: string; days: number; people: PersonInsight[]; routes: RouteInsight[]; arrivals: ArrivalInsight[];
  groups: Array<{ subjects: string[]; names: string[]; minutes: number }>;
  together: number; daily: Array<{ date: string; observed: number; wander: number; daylight: number }>;
}
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: LOCAL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: LOCAL_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: LOCAL_TZ, weekday: 'short' });
export const placeTitle = (p: InsightPlace | undefined): string => p?.label || p?.suggestedLabel || (p?.kind === 'home' ? 'Home' : 'Unnamed stop');
const round = (n: number) => Math.round(n * 10) / 10;
/** The local date, formatted once per UTC hour — the minute loop asks ~200k times. */
const dateByHour = new Map<number, string>();
function localDateOf(t: number): string {
  const hour = Math.floor(t / 3_600_000);
  let d = dateByHour.get(hour);
  if (d === undefined) {
    if (dateByHour.size > 5_000) dateByHour.clear();
    d = dateFmt.format(hour * 3_600_000); dateByHour.set(hour, d);
  }
  return d;
}
export function percentile(values: number[], q: number): number {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return 0;
  const i = (v.length - 1) * q, lo = Math.floor(i);
  return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo);
}
function minuteOfDay(t: number): number {
  const [h, m] = clockFmt.format(t).split(':').map(Number);
  return h * 60 + m;
}
const weekend = (t: number) => ['Sat', 'Sun'].includes(dayFmt.format(t));
export function usableFix(f: InsightFix, now: number): f is Fix {
  return f.lat != null && f.lon != null && Number.isFinite(f.lat) && Number.isFinite(f.lon)
    && Math.abs(f.lat) <= 90 && Math.abs(f.lon) <= 180 && !(f.lat === 0 && f.lon === 0)
    && f.ts.getTime() <= now && Number.isFinite(f.ts.getTime())
    && (f.accuracyM == null || (f.accuracyM >= 0 && f.accuracyM <= MAX_USABLE_ACCURACY_M))
    && (f.readingAgeS == null || (f.readingAgeS >= 0 && f.readingAgeS <= 120));
}
function continuous(a: Fix, b: Fix): boolean {
  const dt = b.ts.getTime() - a.ts.getTime();
  return dt > 0 && dt <= STILL_MAX_GAP_MINS * MINUTE && metresBetween(a.lat, a.lon, b.lat, b.lon) / dt * 3600 <= 200;
}
/** NOAA fractional-year solar approximation. Geometric daylight, not UV or weather. */
export function inDaylight(at: number, lat: number, lon: number): boolean {
  const d = new Date(at), year = d.getUTCFullYear();
  const day = (at - Date.UTC(year, 0, 1)) / DAY;
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  const g = 2 * Math.PI / ((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY) * (Math.floor(day) + (hour - 12) / 24);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = (hour * 60 + eq + 4 * lon) / 4 - 180;
  const rad = Math.PI / 180;
  return Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha * rad) > 0;
}
/** A common two-minute analysis cadence keeps five-second phone uploads from
 * looking stationary simply because each step is shorter than GPS accuracy.
 * Preserve invalid observations, gaps, place crossings and the latest fix. */
export function analysisFixes(rows: InsightFix[], now: Date): InsightFix[] {
  const ordered = [...new Map(rows.map(f => [+f.ts, f])).values()].sort((a, b) => +a.ts - +b.ts);
  const out: InsightFix[] = [];
  let kept: InsightFix | null = null, previous: InsightFix | null = null;
  for (const f of ordered) {
    if (!usableFix(f, +now)) {
      if (previous && kept !== previous) out.push(previous);
      out.push(f); kept = null; previous = null; continue;
    }
    if (previous && usableFix(previous, +now) && !continuous(previous, f)) {
      if (kept !== previous) out.push(previous);
      out.push(f); kept = f;
    } else if (!kept || +f.ts - +kept.ts >= 2 * MINUTE || f.placeId !== kept.placeId) {
      out.push(f); kept = f;
    }
    previous = f;
  }
  if (previous && kept !== previous) out.push(previous);
  return out;
}

/** A stop must stay near its first fix, not creep along a road in small steps. */
export function qualifiedStop(rows: InsightFix[], now: Date): Fix[] | null {
  const ordered = [...new Map(rows.map(f => [+f.ts, f])).values()].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const last = ordered.at(-1);
  if (!last || !usableFix(last, +now) || (last.speedKmh ?? 0) > 3 || +now - +last.ts > 3 * MINUTE) return null;
  const stop: Fix[] = [last];
  for (let i = ordered.length - 2; i >= 0; i--) {
    const f = ordered[i];
    if (!usableFix(f, +now) || !continuous(f, stop[0]) || metresBetween(f.lat, f.lon, last.lat, last.lon) > STILL_RADIUS_M
      || (f.speedKmh != null && f.speedKmh > 3)) break;
    stop.unshift(f);
    if ((+last.ts - +f.ts) / MINUTE >= MIN_DWELL_MINS) return stop;
  }
  return null;
}
function located(f: Fix, places: InsightPlace[]): Fix {
  // The latitude gap alone rules out almost every place before the haversine:
  // ~100k fixes against ~130 places is otherwise 13M haversines per analysis.
  const candidates = places.filter(p => Math.abs(f.lat - p.lat) * 111_320 <= p.radiusM && metresBetween(f.lat, f.lon, p.lat, p.lon) <= p.radiusM
    && (f.accuracyM ?? 0) <= p.radiusM && (f.speedKmh ?? 0) < 90);
  candidates.sort((a, b) => metresBetween(f.lat, f.lon, a.lat, a.lon) - metresBetween(f.lat, f.lon, b.lat, b.lon));
  // Recheck geometry: place ids on historical rows can predate an edited boundary.
  return { ...f, placeId: candidates[0]?.id ?? null };
}
/** Two places whose circles overlap: drift at one door "arrives" at the other.
 *  A home drawn at 50 m beside a 200 m street cluster produced a daily
 *  three-minute "trip" between them for every person in the house. */
function adjacent(a: string, b: string, places: InsightPlace[]): boolean {
  const pa = places.find(p => p.id === a), pb = places.find(p => p.id === b);
  return !!pa && !!pb && metresBetween(pa.lat, pa.lon, pb.lat, pb.lon) < pa.radiusM + pb.radiusM;
}
/** Completed trips require a ten-minute stay at both ends, an unbroken trail,
 *  and a real journey: not between overlapping places, not under 300 m. */
export function extractTrips(rows: InsightFix[], places: InsightPlace[], now: Date): { trips: Trip[]; active: Fix[] } {
  const trips: Trip[] = [];
  let origin: string | null = null, pending: Fix[] = [], path: Fix[] = [], prev: Fix | null = null;
  for (const raw of [...rows].sort((a, b) => +a.ts - +b.ts)) {
    if (!usableFix(raw, +now)) { origin = null; pending = []; path = []; prev = null; continue; }
    const f = located(raw, places);
    if (prev && +prev.ts === +f.ts) continue;
    if (prev && !continuous(prev, f)) { origin = null; pending = []; path = []; }
    if (origin) path.push(f);
    if (f.placeId && f.placeId === prev?.placeId) pending.push(f);
    else pending = f.placeId ? [f] : [];
    if (pending.length && +f.ts - +pending[0].ts >= MIN_DWELL_MINS * MINUTE) {
      if (origin && origin !== f.placeId && path.length > 1) {
        const end = +pending[0].ts, start = +path[0].ts;
        const moving = path.filter(p => +p.ts <= end);
        if (end - start >= 2 * MINUTE && end - start <= 4 * 60 * MINUTE && !adjacent(origin, f.placeId!, places)
          && metresBetween(path[0].lat, path[0].lon, pending[0].lat, pending[0].lon) >= MIN_JOURNEY_METRES) {
          const fast = moving.filter(p => (p.speedKmh ?? 0) > 18 || p.mode === 'vehicle' || p.mode === 'rail').length;
          trips.push({ subject: f.subject, from: origin, to: f.placeId!, start, end, minutes: (end - start) / MINUTE,
            mode: fast > moving.length / 3 ? 'vehicle' : 'active', path: moving });
        }
      }
      origin = f.placeId!;
      path = [f];
    } else if (origin === f.placeId) path = [f];
    prev = f;
  }
  return { trips, active: origin && path.length >= 3 && !path.at(-1)?.placeId ? path : [] };
}
/**
 * How long a repeated provider reading still says "they are still there".
 *
 * Life360 (via Home Assistant) only checks in when the phone moves, so a
 * two-minute poll of a still phone returns the SAME reading for hours, its
 * age (`last_seen`) climbing — median 16–36 minutes across the household,
 * measured 2026-09-28. Refusing every reading over 120 s threw away 92% of
 * the Life360 trail: 28-day coverage read 1–5% and not one route was learned.
 * Six hours covers a still night or a school day; past it, a silent phone is
 * a gap, never a stay.
 */
export const HEARTBEAT_MAX_S = 6 * 3600;

/**
 * Put provider readings back on the clock they were taken at. PURE.
 *
 * A NEW reading (its seen time differs from the last one) moves to that seen
 * time — `ts − readingAgeS` — which is when the phone was actually there. A
 * REPEAT of the last reading is a heartbeat at the poll time: still here, not
 * moving. A repeat older than `HEARTBEAT_MAX_S` becomes a gap. A heartbeat
 * that a newer reading proves was already out of date (the phone had moved by
 * then) is dropped, so a stale position never follows a fresh one.
 * Readings with no age (the app, backfill) pass through untouched.
 */
export function normaliseReadings(rows: InsightFix[], heartbeatMaxS = HEARTBEAT_MAX_S): InsightFix[] {
  const bySubject = new Map<string, InsightFix[]>();
  for (const r of rows) {
    const list = bySubject.get(r.subject) ?? [];
    list.push(r); bySubject.set(r.subject, list);
  }
  const out: InsightFix[] = [];
  for (const list of bySubject.values()) {
    list.sort((a, b) => +a.ts - +b.ts);
    const kept: InsightFix[] = [], beats = new Set<InsightFix>();
    let lastSeen = -Infinity;
    for (const r of list) {
      if (!r.readingAgeS || r.readingAgeS < 0 || r.lat == null || r.lon == null) { kept.push(r); continue; }
      const seen = +r.ts - r.readingAgeS * 1000;
      if (Math.abs(seen - lastSeen) > 5_000) {
        while (kept.length && beats.has(kept.at(-1)!) && +kept.at(-1)!.ts > seen) kept.pop();
        lastSeen = seen;
        kept.push({ ...r, ts: new Date(seen), readingAgeS: 0 });
      } else if (r.readingAgeS <= heartbeatMaxS) {
        const beat: InsightFix = { ...r, readingAgeS: 0, speedKmh: 0, mode: 'still' };
        beats.add(beat); kept.push(beat);
      } else {
        kept.push({ ...r, lat: null, lon: null });
      }
    }
    out.push(...kept.sort((a, b) => +a.ts - +b.ts));
  }
  return out;
}

/** Trips far beyond a route's usual time missed their arrival (a stay the
 *  trail did not see) — they are shown, never averaged. */
export const BROKEN_TRIP_FACTOR = 3;

/** Durations of the trips that are not broken, judged against the median of all. */
export function cleanDurations(minutes: number[]): { clean: number[]; broken: boolean[] } {
  const median = percentile(minutes, 0.5);
  const broken = minutes.map(m => minutes.length >= 3 && m > median * BROKEN_TRIP_FACTOR);
  return { clean: minutes.filter((_, i) => !broken[i]), broken };
}

function routeKey(t: Trip) { return `${t.subject}:${t.from}:${t.to}:${t.mode}`; }
/** Match a fix to a historical polyline, returning progress and cross-track distance. */
function progressOn(f: Fix, path: Fix[]): { fraction: number; distance: number } {
  const scale = Math.cos(f.lat * Math.PI / 180), lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) { lengths.push(metresBetween(path[i - 1].lat, path[i - 1].lon, path[i].lat, path[i].lon)); total += lengths.at(-1)!; }
  let distance = Infinity, along = 0, before = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const ax = (a.lon - f.lon) * scale * 111_320, ay = (a.lat - f.lat) * 111_320;
    const bx = (b.lon - f.lon) * scale * 111_320, by = (b.lat - f.lat) * 111_320;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(ax + dx * t, ay + dy * t);
    if (d < distance) { distance = d; along = before + lengths[i - 1] * t; }
    before += lengths[i - 1];
  }
  return { fraction: total ? along / total : 0, distance };
}
export function predictArrival(active: Fix[], trips: Trip[], places: InsightPlace[], person: InsightPerson, now: Date): ArrivalInsight | null {
  const last = active.at(-1), previous = active.at(-2), first = active[0];
  if (!last || !previous || !first || +now - +last.ts > 3 * MINUTE || +now < +last.ts || !continuous(previous, last)
    || metresBetween(previous.lat, previous.lon, last.lat, last.lon) < 40) return null;
  const mode = (last.speedKmh ?? 0) > 18 || last.mode === 'vehicle' || last.mode === 'rail' ? 'vehicle' : 'active';
  const grouped = new Map<string, Trip[]>();
  for (const t of trips) {
    const delta = Math.abs(minuteOfDay(t.start) - minuteOfDay(+first.ts));
    if (t.subject !== person.subject || t.from !== first.placeId || t.mode !== mode || weekend(t.start) !== weekend(+first.ts)
      || Math.min(delta, 1440 - delta) > 90) continue;
    const list = grouped.get(t.to) ?? []; list.push(t); grouped.set(t.to, list);
  }
  const matches: Array<{ to: string; samples: Trip[]; fraction: number }> = [];
  for (const [to, samples] of grouped) {
    if (samples.length < 3) continue;
    const dest = places.find(p => p.id === to);
    if (!dest) continue;
    const before = metresBetween(previous.lat, previous.lon, dest.lat, dest.lon);
    const after = metresBetween(last.lat, last.lon, dest.lat, dest.lon);
    if (before - after < 20 || after < dest.radiusM) continue;
    const fits = samples.map(t => ({ current: progressOn(last, t.path), previous: progressOn(previous, t.path) }))
      .filter(p => p.current.distance <= Math.max(150, (last.accuracyM ?? 0) * 2) && p.current.fraction > p.previous.fraction + 0.005);
    if (fits.length < 3 || fits.length < samples.length * 0.6) continue;
    const fraction = percentile(fits.map(p => p.current.fraction), 0.5);
    if (fraction < 0.08 || fraction > 0.98) continue;
    matches.push({ to, samples, fraction });
  }
  // Two plausible destinations on the same road are ambiguity, not two notifications.
  if (matches.length !== 1) return null;
  const match = matches[0], durations = cleanDurations(match.samples.map(t => t.minutes)).clean;
  const elapsed = (+now - +first.ts) / MINUTE;
  const usual = percentile(durations, 0.5);
  if (elapsed > percentile(durations, 0.9) * 1.75) return null;
  const remaining = Math.max(1, usual * (1 - match.fraction) - (+now - +last.ts) / MINUTE);
  const low = Math.max(1, percentile(durations, 0.1) * (1 - match.fraction) - 2);
  const high = Math.max(remaining + 2, percentile(durations, 0.9) * (1 - match.fraction) + 2);
  const dest = places.find(p => p.id === match.to)!;
  return { id: `${person.subject}:${+first.ts}`, subject: person.subject, person: person.displayName,
    from: placeTitle(places.find(p => p.id === first.placeId)), to: placeTitle(dest), toId: dest.id,
    departedAt: first.ts.toISOString(), observedAt: last.ts.toISOString(), eta: new Date(+now + remaining * MINUTE).toISOString(),
    earliest: new Date(+now + Math.min(low, remaining) * MINUTE).toISOString(), latest: new Date(+now + high * MINUTE).toISOString(),
    minutesLeft: Math.round(remaining), samples: durations.length, confidence: durations.length >= 8 ? 'established' : 'emerging', returningHome: dest.kind === 'home' };
}
export function analysePresence(rows: InsightFix[], places: InsightPlace[], people: InsightPerson[], now: Date, days: number): PresenceInsights {
  const start = +now - days * DAY;
  rows = normaliseReadings(rows);
  const daily = new Map<string, { date: string; observed: number; wander: number; daylight: number }>();
  const legsByPerson = new Map<string, Leg[]>(), allTrips: Trip[] = [], activeByPerson = new Map<string, Fix[]>();
  const summaries: PersonInsight[] = [];
  for (const person of people) {
    const fixes = analysisFixes(rows.filter(f => f.subject === person.subject && +f.ts >= start && +f.ts <= +now), now);
    const { trips, active } = extractTrips(fixes, places, now); allTrips.push(...trips); activeByPerson.set(person.subject, active);
    const summary: PersonInsight = { ...person, observed: 0, coverage: 0, home: 0, away: 0, wander: 0, daylight: 0,
      stationary: 0, longestStill: 0, distanceKm: 0, places: 0, lastSeen: null };
    const visited = new Set<string>(), legs: Leg[] = [];
    let still = 0;
    for (let i = 0; i < fixes.length; i++) {
      const a = fixes[i], b = fixes[i + 1];
      if (usableFix(a, +now)) summary.lastSeen = a.ts.toISOString();
      if (!b || !usableFix(a, +now) || !usableFix(b, +now) || !continuous(a, b)) { still = 0; continue; }
      const distance = metresBetween(a.lat, a.lon, b.lat, b.lon), mins = (+b.ts - +a.ts) / MINUTE;
      const speed = distance / mins * 0.06;
      const moving = distance > STILL_RADIUS_M || (distance > Math.max(25, (a.accuracyM ?? 25) + (b.accuracyM ?? 25)) && (b.speedKmh ?? speed) >= 1.5);
      const active = moving && speed >= 1.5 && speed < 18 && !['vehicle', 'rail'].includes(b.mode ?? '') && (b.speedKmh ?? speed) < 18;
      const atHome = a.isHome === true && b.isHome === true;
      const away = a.isHome === false && b.isHome === false;
      summary.observed += mins;
      if (atHome) summary.home += mins;
      if (away) summary.away += mins;
      if (active && away) summary.wander += mins;
      if (!moving) { summary.stationary += mins; still += mins; summary.longestStill = Math.max(summary.longestStill, still); }
      else { still = 0; summary.distanceKm += distance / 1000; }
      const loc = located(a, places);
      if (!moving && loc.placeId) visited.add(loc.placeId);
      // Minute subdivisions handle sunrise and local midnight without crediting a whole long leg to one day.
      for (let t = +a.ts; t < +b.ts; t += MINUTE) {
        const end = Math.min(+b.ts, t + MINUTE), dt = (end - t) / MINUTE;
        const date = localDateOf((t + end) / 2);
        const d = daily.get(date) ?? { date, observed: 0, wander: 0, daylight: 0 };
        d.observed += dt;
        if (active && away) d.wander += dt;
        if (active && away && inDaylight((t + end) / 2, a.lat, a.lon)) { summary.daylight += dt; d.daylight += dt; }
        daily.set(date, d);
      }
      legs.push({ a, b, start: +a.ts, end: +b.ts, moving, active });
    }
    summary.coverage = summary.observed / (days * 1440);
    summary.places = visited.size;
    for (const key of ['observed', 'home', 'away', 'wander', 'daylight', 'stationary', 'longestStill', 'distanceKm'] as const) summary[key] = round(summary[key]);
    summaries.push(summary); legsByPerson.set(person.subject, legs);
  }
  // Sweep interval boundaries once. Shared minutes are union time, never the sum of all pairs.
  const events: Array<{ t: number; subject: string; leg: Leg | null }> = [];
  for (const [subject, legs] of legsByPerson) for (const leg of legs) { events.push({ t: leg.start, subject, leg }, { t: leg.end, subject, leg: null }); }
  events.sort((a, b) => a.t - b.t || Number(!!a.leg) - Number(!!b.leg));
  const active = new Map<string, Leg>(), groups = new Map<string, number>();
  let together = 0;
  for (let i = 0; i < events.length;) {
    const t = events[i].t;
    while (i < events.length && events[i].t === t) { const e = events[i++]; if (e.leg) active.set(e.subject, e.leg); else active.delete(e.subject); }
    const next = events[i]?.t;
    if (!next) break;
    const candidates = [...active.entries()].filter(([, l]) => (l.a.accuracyM ?? 0) <= 75 && (l.b.accuracyM ?? 0) <= 75);
    const remaining = [...candidates]; let shared = false;
    while (remaining.length) {
      const group = [remaining.shift()!];
      for (let k = remaining.length - 1; k >= 0; k--) {
        const candidate = remaining[k];
        if (group.every(([, l]) => metresBetween(l.a.lat, l.a.lon, candidate[1].a.lat, candidate[1].a.lon) <= 75
          && metresBetween(l.b.lat, l.b.lon, candidate[1].b.lat, candidate[1].b.lon) <= 75)) group.push(...remaining.splice(k, 1));
      }
      if (group.length >= 2) { const key = group.map(([s]) => s).sort().join('|'); groups.set(key, (groups.get(key) ?? 0) + (next - t) / MINUTE); shared = true; }
    }
    if (shared) together += (next - t) / MINUTE;
  }
  const routes = new Map<string, Trip[]>();
  for (const t of allTrips) { const key = routeKey(t), list = routes.get(key) ?? []; list.push(t); routes.set(key, list); }
  return { generatedAt: now.toISOString(), days, people: summaries, together: round(together),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)).map(d => ({ ...d, observed: round(d.observed), wander: round(d.wander), daylight: round(d.daylight) })),
    groups: [...groups].map(([key, minutes]) => ({ subjects: key.split('|'), names: key.split('|').map(s => people.find(p => p.subject === s)?.displayName ?? s), minutes: round(minutes) })).sort((a, b) => b.minutes - a.minutes),
    routes: [...routes].map(([id, list]): RouteInsight => {
      const first = list[0], { clean: values, broken } = cleanDurations(list.map(t => t.minutes));
      const morning = list.filter(t => minuteOfDay(t.start) >= 480 && minuteOfDay(t.start) < 540 && !weekend(t.start)).length;
      return { id, subject: first.subject, person: people.find(p => p.subject === first.subject)?.displayName ?? first.subject,
        fromId: first.from, toId: first.to, from: placeTitle(places.find(p => p.id === first.from)), to: placeTitle(places.find(p => p.id === first.to)),
        samples: list.length, average: round(values.reduce((a, b) => a + b, 0) / values.length), median: round(percentile(values, 0.5)),
        low: round(percentile(values, 0.1)), high: round(percentile(values, 0.9)), mode: first.mode,
        departure: hhmm(circularMedianMinute(list.map(t => minuteOfDay(t.start)))), morning,
        broken: broken.filter(Boolean).length,
        trips: list.map((t, i) => ({ start: new Date(t.start).toISOString(), minutes: round(t.minutes), broken: broken[i] })) };
    }).sort((a, b) => b.samples - a.samples),
    arrivals: people.map(p => predictArrival(activeByPerson.get(p.subject) ?? [], allTrips, places, p, now)).filter((a): a is ArrivalInsight => a != null) };
}
