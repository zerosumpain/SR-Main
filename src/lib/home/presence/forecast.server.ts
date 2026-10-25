// src/lib/home/presence/forecast.server.ts
//
// The forecast for a viewer: the learned trail analysis (`insights.server`,
// scoped and consent-checked there) turned into routines, next moves, what
// looks off and the departure pattern (`forecast.ts`). The page, the watch
// notifier and the app's native lane all come through here, so every surface
// answers from one computation.

import { and, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, forecastFeedback } from '$lib/db/schema';
import { loadPresenceInsights } from './insights.server';
import { getHomePlace } from './places';
import { getSetting, setSetting } from '$lib/server/models/settings';
import { buildForecast, cleanHolidays, type FamilyForecast, type ForecastCorrection, type Holiday, type SchoolCalendar } from './forecast';
import type { PresenceInsights } from './insights';
import type { PeopleViewer } from './viewer';

export interface ForecastRead {
  forecast: FamilyForecast;
  insights: PresenceInsights;
  homeIds: string[];
  homeId: string | null;
}

export async function homePlaceIds(): Promise<Set<string>> {
  const rows = await db.select({ id: daydreamPlaces.id }).from(daydreamPlaces)
    .where(eq(daydreamPlaces.kind, 'home'));
  return new Set(rows.map((r) => r.id));
}

/**
 * The "that's wrong" corrections of the window. A failed read is none: the
 * forecast stands without them, as it did before they existed.
 */
export async function forecastCorrections(days: number, now = new Date()): Promise<ForecastCorrection[]> {
  try {
    const rows = await db.select().from(forecastFeedback)
      .where(gte(forecastFeedback.createdAt, new Date(+now - days * 86_400_000)));
    return rows.map((r) => ({
      subject: r.subject,
      kind: r.kind === 'arriving' ? 'arriving' : 'routine',
      routineId: r.routineId,
      departedAt: r.departedAt,
      date: r.date,
    }));
  } catch (error) {
    console.warn('[forecast] corrections unavailable:', (error as Error).message);
    return [];
  }
}

export const HOLIDAYS_KEY = 'home.forecast.holidays';

export async function loadHolidays(): Promise<Holiday[]> {
  return cleanHolidays(await getSetting(HOLIDAYS_KEY).catch(() => null));
}

export async function saveHolidays(value: unknown): Promise<Holiday[]> {
  const holidays = cleanHolidays(value);
  await setSetting(HOLIDAYS_KEY, holidays);
  return holidays;
}

/** The owner's term breaks and every active school place. A failed read is no calendar. */
export async function loadSchoolCalendar(): Promise<SchoolCalendar> {
  try {
    const [holidays, schools] = await Promise.all([
      loadHolidays(),
      db.select({ id: daydreamPlaces.id }).from(daydreamPlaces).where(and(eq(daydreamPlaces.kind, 'school'), eq(daydreamPlaces.status, 'active'))),
    ]);
    return { holidays, schoolIds: new Set(schools.map((r) => r.id)) };
  } catch (error) {
    console.warn('[forecast] school calendar unavailable:', (error as Error).message);
    return { holidays: [], schoolIds: new Set() };
  }
}

export async function loadForecast(viewer: PeopleViewer, days = 28, person: string | null = null, now = new Date()): Promise<ForecastRead> {
  const [insights, homes, home, corrections, cal] = await Promise.all([
    loadPresenceInsights(viewer, days, person, now), homePlaceIds(), getHomePlace().catch(() => null),
    forecastCorrections(days, now), loadSchoolCalendar(),
  ]);
  const homeId = home?.id ?? null;
  return { forecast: buildForecast(insights, homes, now, homeId, corrections, cal), insights, homeIds: [...homes], homeId };
}
