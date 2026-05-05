import { db } from '$lib/db';
import { stravaActivities } from '$lib/db/schema';
import { eq, desc, asc, sql } from 'drizzle-orm';

export type FeaturedActivity = {
  id: number;
  name: string;
  caption: string | null;
  type: string;
  sportType: string;
  startDate: number;
  startDateLocal: string;
  distanceM: number;
  movingTimeS: number;
  elapsedTimeS: number;
  elevationM: number;
  averageSpeedMs: number;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  calories: number | null;
  sufferScore: number | null;
  polyline: string | null;
};

function pickPolyline(mapData: string | null): string | null {
  if (!mapData) return null;
  try {
    const parsed = JSON.parse(mapData) as { summary_polyline?: string; polyline?: string };
    return parsed.summary_polyline || parsed.polyline || null;
  } catch {
    return null;
  }
}

export async function getFeaturedActivities(): Promise<FeaturedActivity[]> {
  const rows = await db
    .select()
    .from(stravaActivities)
    .where(eq(stravaActivities.featured, true))
    .orderBy(asc(sql`COALESCE(${stravaActivities.featuredOrder}, 9999)`), desc(stravaActivities.startDate));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    caption: r.featuredCaption ?? null,
    type: r.type,
    sportType: r.sportType,
    startDate: r.startDate,
    startDateLocal: r.startDateLocal,
    distanceM: r.distance,
    movingTimeS: r.movingTime,
    elapsedTimeS: r.elapsedTime,
    elevationM: r.totalElevationGain,
    averageSpeedMs: r.averageSpeed / 100,
    averageHeartrate: r.averageHeartrate,
    maxHeartrate: r.maxHeartrate,
    calories: r.calories,
    sufferScore: r.sufferScore,
    polyline: pickPolyline(r.mapData),
  }));
}
