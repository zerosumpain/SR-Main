// Saved planned routes — the read/write side of /trails/routes.

import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { plannedRoutes, routeWaypoints } from '$lib/db/schema';
import { encodePolyline } from '$lib/health/polyline';
import { trackBounds, trackDistanceM, type TrackPoint } from './track';
import { elevationDelta } from './track';
import type { Coord, RouteScore } from './scoring';

export interface SaveRouteInput {
  name: string;
  sport: string;
  coordinates: Coord[];
  distanceM?: number;
  ascentM?: number | null;
  descentM?: number | null;
  durationS?: number | null;
  score?: number | null;
  scoreBreakdown?: RouteScore | null;
  targetDistanceM?: number | null;
  notes?: string | null;
  source?: 'planned' | 'imported';
}

export interface SavedRoute {
  id: string;
  name: string;
  sport: string;
  source: string;
  distanceM: number;
  ascentM: number | null;
  descentM: number | null;
  durationS: number | null;
  score: number | null;
  polyline: string | null;
  bounds: { n: number; s: number; e: number; w: number };
  createdAt: number | null;
  notes: string | null;
}

export interface SavedRouteDetail extends SavedRoute {
  coordinates: Coord[];
  scoreBreakdown: RouteScore | null;
  targetDistanceM: number | null;
  waypoints: Array<{
    id: string;
    name: string;
    icon: string;
    lat: number;
    lng: number;
    note: string | null;
  }>;
}

/** Coord[] carries no timestamps; the track helpers want the 4-tuple shape. */
function asTrackPoints(coords: Coord[]): TrackPoint[] {
  return coords.map(([lng, lat, ele]) => [lng, lat, ele ?? null, 0] as TrackPoint);
}

export async function saveRoute(input: SaveRouteInput): Promise<string> {
  if (!input.coordinates || input.coordinates.length < 2) {
    throw new Error('A route needs at least two points');
  }

  const points = asTrackPoints(input.coordinates);
  const id = randomUUID();
  const elevation = elevationDelta(points);

  await db.insert(plannedRoutes).values({
    id,
    name: input.name.trim() || 'Untitled route',
    sport: input.sport,
    source: input.source ?? 'planned',
    coordinates: input.coordinates,
    bounds: trackBounds(points),
    polyline: encodePolyline(points.map(([lng, lat]) => [lat, lng] as [number, number])),
    // Trust the router's distance when it gave one — it measured the graph,
    // not our decimated copy of it.
    distanceM: input.distanceM ?? trackDistanceM(points),
    ascentM: input.ascentM ?? elevation.gainM,
    descentM: input.descentM ?? elevation.lossM,
    // duration_s is an integer column and ORS durations are floats — an
    // unrounded 3070.9 fails the whole insert at the database.
    durationS: input.durationS != null ? Math.round(input.durationS) : null,
    score: input.score ?? null,
    scoreBreakdown: input.scoreBreakdown ?? null,
    targetDistanceM: input.targetDistanceM ?? null,
    notes: input.notes ?? null,
  });

  return id;
}

export async function listRoutes(limit = 100): Promise<SavedRoute[]> {
  const rows = await db
    .select({
      id: plannedRoutes.id,
      name: plannedRoutes.name,
      sport: plannedRoutes.sport,
      source: plannedRoutes.source,
      distanceM: plannedRoutes.distanceM,
      ascentM: plannedRoutes.ascentM,
      descentM: plannedRoutes.descentM,
      durationS: plannedRoutes.durationS,
      score: plannedRoutes.score,
      polyline: plannedRoutes.polyline,
      bounds: plannedRoutes.bounds,
      createdAt: plannedRoutes.createdAt,
      notes: plannedRoutes.notes,
    })
    .from(plannedRoutes)
    .orderBy(desc(plannedRoutes.createdAt))
    .limit(limit);

  return rows as SavedRoute[];
}

export async function getRoute(id: string): Promise<SavedRouteDetail | null> {
  const [row] = await db.select().from(plannedRoutes).where(eq(plannedRoutes.id, id)).limit(1);
  if (!row) return null;

  const waypoints = await db
    .select()
    .from(routeWaypoints)
    .where(eq(routeWaypoints.routeId, id));

  return {
    id: row.id,
    name: row.name,
    sport: row.sport,
    source: row.source,
    distanceM: row.distanceM,
    ascentM: row.ascentM,
    descentM: row.descentM,
    durationS: row.durationS,
    score: row.score,
    polyline: row.polyline,
    bounds: row.bounds as SavedRoute['bounds'],
    createdAt: row.createdAt,
    notes: row.notes,
    coordinates: row.coordinates as Coord[],
    scoreBreakdown: (row.scoreBreakdown as RouteScore | null) ?? null,
    targetDistanceM: row.targetDistanceM,
    waypoints: waypoints.map((w) => ({
      id: w.id,
      name: w.name,
      icon: w.icon,
      lat: w.lat,
      lng: w.lng,
      note: w.note,
    })),
  };
}

export async function deleteRoute(id: string): Promise<boolean> {
  const deleted = await db.delete(plannedRoutes).where(eq(plannedRoutes.id, id)).returning({
    id: plannedRoutes.id,
  });
  return deleted.length > 0;
}

export async function addWaypoint(input: {
  routeId: string;
  name: string;
  icon?: string;
  lat: number;
  lng: number;
  note?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(routeWaypoints).values({
    id,
    routeId: input.routeId,
    name: input.name.trim() || 'Waypoint',
    icon: input.icon ?? 'custom',
    lat: input.lat,
    lng: input.lng,
    note: input.note ?? null,
  });
  return id;
}

export async function deleteWaypoint(id: string): Promise<boolean> {
  const deleted = await db.delete(routeWaypoints).where(eq(routeWaypoints.id, id)).returning({
    id: routeWaypoints.id,
  });
  return deleted.length > 0;
}
