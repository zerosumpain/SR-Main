// src/lib/home/presence/parent-alerts.server.ts
//
// Sends ./parent-alerts' notices: a child stopped somewhere, a child not at
// school when they usually are — and ./journey-alerts' "arrived safely" after
// anyone's drive or train journey, to everyone who follows them, which
// replaces the "stopped" a guardian would have had for that trip. Runs on every home-observe (120 s), after the
// stops of that run are discovered, so a new spot is already a place.
//
// Push only, no app pull queue: these are worth a banner now or not at all.
// Each notice is sent once per guardian, recorded in app_settings under
// `home.presence.parents.<subject>`; one a phone did not take is retried each
// run until its `until`.

import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings, daydreamPlaces, daydreamTrail, householdEvent } from '$lib/db/schema';
import { isApnsConfigured } from '$lib/server/apns';
import { emit as emitPlatformEvent } from '$lib/events/platform-bus';
import { familyAlertPayload, firstInWindow } from '$lib/events/payloads';
import { pushToEmails } from '$lib/server/push-devices';
import { loadForecast } from './forecast.server';
import { listMembers } from './members';
import { arrivalTold, guardiansByChild, schoolLateNotices, stopNotices, STOP_WINDOW_MINS, toldForTrip, travelledWith, type ArrivalPushed, type ParentNotice } from './parent-alerts';
import { journeyNotices } from './journey-alerts.server';
import { recentTrips } from './journey-alerts';
import { getHold, ownerSubjects } from './location-hold.server';
import type { JourneyNotice } from './journey-alerts';

/** Notices remembered per child: far more than a day of stops. */
const KEEP = 60;

interface Sent { [id: string]: { to: string[]; until: number } }

export async function deliverParentAlerts(now = new Date(), push = pushToEmails): Promise<{ sent: number; owed: number }> {
  if (!isApnsConfigured()) return { sent: 0, owed: 0 };
  const members = await listMembers();
  const guardians = guardiansByChild(members);
  const [{ forecast, insights, cal }, places] = await Promise.all([
    loadForecast({ kind: 'owner' }, 28, null, now),
    db.select().from(daydreamPlaces).where(eq(daydreamPlaces.status, 'active')),
  ]);
  const names = new Map(insights.people.map((p) => [p.subject, p.displayName]));
  // Each child's last position, however old: one far from school is no school run.
  const positions = new Map<string, { lat: number; lon: number }>();
  await Promise.all([...guardians.keys()].map(async (subject) => {
    const [last] = await db.select({ lat: daydreamTrail.lat, lon: daydreamTrail.lon }).from(daydreamTrail)
      .where(and(eq(daydreamTrail.subject, subject), isNotNull(daydreamTrail.lat), isNotNull(daydreamTrail.lon)))
      .orderBy(desc(daydreamTrail.ts)).limit(1);
    if (last?.lat != null && last.lon != null) positions.set(subject, { lat: last.lat, lon: last.lon });
  }));
  // Never anyone held (`location-hold`): their real trips must not be told.
  const held = (await getHold(now)) ? new Set(ownerSubjects(members)) : new Set<string>();
  const journeys = await journeyNotices({ routes: insights.routes.filter((r) => !held.has(r.subject)), places, members, names, now })
    .catch((err) => { console.warn('[parent-alerts] journeys:', (err as Error).message); return [] as JourneyNotice[]; });
  // Arrivals already pushed (alerts.ts): somebody told "arrived at School"
  // is not told "stopped at School" or "arrived safely at School" for the
  // same trip.
  const children = [...new Set([...guardians.keys(), ...journeys.map((j) => j.subject)])];
  const arrivals: ArrivalPushed[] = children.length
    ? (
        await db
          .select({ subject: householdEvent.subject, placeId: householdEvent.placeId, at: householdEvent.at, pushedTo: householdEvent.pushedTo })
          .from(householdEvent)
          .where(and(
            inArray(householdEvent.subject, children),
            eq(householdEvent.kind, 'arrive'),
            // A trip's start can be well before its end; a day back covers the longest.
            gte(householdEvent.at, new Date(+now - (STOP_WINDOW_MINS + 24 * 60) * 60_000)),
          ))
      ).map((r) => ({ subject: r.subject, placeId: r.placeId, at: +r.at, to: Array.isArray(r.pushedTo) ? (r.pushedTo as string[]) : [] }))
    : [];
  // One notice per arrival, and none to whoever was on the trip.
  const trips = new Map(recentTrips(insights.routes, now).map((t) => [`${t.route.subject}-${t.arrived}`, t]));
  const subjectOf = new Map(members.filter((m) => m.email).map((m) => [m.email!.trim().toLowerCase(), m.subject]));
  const withoutCompanions = <N extends ParentNotice | JourneyNotice>(n: N, tripKey: string): N => {
    const trip = trips.get(tripKey);
    if (!trip) return n;
    const along = travelledWith(insights.routes, insights.live, n.subject, trip.route.toId, trip.arrived);
    return { ...n, recipients: n.recipients.filter((r) => !along.has(subjectOf.get(r) ?? '')) };
  };
  const told = journeys
    .map((j) => {
      const trip = trips.get(j.trip);
      const heard = trip ? arrivalTold(arrivals, j.subject, trip.route.toId, trip.left, trip.arrived) : [];
      return withoutCompanions({ ...j, recipients: j.recipients.filter((r) => !heard.includes(r)) }, j.trip);
    });
  // What the journeys cover is everyone they were FOR, companions and those
  // an arrival reached included: none of them is owed a "stopped" instead.
  const covered = new Map(journeys.map((j) => [j.trip, j.recipients]));
  const notices: Array<ParentNotice | JourneyNotice> = [
    ...told,
    ...stopNotices({ routes: insights.routes, places, guardians, names, now, covered, arrivals })
      .map((n) => withoutCompanions(n, n.id.slice('stop-'.length))),
    ...schoolLateNotices({ routines: forecast.routines, live: insights.live, places, guardians, names, cal, now, positions }),
  ].filter((n) => n.recipients.length > 0);
  let sent = 0, owed = 0;
  for (const n of notices) {
    if (+now > n.until) continue;
    let first = false;
    await db.transaction(async (tx) => {
      const key = `home.presence.parents.${n.subject}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      const [row] = await tx.select().from(appSettings).where(eq(appSettings.key, key));
      const record: Sent = (row?.value as Sent | undefined) ?? {};
      // Under this id, or the same trip's under an end that has since moved.
      const done = new Set(toldForTrip(record, n.id));
      const pending = n.recipients.filter((r) => !done.has(r));
      if (!pending.length) return;
      const ttl = Math.max(60, Math.min(n.push.ttlSeconds ?? 1800, Math.floor((n.until - +now) / 1000)));
      const outcome = await push(pending, { ...n.push, ttlSeconds: ttl });
      for (const r of pending) if (outcome.reached.has(r)) done.add(r);
      if (pending.some((r) => !done.has(r))) owed++;
      if (!pending.some((r) => done.has(r))) return;
      sent++;
      // The first run to reach anyone; a later one reaching the rest is the same alert.
      first = !record[n.id]?.to?.length;
      record[n.id] = { to: [...done], until: n.until };
      // Oldest out: a child's record never grows past a few days of stops.
      const kept = Object.entries(record).sort((a, b) => b[1].until - a[1].until).slice(0, KEEP);
      const value = Object.fromEntries(kept);
      await tx.insert(appSettings).values({ key, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    });
    // After the record commits, and once: an event for an alert that rolled back would be a lie.
    const person = names.get(n.subject) ?? members.find((m) => m.subject === n.subject)?.displayName;
    if (first && person && firstInWindow(`family.alert:${n.id}`, 24 * 60 * 60_000)) {
      emitPlatformEvent(
        'family.alert',
        // The notice's own event wording, never the push title: that one may
        // name a looked-up label (a street), which is for the family's phones only.
        familyAlertPayload({ kind: n.kind, person, place: n.place, title: n.eventTitle || `${person}: ${n.kind}` }),
        { source: 'family-alerts' },
      );
    }
  }
  return { sent, owed };
}
