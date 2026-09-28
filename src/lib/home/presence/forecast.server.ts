// src/lib/home/presence/forecast.server.ts
//
// The forecast for a viewer: the learned trail analysis (`insights.server`,
// scoped and consent-checked there) turned into routines, next moves, what
// looks off and the departure pattern (`forecast.ts`). The page, the watch
// notifier and the app's native lane all come through here, so every surface
// answers from one computation.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces } from '$lib/db/schema';
import { loadPresenceInsights } from './insights.server';
import { getHomePlace } from './places';
import { buildForecast, type FamilyForecast } from './forecast';
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

export async function loadForecast(viewer: PeopleViewer, days = 28, person: string | null = null, now = new Date()): Promise<ForecastRead> {
  const [insights, homes, home] = await Promise.all([
    loadPresenceInsights(viewer, days, person, now), homePlaceIds(), getHomePlace().catch(() => null),
  ]);
  const homeId = home?.id ?? null;
  return { forecast: buildForecast(insights, homes, now, homeId), insights, homeIds: [...homes], homeId };
}
