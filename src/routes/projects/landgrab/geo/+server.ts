// One region's history — the drawer behind a tap on the territory map.
//
// The SAME guard as the page beside it. /projects is a public PREFIX in
// PUBLIC_PATHS, so this function is the entire gate on this route too: the
// owner check is the FIRST statement, before the cache header and before any
// query, so an anonymous request leaves no trace in the ledger and gets no
// cacheable response.

import { error, json } from '@sveltejs/kit';
import { and, inArray, lte, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { isOwnerRequest } from '$lib/server/owner';
import { db } from '$lib/db';
import { geoCaptureEvents } from '$lib/db/schema';
import { activityTypeNotIn } from '$lib/geo/service';
import { connectedComponents } from '$lib/geo/dissolve';
import { regionHistory } from '$lib/geo/history';
import { tileCentre, tileKeyOf, type Tile } from '$lib/geo/tiles';
import type { CaptureEvent, CaptureKind } from '$lib/geo/ownership';
import { parseFilter, resolveBoard } from '../query.server';
import { nameFor } from '../names.server';
import type { RegionHistory } from '../types';

/** Coordinate precision in the payload. 5 dp is ~1.1 m; cells are 44 m. */
const COORD_DP = 5;

export const GET: RequestHandler = async (event) => {
  if (!(await isOwnerRequest(event))) throw error(404, 'Not found');
  event.setHeaders({ 'cache-control': 'private, no-store' });

  // The raw strings first: `Number(null)` and `Number('')` are both 0, so a
  // request with no x/y at all would otherwise be answered as a tap on tile
  // (0, 0) — a real cell in the Atlantic, and a 404 that reads like "no ground
  // here" rather than "you forgot the arguments".
  const rawX = event.url.searchParams.get('x')?.trim() ?? '';
  const rawY = event.url.searchParams.get('y')?.trim() ?? '';
  const x = Number(rawX);
  const y = Number(rawY);
  if (!rawX || !rawY || !Number.isInteger(x) || !Number.isInteger(y)) {
    throw error(400, 'x and y required');
  }

  const now = new Date();
  const filter = await parseFilter(event.url);
  const board = await resolveBoard(filter, now);

  // The tapped cell, or one of its eight neighbours — a tap lands between
  // smoothed rings as often as on one.
  let hit = board.ownedNow.get(tileKeyOf(x, y)) ?? null;
  if (!hit) {
    for (let dx = -1; dx <= 1 && !hit; dx++) {
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        hit = board.ownedNow.get(tileKeyOf(x + dx, y + dy)) ?? null;
      }
    }
  }
  if (!hit) return json({ error: 'no ground here' }, { status: 404 });
  const found = hit;

  const subject = found.owner;
  const mine: Tile[] = [];
  for (const o of board.ownedNow.values()) if (o.owner === subject) mine.push({ x: o.tileX, y: o.tileY });
  const component = connectedComponents(mine).find((c) =>
    c.some((t) => t.x === found.tileX && t.y === found.tileY),
  );
  if (!component) return json({ error: 'no ground here' }, { status: 404 });
  const keys = new Set(component.map((t) => tileKeyOf(t.x, t.y)));

  // Every event in the component's bbox under the activity + subject filter —
  // NOT the window. History is history; the drawer says so.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const t of component) {
    minX = Math.min(minX, t.x);
    maxX = Math.max(maxX, t.x);
    minY = Math.min(minY, t.y);
    maxY = Math.max(maxY, t.y);
  }
  const where = [
    sql`${geoCaptureEvents.tileX} between ${minX} and ${maxX}`,
    sql`${geoCaptureEvents.tileY} between ${minY} and ${maxY}`,
    lte(geoCaptureEvents.capturedAt, now),
    filter.baseFilter.excludeActivityTypes?.length
      ? activityTypeNotIn(geoCaptureEvents.activityType, filter.baseFilter.excludeActivityTypes)
      : undefined,
    filter.baseFilter.excludeUntyped ? sql`${geoCaptureEvents.activityType} is not null` : undefined,
    filter.baseFilter.subjects?.length
      ? inArray(geoCaptureEvents.subject, filter.baseFilter.subjects)
      : undefined,
  ].filter((p): p is Exclude<typeof p, undefined> => p !== undefined);
  const rows = await db
    .select({
      subject: geoCaptureEvents.subject,
      tileX: geoCaptureEvents.tileX,
      tileY: geoCaptureEvents.tileY,
      day: geoCaptureEvents.day,
      kind: geoCaptureEvents.kind,
      weight: geoCaptureEvents.weight,
      capturedAt: geoCaptureEvents.capturedAt,
    })
    .from(geoCaptureEvents)
    .where(and(...where));
  const events: CaptureEvent[] = rows.map((r) => ({ ...r, kind: r.kind as CaptureKind }));

  const core = regionHistory(events, keys, now);

  let since: number | null = null;
  let latSum = 0;
  let lonSum = 0;
  for (const t of component) {
    const o = board.ownedNow.get(tileKeyOf(t.x, t.y));
    if (o && (since === null || o.ownerSince.getTime() < since)) since = o.ownerSince.getTime();
    const c = tileCentre(t.x, t.y);
    latSum += c.lat;
    lonSum += c.lon;
  }
  const round = (n: number) => Math.round(n * 10 ** COORD_DP) / 10 ** COORD_DP;
  const centre: [number, number] = [
    round(latSum / component.length),
    round(lonSum / component.length),
  ];
  // The tile-key string order, matching `findBattlegrounds`' `id` convention —
  // the drawer and the map name the same region the same way.
  const anchor = [...keys].sort()[0];

  const out: RegionHistory = {
    anchor,
    subject,
    cells: component.length,
    areaM2: component.length * board.cellAreaM2,
    centre,
    since: since === null ? null : new Date(since).toISOString(),
    name: await nameFor(centre, { uncached: 1 }),
    ...core,
  };
  return json(out);
};
