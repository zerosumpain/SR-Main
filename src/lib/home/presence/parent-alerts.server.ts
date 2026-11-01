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

import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings, daydreamPlaces, daydreamTrail } from '$lib/db/schema';
import { isApnsConfigured } from '$lib/server/apns';
import { pushToEmails } from '$lib/server/push-devices';
import { loadForecast } from './forecast.server';
import { listMembers } from './members';
import { guardiansByChild, schoolLateNotices, stopNotices, type ParentNotice } from './parent-alerts';
import { journeyNotices } from './journey-alerts.server';
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
  const journeys = await journeyNotices({ routes: insights.routes, places, members, names, now });
  const covered = new Map(journeys.map((j) => [j.trip, j.recipients]));
  const notices: Array<ParentNotice | JourneyNotice> = [
    ...journeys,
    ...stopNotices({ routes: insights.routes, places, guardians, names, now, covered }),
    ...schoolLateNotices({ routines: forecast.routines, live: insights.live, places, guardians, names, cal, now, positions }),
  ];
  let sent = 0, owed = 0;
  for (const n of notices) {
    if (+now > n.until) continue;
    await db.transaction(async (tx) => {
      const key = `home.presence.parents.${n.subject}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      const [row] = await tx.select().from(appSettings).where(eq(appSettings.key, key));
      const record: Sent = (row?.value as Sent | undefined) ?? {};
      const done = new Set(record[n.id]?.to ?? []);
      const pending = n.recipients.filter((r) => !done.has(r));
      if (!pending.length) return;
      const ttl = Math.max(60, Math.min(n.push.ttlSeconds ?? 1800, Math.floor((n.until - +now) / 1000)));
      const outcome = await push(pending, { ...n.push, ttlSeconds: ttl });
      for (const r of pending) if (outcome.reached.has(r)) done.add(r);
      if (pending.some((r) => !done.has(r))) owed++;
      if (!pending.some((r) => done.has(r))) return;
      sent++;
      record[n.id] = { to: [...done], until: n.until };
      // Oldest out: a child's record never grows past a few days of stops.
      const kept = Object.entries(record).sort((a, b) => b[1].until - a[1].until).slice(0, KEEP);
      const value = Object.fromEntries(kept);
      await tx.insert(appSettings).values({ key, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    });
  }
  return { sent, owed };
}
