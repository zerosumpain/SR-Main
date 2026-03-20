import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { stravaActivities } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const id = parseInt(params.id);
  if (isNaN(id)) return json({ error: 'Invalid ID' }, { status: 400 });

  const [activity] = await db
    .select()
    .from(stravaActivities)
    .where(eq(stravaActivities.id, id))
    .limit(1);

  if (!activity) return json({ error: 'Not found' }, { status: 404 });

  // Parse map data for polyline
  let polyline: string | null = null;
  try {
    const mapData = activity.mapData ? JSON.parse(activity.mapData) : null;
    polyline = mapData?.summary_polyline || mapData?.polyline || null;
  } catch {}

  return json({
    id: activity.id,
    name: activity.name,
    type: activity.type,
    sportType: activity.sportType,
    startDate: activity.startDate,
    timezone: activity.timezone,
    distance: activity.distance,
    movingTime: activity.movingTime,
    elapsedTime: activity.elapsedTime,
    totalElevationGain: activity.totalElevationGain,
    averageSpeed: activity.averageSpeed,
    maxSpeed: activity.maxSpeed,
    averageHeartrate: activity.averageHeartrate,
    maxHeartrate: activity.maxHeartrate,
    calories: activity.calories,
    sufferScore: activity.sufferScore,
    polyline,
  });
};
