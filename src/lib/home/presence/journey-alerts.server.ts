// src/lib/home/presence/journey-alerts.server.ts
//
// The data ./journey-alerts needs for each trip that just ended: its trail
// rows (distance, top speed, drive or train) and the mover's harsh braking
// and acceleration (./drive.server). Sent by ./parent-alerts.server.

import { and, asc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamTrail } from '$lib/db/schema';
import { pilotRecipients } from './alerts';
import { eventsBetween } from './drive';
import { loadDriveState } from './drive.server';
import type { InsightPlace, RouteInsight } from './insights';
import { journeyNotice, recentTrips, tripStats, type JourneyNotice } from './journey-alerts';
import type { HouseholdMember } from './members';

/** One "arrived safely" per drive or train trip that ended in the stop window. */
export async function journeyNotices(input: {
  routes: readonly RouteInsight[];
  places: readonly InsightPlace[];
  members: readonly HouseholdMember[];
  names: ReadonlyMap<string, string>;
  now: Date;
}): Promise<JourneyNotice[]> {
  const { routes, places, members, names, now } = input;
  const out: JourneyNotice[] = [];
  for (const trip of recentTrips(routes, now)) {
    const recipients = pilotRecipients(members, trip.route.subject);
    if (!recipients.length) continue;
    const rows = await db
      .select({ ts: daydreamTrail.ts, lat: daydreamTrail.lat, lon: daydreamTrail.lon, accuracyM: daydreamTrail.accuracyM, speedKmh: daydreamTrail.speedKmh, mode: daydreamTrail.mode })
      .from(daydreamTrail)
      .where(and(
        eq(daydreamTrail.subject, trip.route.subject),
        gte(daydreamTrail.ts, new Date(trip.left)),
        lte(daydreamTrail.ts, new Date(trip.arrived)),
        isNotNull(daydreamTrail.lat),
        isNotNull(daydreamTrail.lon),
      ))
      .orderBy(asc(daydreamTrail.ts));
    const fixes = rows.map((r) => ({ ts: +r.ts, lat: r.lat as number, lon: r.lon as number, accuracyM: r.accuracyM, speedKmh: r.speedKmh, mode: r.mode }));
    const stats = tripStats(fixes, {
      from: places.find((p) => p.id === trip.route.fromId),
      to: places.find((p) => p.id === trip.route.toId),
    });
    if (!stats.mode) continue;
    const events = stats.mode === 'drive' ? eventsBetween((await loadDriveState(trip.route.subject)).events, trip.left, trip.arrived) : [];
    const notice = journeyNotice({ trip, stats, events, places, recipients, name: names.get(trip.route.subject) ?? trip.route.person });
    if (notice) out.push(notice);
  }
  return out;
}
