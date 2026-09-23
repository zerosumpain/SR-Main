import { getFromExtracted } from './extracted-app';

/**
 * Activities and segments, sized for a phone.
 *
 * SR-Health owns every number here — the effective type (the owner's
 * correction, not the source's), the splits, the zones, the ranks, the form of
 * a segment. It answers with its own service objects over the service lane, and
 * this module does the one job that belongs to Main: turning those objects into
 * the contract the iPhone reads, and making them small enough to cross a mobile
 * connection.
 *
 * Nothing is recomputed. The only arithmetic is presentation-neutral: epoch
 * seconds become ISO strings, kilojoules become kilocalories, a track is thinned
 * to a drawable number of points, and a `[lng, lat]` tuple is turned round into
 * the `[lat, lng]` a map on the phone wants. Everything else is renamed or
 * dropped.
 */

// ——— upstream shapes (SR-Health's services, only the fields read here) ———————

/** [lng, lat, elevationM | null, secondsFromStart] — SR-Health's `TrackPoint`. */
type UpstreamPoint = [number, number, number | null, number];

interface UpstreamHighlight {
  label: string;
  detail: string;
}

export interface UpstreamActivityRow {
  id: string;
  name: string;
  activityType: string;
  startDate: number;
  startDateLocal: string;
  distanceM: number | null;
  durationS: number;
  activeDurationS: number | null;
  elevationGainM: number | null;
  avgHeartrate: number | null;
  maxHeartrate: number | null;
  avgPaceSPerKm: number | null;
  activeEnergyKj: number | null;
  hasTrack: boolean;
  temperatureC: number | null;
  efficiencyFactor: number | null;
  segmentCount: number;
  /** Present only if Health's list endpoint chose to include one. */
  highlight?: UpstreamHighlight | null;
  /**
   * Where the row came from — `apple`, or `companion` for an outing the SR app
   * captured in the background. Optional because an older Health omits it.
   */
  source?: string;
  /** Origins whose duplicate of this outing Health folded into this row. */
  alsoFrom?: string[];
}

export interface UpstreamActivityDetail extends UpstreamActivityRow {
  source: string;
  timezone: string | null;
  elevationLossM: number | null;
  avgCadence: number | null;
  coordinates: UpstreamPoint[] | null;
  bounds: { n: number; s: number; e: number; w: number } | null;
  elevation: Array<{ distanceM: number; elevationM: number }>;
  splits: Array<{
    index: number;
    distanceM: number;
    durationS: number;
    paceSPerKm: number | null;
    elevationGainM: number | null;
  }>;
  /** Samples are `[secondsFromStart, value]`. */
  series: Array<{ metric: string; units: string; samples: [number, number][] }>;
}

export interface UpstreamPhysio {
  trimp: number | null;
  ef: number | null;
  decouplingPct: number | null;
  hrr60: number | null;
  zones: { z0: number; z1: number; z2: number; z3: number; z4: number; z5: number } | null;
}

export interface UpstreamEffort {
  id: number;
  activityId: string;
  activityName: string;
  activityType: string;
  startedAt: number;
  durationS: number;
  distanceM: number;
  paceSPerKm: number | null;
  avgHeartrate: number | null;
  efficiencyFactor: number | null;
}

export interface UpstreamActivitySegment {
  segmentId: number;
  name: string;
  descriptor: string;
  segmentDistanceM: number;
  effortCount: number;
  effort: UpstreamEffort;
  rankByTime: number | null;
  rankedByTimeOf: number;
}

export interface UpstreamActivityResponse {
  activity: UpstreamActivityDetail;
  physio: UpstreamPhysio | null;
  segments: UpstreamActivitySegment[];
  highlights: UpstreamHighlight[];
}

export interface UpstreamSegmentRow {
  id: number;
  name: string;
  descriptor: string;
  activityType: string;
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  gradientPct: number;
  terrain: 'climb' | 'descent' | 'rolling' | 'flat';
  effortCount: number;
  lastEffortAt: number | null;
  bests: { durationS: number | null; paceSPerKm: number | null };
  form: {
    direction: string;
    deltaPct: number | null;
    daysSincePb: number | null;
    spark: number[];
    pbDurationS: number | null;
  } | null;
}

export interface UpstreamSegmentDetail extends UpstreamSegmentRow {
  /** [lng, lat, elevationM | null, metresFromSegmentStart] — distance, not time. */
  coordinates: UpstreamPoint[];
  efforts: UpstreamEffort[];
  conditions: { meanC: number | null; quickestC: number | null; slowestC: number | null } | null;
}

// ——— the phone's contract ——————————————————————————————————————————————————

export interface NativeActivityRow {
  id: string;
  name: string;
  activityType: string;
  startDate: string;
  startDateLocal: string;
  distanceM: number | null;
  durationS: number;
  movingS: number | null;
  elevationGainM: number | null;
  avgHeartrate: number | null;
  paceSPerKm: number | null;
  energyKcal: number | null;
  hasTrack: boolean;
  segmentCount: number;
  highlight: { label: string; detail: string } | null;
  /** `apple`, `companion`, … — null only from an older Health that did not say. */
  source: string | null;
  /** `['companion']` on a workout the SR app also caught; usually empty. */
  alsoFrom: string[];
}

export interface NativeActivityDetail {
  activity: Omit<NativeActivityRow, 'source'> & {
    maxHeartrate: number | null;
    avgCadence: number | null;
    elevationLossM: number | null;
    temperatureC: number | null;
    timezone: string | null;
    source: string;
    route: [number, number][];
    bounds: { n: number; s: number; e: number; w: number } | null;
    elevation: { d: number; e: number }[];
    heartRate: { t: number; v: number }[];
    splits: {
      index: number;
      distanceM: number;
      durationS: number;
      paceSPerKm: number | null;
      elevationGainM: number | null;
    }[];
  };
  physio: {
    trimp: number | null;
    efficiencyFactor: number | null;
    decouplingPct: number | null;
    hrr60: number | null;
    zones: { zone: 0 | 1 | 2 | 3 | 4 | 5; seconds: number }[];
  } | null;
  highlights: { label: string; detail: string }[];
  segments: {
    segmentId: number;
    name: string;
    descriptor: string;
    distanceM: number;
    durationS: number;
    paceSPerKm: number | null;
    avgHeartrate: number | null;
    rankByTime: number | null;
    rankedByTimeOf: number;
    effortCount: number;
  }[];
}

export interface NativeSegmentRow {
  id: number;
  name: string;
  descriptor: string;
  activityType: string;
  distanceM: number;
  elevationGainM: number;
  gradientPct: number;
  terrain: 'climb' | 'descent' | 'rolling' | 'flat';
  effortCount: number;
  lastEffortAt: string | null;
  bestDurationS: number | null;
  bestPaceSPerKm: number | null;
  form: { direction: string; deltaPct: number | null; daysSincePb: number | null; spark: number[] } | null;
}

export interface NativeSegmentDetail {
  segment: NativeSegmentRow & {
    route: [number, number][];
    elevationLossM: number;
    conditions: { meanC: number | null; quickestC: number | null; slowestC: number | null } | null;
  };
  efforts: {
    id: number;
    activityId: string;
    activityName: string;
    activityType: string;
    startedAt: string;
    durationS: number;
    paceSPerKm: number | null;
    avgHeartrate: number | null;
    efficiencyFactor: number | null;
    isBest: boolean;
  }[];
}

// ——— limits ————————————————————————————————————————————————————————————————

/** A phone map draws 600 points indistinguishably from 6,000. */
export const ACTIVITY_ROUTE_MAX = 600;
export const SEGMENT_ROUTE_MAX = 400;
export const ELEVATION_MAX = 200;
export const HEART_RATE_MAX = 300;
export const SEGMENT_EFFORTS_MAX = 100;

/** Health's own metric name for the per-second heart-rate stream. */
const HEART_RATE_METRIC = 'heart_rate';

/** Kilojoules to kilocalories: the thermochemical calorie, 4.184 J. */
const KJ_PER_KCAL = 4.184;

// ——— small pure helpers ————————————————————————————————————————————————————

/** Unix seconds to ISO 8601; null for anything that is not a real instant. */
export function isoFromEpoch(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

export function kcalFromKj(kj: number | null | undefined): number | null {
  if (kj === null || kj === undefined || !Number.isFinite(kj)) return null;
  return Math.round(kj / KJ_PER_KCAL);
}

/**
 * Keep at most `max` items, evenly spaced, always including the first and the
 * last.
 *
 * Stride sampling rather than a shape-preserving simplifier: every consumer on
 * the phone draws a line whose ends matter (start pin, finish pin, the last
 * heart-rate reading) and whose interior is far denser than a screen. Dropping
 * the last point would shorten a route on the map by up to a stride.
 */
export function downsample<T>(items: readonly T[], max: number): T[] {
  if (max <= 0) return [];
  if (items.length <= max) return items.slice();
  if (max === 1) return [items[0]];
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]);
  return out;
}

/** Five decimal places of a degree is about a metre — more is payload, not precision. */
function coord(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

/** `[lng, lat, …]` to the `[lat, lng]` a phone map takes, thinned to `max`. */
export function projectRoute(points: readonly UpstreamPoint[] | null | undefined, max: number): [number, number][] {
  if (!points?.length) return [];
  return downsample(points, max).map((p) => [coord(p[1]), coord(p[0])]);
}

function highlightOf(h: UpstreamHighlight): { label: string; detail: string } {
  return { label: h.label, detail: h.detail };
}

// ——— activities ————————————————————————————————————————————————————————————

export function projectActivityRow(row: UpstreamActivityRow): NativeActivityRow {
  return {
    id: row.id,
    name: row.name,
    activityType: row.activityType,
    // startDate is always set on an activity; an unparseable one would be a
    // data fault upstream, and an empty string reads as that on the phone
    // rather than crashing the whole list.
    startDate: isoFromEpoch(row.startDate) ?? '',
    startDateLocal: row.startDateLocal,
    distanceM: row.distanceM,
    durationS: row.durationS,
    movingS: row.activeDurationS,
    elevationGainM: row.elevationGainM,
    avgHeartrate: row.avgHeartrate,
    paceSPerKm: row.avgPaceSPerKm,
    energyKcal: kcalFromKj(row.activeEnergyKj),
    hasTrack: row.hasTrack,
    segmentCount: row.segmentCount,
    highlight: row.highlight ? highlightOf(row.highlight) : null,
    // Passed through untouched: the words for each origin are the phone's to
    // choose, and the list must say which rows are workouts and which the app
    // captured on its own.
    source: row.source ?? null,
    alsoFrom: Array.isArray(row.alsoFrom) ? row.alsoFrom : [],
  };
}

/**
 * One page of the list.
 *
 * `nextBefore` is the cursor for the next page — the start of the oldest row —
 * and only when a FULL page came back. A short page is the end of the history;
 * handing back a cursor there would cost the phone one more request to learn
 * what it already knows.
 */
export function projectActivityList(
  upstream: { rows: UpstreamActivityRow[] },
  limit: number,
): { activities: NativeActivityRow[]; nextBefore: string | null } {
  const activities = (upstream.rows ?? []).map(projectActivityRow);
  const last = activities.at(-1);
  return {
    activities,
    nextBefore: activities.length >= limit && last?.startDate ? last.startDate : null,
  };
}

export function projectActivityDetail(upstream: UpstreamActivityResponse): NativeActivityDetail {
  const a = upstream.activity;
  const hr = (a.series ?? []).find((s) => s.metric === HEART_RATE_METRIC);

  return {
    activity: {
      ...projectActivityRow(a),
      // The list row's highlight is the best of these; on the detail they all
      // arrive in `highlights`, so the row slot carries the lead one.
      highlight: upstream.highlights?.[0] ? highlightOf(upstream.highlights[0]) : a.highlight ? highlightOf(a.highlight) : null,
      maxHeartrate: a.maxHeartrate,
      avgCadence: a.avgCadence,
      elevationLossM: a.elevationLossM,
      temperatureC: a.temperatureC,
      timezone: a.timezone,
      source: a.source,
      route: projectRoute(a.coordinates, ACTIVITY_ROUTE_MAX),
      bounds: a.bounds,
      elevation: downsample(a.elevation ?? [], ELEVATION_MAX).map((s) => ({
        d: Math.round(s.distanceM),
        e: Math.round(s.elevationM * 10) / 10,
      })),
      heartRate: downsample(hr?.samples ?? [], HEART_RATE_MAX).map(([t, v]) => ({
        t: Math.round(t),
        v: Math.round(v),
      })),
      splits: (a.splits ?? []).map((s) => ({
        index: s.index,
        distanceM: s.distanceM,
        durationS: s.durationS,
        paceSPerKm: s.paceSPerKm ?? null,
        elevationGainM: s.elevationGainM ?? null,
      })),
    },
    physio: upstream.physio ? projectPhysio(upstream.physio) : null,
    highlights: (upstream.highlights ?? []).map(highlightOf),
    segments: (upstream.segments ?? []).map((s) => ({
      segmentId: s.segmentId,
      name: s.name,
      descriptor: s.descriptor,
      // The EFFORT's distance and time, not the segment's nominal length: the
      // row reads "you ran this stretch in …", and a lap can match a little
      // long or short of the reference geometry.
      distanceM: s.effort.distanceM,
      durationS: s.effort.durationS,
      paceSPerKm: s.effort.paceSPerKm,
      avgHeartrate: s.effort.avgHeartrate,
      rankByTime: s.rankByTime,
      rankedByTimeOf: s.rankedByTimeOf,
      effortCount: s.effortCount,
    })),
  };
}

const ZONES = [0, 1, 2, 3, 4, 5] as const;

export function projectPhysio(p: UpstreamPhysio): NonNullable<NativeActivityDetail['physio']> {
  return {
    trimp: p.trimp,
    efficiencyFactor: p.ef,
    decouplingPct: p.decouplingPct,
    hrr60: p.hrr60,
    zones: p.zones
      ? ZONES.map((zone) => ({ zone, seconds: Math.round(p.zones![`z${zone}`] ?? 0) }))
      : [],
  };
}

// ——— segments ——————————————————————————————————————————————————————————————

export function projectSegmentRow(row: UpstreamSegmentRow): NativeSegmentRow {
  return {
    id: row.id,
    name: row.name,
    descriptor: row.descriptor,
    activityType: row.activityType,
    distanceM: row.distanceM,
    elevationGainM: row.elevationGainM,
    gradientPct: row.gradientPct,
    terrain: row.terrain,
    effortCount: row.effortCount,
    lastEffortAt: isoFromEpoch(row.lastEffortAt),
    bestDurationS: row.bests?.durationS ?? null,
    bestPaceSPerKm: row.bests?.paceSPerKm ?? null,
    form: row.form
      ? {
          direction: row.form.direction,
          deltaPct: row.form.deltaPct,
          daysSincePb: row.form.daysSincePb,
          spark: row.form.spark ?? [],
        }
      : null,
  };
}

/**
 * Most recently ridden or run first, capped.
 *
 * Health's list is ordered for its own page; the phone's question is "what
 * have I been on lately", so the order is decided here. A segment never
 * completed sorts last rather than first — null is not "just now".
 */
export function projectSegmentList(
  upstream: { rows: UpstreamSegmentRow[] },
  limit: number,
): { segments: NativeSegmentRow[] } {
  const rows = (upstream.rows ?? [])
    .slice()
    .sort((a, b) => (b.lastEffortAt ?? -Infinity) - (a.lastEffortAt ?? -Infinity));
  return { segments: rows.slice(0, limit).map(projectSegmentRow) };
}

export function projectSegmentDetail(upstream: { segment: UpstreamSegmentDetail }): NativeSegmentDetail {
  const s = upstream.segment;
  // The all-time best; the form block carries the same PB and is the fallback
  // for a detail that came back without aggregated bests.
  const best = s.bests?.durationS ?? s.form?.pbDurationS ?? null;

  const efforts = (s.efforts ?? [])
    .slice()
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, SEGMENT_EFFORTS_MAX)
    .map((e) => ({
      id: e.id,
      activityId: e.activityId,
      activityName: e.activityName,
      activityType: e.activityType,
      startedAt: isoFromEpoch(e.startedAt) ?? '',
      durationS: e.durationS,
      paceSPerKm: e.paceSPerKm,
      avgHeartrate: e.avgHeartrate,
      efficiencyFactor: e.efficiencyFactor,
      isBest: best !== null && e.durationS === best,
    }));

  return {
    segment: {
      ...projectSegmentRow(s),
      route: projectRoute(s.coordinates, SEGMENT_ROUTE_MAX),
      elevationLossM: s.elevationLossM,
      conditions: s.conditions
        ? { meanC: s.conditions.meanC, quickestC: s.conditions.quickestC, slowestC: s.conditions.slowestC }
        : null,
    },
    efforts,
  };
}

// ——— ids, cursors, failures ————————————————————————————————————————————————

/** `apple:UUID`, `strava:123` — a source prefix and an opaque id. */
const ACTIVITY_ID = /^[a-z]+:[A-Za-z0-9._-]+$/;

export function isActivityId(id: string): boolean {
  return ACTIVITY_ID.test(id);
}

/** A positive integer in canonical form — `07` and `1e3` are not segment ids. */
export function parseSegmentId(raw: string): number | null {
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * The phone pages with an ISO instant; Health pages with epoch seconds.
 * Anything unparseable is treated as "no cursor" — the first page — rather than
 * an error, because a stale app sending a bad cursor should still see its list.
 */
export function beforeToEpoch(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * Whether the service lane failed because the thing does not exist.
 *
 * `extracted-app` reports a non-200 as "<app><path> returned <status>", and
 * that string is the only channel the status travels on. Everything else — a
 * timeout, a refused connection, a closed lane — is Health being down.
 */
export function isUpstreamNotFound(error: unknown): boolean {
  return error instanceof Error && /returned 404\b/.test(error.message);
}

// ——— the service-lane reads ————————————————————————————————————————————————

const LIST_TIMEOUT_MS = 6000;
/** The detail runs Health's physio and highlight enrichments; give it longer. */
const DETAIL_TIMEOUT_MS = 10_000;

export async function getNativeActivities(
  { limit, before }: { limit: number; before: number | null },
): Promise<{ activities: NativeActivityRow[]; nextBefore: string | null }> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (before !== null) query.set('before', String(before));
  const upstream = await getFromExtracted<{ rows: UpstreamActivityRow[]; total: number }>(
    'health',
    `/api/trails/activities?${query}`,
    { timeoutMs: LIST_TIMEOUT_MS },
  );
  return projectActivityList(upstream, limit);
}

export async function getNativeActivity(id: string): Promise<NativeActivityDetail> {
  const upstream = await getFromExtracted<UpstreamActivityResponse>(
    'health',
    `/api/trails/activities/${encodeURIComponent(id)}`,
    { timeoutMs: DETAIL_TIMEOUT_MS },
  );
  return projectActivityDetail(upstream);
}

export async function getNativeSegments({ limit }: { limit: number }): Promise<{ segments: NativeSegmentRow[] }> {
  const upstream = await getFromExtracted<{ rows: UpstreamSegmentRow[] }>('health', '/api/trails/segments', {
    timeoutMs: LIST_TIMEOUT_MS,
  });
  return projectSegmentList(upstream, limit);
}

export async function getNativeSegment(id: number): Promise<NativeSegmentDetail> {
  const upstream = await getFromExtracted<{ segment: UpstreamSegmentDetail }>(
    'health',
    `/api/trails/segments/${id}`,
    { timeoutMs: DETAIL_TIMEOUT_MS },
  );
  return projectSegmentDetail(upstream);
}
