// src/lib/home/presence/forecast-digest.server.ts
//
// The weekly picture behind /home/people's Forecast tab and the /home card:
// what changed in the family's movements (`changes.ts`) and each person's
// week of health from the app (`health-week.ts`). Built nightly for the whole
// household and kept in app_settings; the page scopes it per viewer — the
// owner sees everyone, a member themselves (and their movements as the
// people page already allows).

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamTrail } from '$lib/db/schema';
import { getSetting, setSetting } from '$lib/server/models/settings';
import { whatChanged, type Change } from './changes';
import { pilotDay } from './companion-accounts';
import { dayBounds } from './day-timeline';
import { localClock } from './forecast';
import { loadSchoolCalendar } from './forecast.server';
import { weekHealth, type HealthDay, type WeekHealth } from './health-week';
import { loadPresenceInsights } from './insights.server';
import { listMembers } from './members';

export const DIGEST_KEY = 'home.forecast.digest';
/** History the changes are read over: the fortnight against the six weeks before. */
export const DIGEST_DAYS = 56;
const HEALTH_DAYS = 7;

export interface StoredDigest {
  generatedAt: string;
  changes: Change[];
  /** By subject. Absent: no app account, or nothing uploaded. */
  health: Record<string, WeekHealth & { from: string; to: string }>;
}

export const loadDigest = () => getSetting<StoredDigest>(DIGEST_KEY).catch(() => null);

/** Minutes BEHIND UTC on a local date, as `dayBounds` wants them (BST is -60). */
function offsetOn(date: string): number {
  const noon = Date.parse(`${date}T12:00:00Z`);
  return -(localClock(noon).minute - 12 * 60);
}

/** When each app user's current tracker began: their first app fix. */
async function trackedSince(subjects: string[]): Promise<Map<string, number>> {
  if (!subjects.length) return new Map();
  const rows = await db
    .select({ subject: daydreamTrail.subject, first: sql<string>`min(${daydreamTrail.ts})` })
    .from(daydreamTrail)
    .where(and(eq(daydreamTrail.source, 'companion'), inArray(daydreamTrail.subject, subjects)))
    .groupBy(daydreamTrail.subject);
  return new Map(rows.map((r) => [r.subject, Date.parse(r.first)]));
}

/** One person's last seven local days from the pilot. Null: no account, or the pilot could not answer. */
async function healthOf(email: string, now: Date): Promise<(WeekHealth & { from: string; to: string }) | null> {
  const days: HealthDay[] = [];
  for (let i = HEALTH_DAYS; i >= 1; i--) {
    const date = localClock(+now - i * 86_400_000).date;
    const tz = offsetOn(date);
    const [from, to] = dayBounds(date, tz);
    const r = await pilotDay(email, { from, to, tz });
    if (!r.ok) {
      if (r.reason === 'not-found') return null;
      continue;
    }
    days.push({ date, from, to, timeline: r.value.timeline });
  }
  if (!days.length) return null;
  const week = weekHealth(days);
  if (week.stepDays === 0 && week.nights === 0 && week.workouts === 0) return null;
  return { ...week, from: days[0].date, to: days.at(-1)!.date };
}

export async function runDigest(now = new Date()): Promise<StoredDigest> {
  const members = (await listMembers()).filter((m) => m.source !== 'none');
  const [insights, cal, since] = await Promise.all([
    loadPresenceInsights({ kind: 'owner' }, DIGEST_DAYS, null, now),
    loadSchoolCalendar(),
    trackedSince(members.filter((m) => m.source === 'companion').map((m) => m.subject)),
  ]);
  const changes = whatChanged(insights, now, cal, since);
  const health: StoredDigest['health'] = {};
  // One person at a time: the pilot is a small box and this is not urgent.
  for (const m of members) {
    if (!m.email) continue;
    const week = await healthOf(m.email, now).catch(() => null);
    if (week) health[m.subject] = week;
  }
  const digest: StoredDigest = { generatedAt: now.toISOString(), changes, health };
  await setSetting(DIGEST_KEY, digest);
  return digest;
}
