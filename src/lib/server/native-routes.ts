import { deleteFromExtracted, getFromExtracted, postToExtracted } from './extracted-app';
import { downsample } from './native-trails';

/**
 * Planned routes, sized for a phone — the planner on /health/plan, reached from
 * the SR app.
 *
 * Same division of labour as `native-trails`: SR-Health plans, scores, grades
 * and stores; this module renames, turns `[lng, lat, ele]` round into the
 * `[lat, lng, ele]` a phone map takes, and thins what is only drawn. What is
 * FOLLOWED is not thinned below `ROUTE_FOLLOW_MAX` — the phone measures
 * progress and off-route distance against it, with no signal, and a stride
 * through a switchback puts a walker who is on the path 40 m off it.
 *
 * A candidate goes to the phone at full geometry because it comes back again:
 * saving one sends its geometry to Health, and a thinned copy would be saved
 * as a coarser route than the one that was planned and scored.
 */

// ——— upstream shapes (SR-Health, only the fields read here) ————————————————

/** `[lng, lat, ele?]` — SR-Health's `Coord`. */
type UpstreamCoord = [number, number] | [number, number, number | null];

interface Bounds {
  n: number;
  s: number;
  e: number;
  w: number;
}

export interface UpstreamScore {
  total: number;
  distanceScore: number;
  notes: string[];
  [key: string]: unknown;
}

export interface UpstreamPlannedRoute {
  rank: number;
  score: number;
  breakdown: UpstreamScore;
  distanceM: number;
  durationS: number;
  ascentM: number | null;
  descentM: number | null;
  coordinates: UpstreamCoord[];
}

export interface UpstreamPlanResult {
  routes: UpstreamPlannedRoute[];
  targetDistanceM: number;
  targetSource: 'requested' | 'training-load' | 'default';
  rationale: string[];
}

export interface UpstreamSavedRoute {
  id: string;
  name: string;
  sport: string;
  source: string;
  distanceM: number;
  ascentM: number | null;
  descentM: number | null;
  durationS: number | null;
  score: number | null;
  bounds: Bounds;
  createdAt: number | null;
  notes: string | null;
}

export interface UpstreamSavedRouteDetail extends UpstreamSavedRoute {
  coordinates: UpstreamCoord[];
  targetDistanceM: number | null;
  waypoints: Array<{ id: string; name: string; icon: string; lat: number; lng: number; note: string | null }>;
}

// ——— the phone's contract ——————————————————————————————————————————————————

/** `[lat, lng, elevationM | null]`. */
export type NativeRoutePoint = [number, number, number | null];

export interface NativeRouteCandidate {
  rank: number;
  /** 0–1, Health's loop-quality score. */
  score: number;
  /** Plain-language reasons from the scorer. */
  notes: string[];
  distanceM: number;
  durationS: number;
  ascentM: number | null;
  descentM: number | null;
  route: NativeRoutePoint[];
  /** Handed back untouched on save, so the saved route keeps its breakdown. */
  breakdown: UpstreamScore;
}

export interface NativeRoutePlan {
  candidates: NativeRouteCandidate[];
  targetDistanceM: number;
  targetSource: UpstreamPlanResult['targetSource'];
  rationale: string[];
}

export interface NativeRouteSummary {
  id: string;
  name: string;
  sport: string;
  source: string;
  distanceM: number;
  ascentM: number | null;
  descentM: number | null;
  durationS: number | null;
  score: number | null;
  createdAt: string | null;
  notes: string | null;
  bounds: Bounds;
}

export interface NativeRouteDetail extends NativeRouteSummary {
  route: NativeRoutePoint[];
  targetDistanceM: number | null;
  waypoints: UpstreamSavedRouteDetail['waypoints'];
}

export interface PlanInput {
  startLat: number;
  startLng: number;
  finishLat?: number;
  finishLng?: number;
  sport: string;
  targetDistanceM?: number;
  targetGainPerKm?: number;
  prefer?: 'steady' | 'spiky' | 'any';
  allowOutAndBack?: boolean;
}

export interface SaveInput {
  name: string;
  sport: string;
  route: number[][];
  distanceM?: number;
  ascentM?: number | null;
  descentM?: number | null;
  durationS?: number | null;
  score?: number | null;
  scoreBreakdown?: unknown;
  targetDistanceM?: number | null;
  notes?: string | null;
  source?: 'planned' | 'imported';
}

/** Enough for a 100 km loop at ~25 m spacing; Health's own geometry is rarely denser. */
export const ROUTE_FOLLOW_MAX = 4000;
export const ROUTES_LIST_MAX = 100;
export const SPORTS = ['run', 'trail_run', 'walk', 'hike', 'ride', 'mtb'] as const;

// ——— projection ————————————————————————————————————————————————————————————

/** Five decimal places of a degree is about a metre. */
function coord(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

function elevation(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

export function projectRoutePoints(points: readonly UpstreamCoord[] | null | undefined, max: number): NativeRoutePoint[] {
  return downsample(points ?? [], max).map(([lng, lat, ele]) => [coord(lat), coord(lng), elevation(ele)]);
}

function isoFromEpoch(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

export function projectPlan(upstream: UpstreamPlanResult): NativeRoutePlan {
  return {
    candidates: upstream.routes.map((r) => ({
      rank: r.rank,
      score: r.score,
      notes: r.breakdown?.notes ?? [],
      distanceM: Math.round(r.distanceM),
      durationS: Math.round(r.durationS),
      ascentM: r.ascentM === null ? null : Math.round(r.ascentM),
      descentM: r.descentM === null ? null : Math.round(r.descentM),
      route: projectRoutePoints(r.coordinates, ROUTE_FOLLOW_MAX),
      breakdown: r.breakdown,
    })),
    targetDistanceM: Math.round(upstream.targetDistanceM),
    targetSource: upstream.targetSource,
    rationale: upstream.rationale,
  };
}

export function projectSummary(row: UpstreamSavedRoute): NativeRouteSummary {
  return {
    id: row.id,
    name: row.name,
    sport: row.sport,
    source: row.source,
    distanceM: Math.round(row.distanceM),
    ascentM: row.ascentM,
    descentM: row.descentM,
    durationS: row.durationS,
    score: row.score,
    createdAt: isoFromEpoch(row.createdAt),
    notes: row.notes,
    bounds: row.bounds,
  };
}

export function projectDetail(row: UpstreamSavedRouteDetail): NativeRouteDetail {
  return {
    ...projectSummary(row),
    route: projectRoutePoints(row.coordinates, ROUTE_FOLLOW_MAX),
    targetDistanceM: row.targetDistanceM,
    waypoints: row.waypoints ?? [],
  };
}

// ——— checking what the phone sent ——————————————————————————————————————————

export function isSport(value: unknown): value is (typeof SPORTS)[number] {
  return typeof value === 'string' && (SPORTS as readonly string[]).includes(value);
}

function isLat(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
}

function isLng(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
}

function finite(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** A plan request, or the sentence to say back when it is not one. */
export function readPlanInput(body: unknown): PlanInput | string {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isLat(b.startLat) || !isLng(b.startLng)) return 'Set a start point first.';
  if (!isSport(b.sport)) return 'Pick a sport.';
  const input: PlanInput = { startLat: b.startLat, startLng: b.startLng, sport: b.sport };
  if (b.finishLat !== undefined || b.finishLng !== undefined) {
    if (!isLat(b.finishLat) || !isLng(b.finishLng)) return 'That finish point is not on the map.';
    input.finishLat = b.finishLat;
    input.finishLng = b.finishLng;
  }
  const target = finite(b.targetDistanceM);
  if (target !== undefined) {
    if (target < 500 || target > 100_000) return 'Pick a distance between 0.5 and 100 km.';
    input.targetDistanceM = target;
  }
  const gain = finite(b.targetGainPerKm);
  if (gain !== undefined) input.targetGainPerKm = Math.max(0, Math.min(gain, 200));
  if (b.prefer === 'steady' || b.prefer === 'spiky' || b.prefer === 'any') input.prefer = b.prefer;
  if (b.allowOutAndBack === true) input.allowOutAndBack = true;
  return input;
}

/** A save request turned round into Health's `[lng, lat, ele]`, or the sentence. */
export function readSaveInput(body: unknown): Record<string, unknown> | string {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isSport(b.sport)) return 'Pick a sport.';
  if (!Array.isArray(b.route) || b.route.length < 2) return 'A route needs at least two points.';
  if (b.route.length > ROUTE_FOLLOW_MAX) return 'That route has too many points to save.';
  const coordinates: [number, number, number | null][] = [];
  for (const p of b.route) {
    if (!Array.isArray(p) || !isLat(p[0]) || !isLng(p[1])) return 'That route has a point off the map.';
    coordinates.push([p[1], p[0], elevation(p[2])]);
  }
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 200) : '';
  return {
    name: name || 'Untitled route',
    sport: b.sport,
    coordinates,
    distanceM: finite(b.distanceM),
    ascentM: finite(b.ascentM) ?? null,
    descentM: finite(b.descentM) ?? null,
    durationS: finite(b.durationS) === undefined ? null : Math.round(b.durationS as number),
    score: finite(b.score) ?? null,
    scoreBreakdown: b.scoreBreakdown && typeof b.scoreBreakdown === 'object' ? b.scoreBreakdown : null,
    targetDistanceM: finite(b.targetDistanceM) ?? null,
    notes: typeof b.notes === 'string' ? b.notes.slice(0, 2000) : null,
    source: b.source === 'imported' ? 'imported' : 'planned',
  };
}

/** Health's saved-route ids are uuids; anything else never goes upstream. */
export function isRouteId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** The status Health answered with, when the lane failed on one. */
export function upstreamStatus(error: unknown): number | null {
  const match = error instanceof Error ? /returned (\d{3})\b/.exec(error.message) : null;
  return match ? Number(match[1]) : null;
}

// ——— the service-lane calls ————————————————————————————————————————————————

/** Up to eight sequential openrouteservice round trips for a loop. */
const PLAN_TIMEOUT_MS = 60_000;
const INTERPRET_TIMEOUT_MS = 20_000;
const DISCOVER_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 8000;

export async function planNativeRoute(input: PlanInput): Promise<NativeRoutePlan> {
  const upstream = await postToExtracted<UpstreamPlanResult>('health', '/api/trails/plan', input, {
    timeoutMs: PLAN_TIMEOUT_MS,
  });
  return projectPlan(upstream);
}

export function suggestNativeDistance(sport: string) {
  return getFromExtracted<{ configured: boolean; distanceM: number; source: string; rationale: string[] }>(
    'health',
    `/api/trails/plan?sport=${encodeURIComponent(sport)}`,
    { timeoutMs: READ_TIMEOUT_MS },
  );
}

export function interpretNativeRoute(text: string, focus?: { lat: number; lng: number }) {
  return postToExtracted<{
    parsed: Record<string, unknown>;
    start: { lat: number; lng: number; label: string } | null;
    finish: { lat: number; lng: number; label: string } | null;
    interpretation: string[];
  }>('health', '/api/trails/interpret', { text, focus }, { timeoutMs: INTERPRET_TIMEOUT_MS });
}

export function discoverNearby(lat: number, lng: number, sport: string) {
  const query = new URLSearchParams({ lat: String(lat), lng: String(lng), sport });
  return getFromExtracted<{ routes: unknown[] }>('health', `/api/trails/discover?${query}`, {
    timeoutMs: DISCOVER_TIMEOUT_MS,
  });
}

export async function discoverOne(osmId: number, sport: string) {
  const query = new URLSearchParams({ osmId: String(osmId), sport });
  const upstream = await getFromExtracted<{
    osmId: number;
    name: string;
    coordinates: UpstreamCoord[];
    distanceM: number;
    ascentM: number | null;
    difficulty: unknown;
  }>('health', `/api/trails/discover?${query}`, { timeoutMs: DISCOVER_TIMEOUT_MS });
  const { coordinates, ...rest } = upstream;
  return { ...rest, route: projectRoutePoints(coordinates, ROUTE_FOLLOW_MAX) };
}

export async function listNativeRoutes(): Promise<{ routes: NativeRouteSummary[] }> {
  const upstream = await getFromExtracted<{ routes: UpstreamSavedRoute[] }>('health', '/api/trails/routes', {
    timeoutMs: READ_TIMEOUT_MS,
  });
  return { routes: upstream.routes.slice(0, ROUTES_LIST_MAX).map(projectSummary) };
}

export async function getNativeRoute(id: string): Promise<NativeRouteDetail> {
  const upstream = await getFromExtracted<UpstreamSavedRouteDetail>(
    'health',
    `/api/trails/routes/${encodeURIComponent(id)}`,
    { timeoutMs: READ_TIMEOUT_MS },
  );
  return projectDetail(upstream);
}

export function saveNativeRoute(payload: Record<string, unknown>) {
  return postToExtracted<{ id: string }>('health', '/api/trails/routes', payload, { timeoutMs: READ_TIMEOUT_MS });
}

export function deleteNativeRoute(id: string) {
  return deleteFromExtracted<{ deleted: boolean }>('health', `/api/trails/routes/${encodeURIComponent(id)}`, {
    timeoutMs: READ_TIMEOUT_MS,
  });
}

// ——— a walked route ————————————————————————————————————————————————————————

/** 6 h at one point every 3 s; Health decimates to 3 m anyway. */
export const RECORDING_MAX_POINTS = 7200;

/**
 * A recording from the phone, checked and passed on in Health's own shape —
 * the track is already `[lng, lat, ele, secondsFromStart]`, Health's
 * `TrackPoint`, because Health is the only reader.
 */
export function readRecording(body: unknown): Record<string, unknown> | string {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.clientId !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(b.clientId)) return 'That walk has no id.';
  if (!isSport(b.sport)) return 'Pick a sport.';
  const started = finite(b.startedAt);
  const finished = finite(b.finishedAt);
  if (started === undefined || finished === undefined || finished < started) return 'That walk has no time.';
  if (!Array.isArray(b.track) || b.track.length < 2) return 'A walk needs at least two points.';
  if (b.track.length > RECORDING_MAX_POINTS) return 'That walk has too many points.';
  const track: [number, number, number | null, number][] = [];
  for (const p of b.track) {
    if (!Array.isArray(p) || !isLng(p[0]) || !isLat(p[1]) || finite(p[3]) === undefined) continue;
    track.push([p[0], p[1], elevation(p[2]), p[3] as number]);
  }
  if (track.length < 2) return 'A walk needs at least two points.';
  return {
    clientId: b.clientId.toLowerCase(),
    name: typeof b.name === 'string' ? b.name.slice(0, 200) : undefined,
    sport: b.sport,
    startedAt: started,
    finishedAt: finished,
    track,
    movingS: finite(b.movingS) ?? null,
    routeId: typeof b.routeId === 'string' && isRouteId(b.routeId) ? b.routeId : null,
  };
}

export function saveNativeRecording(payload: Record<string, unknown>) {
  return postToExtracted<{ activityId: string; distanceM: number; pointCount: number }>(
    'health',
    '/api/trails/recordings',
    payload,
    { timeoutMs: 20_000 },
  );
}

// ——— routes sent to a family member ——————————————————————————————————————

/**
 * Send one of the owner's saved routes to a family member's phone. The route
 * is copied at following precision, since the member cannot read it from
 * Health later. Only someone in the household with an address — the thing
 * their phone is paired as — can be sent one.
 */
export async function sendRouteGift(routeId: string, toSubject: string): Promise<{ id: string } | { error: string; status: number }> {
  const [{ listMembers }, { db }, { routeGift }, { randomBytes }] = await Promise.all([
    import('$lib/home/presence/members'),
    import('$lib/db'),
    import('$lib/db/schema'),
    import('node:crypto'),
  ]);
  const member = (await listMembers()).find((m) => m.subject === toSubject);
  if (!member?.email) return { error: 'They are not on the app.', status: 404 };
  const route = await getNativeRoute(routeId);
  const id = `gift-${randomBytes(9).toString('base64url')}`;
  await db.insert(routeGift).values({
    id,
    toSubject,
    toEmail: member.email.toLowerCase(),
    routeId,
    route: route as unknown as Record<string, unknown>,
  });
  return { id };
}
