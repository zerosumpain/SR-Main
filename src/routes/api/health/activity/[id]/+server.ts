import { json, error } from '@sveltejs/kit';
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
    featured: activity.featured,
    featuredOrder: activity.featuredOrder,
    featuredCaption: activity.featuredCaption,
    polyline,
  });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const id = parseInt(params.id);
  if (isNaN(id)) throw error(400, 'Invalid ID');

  const body = (await request.json().catch(() => ({}))) as {
    featured?: boolean;
    featuredOrder?: number | null;
    featuredCaption?: string | null;
  };

  const update: Record<string, unknown> = {};
  if (typeof body.featured === 'boolean') update.featured = body.featured;
  if (body.featuredOrder === null || typeof body.featuredOrder === 'number') {
    update.featuredOrder = body.featuredOrder;
  }
  if (body.featuredCaption === null || typeof body.featuredCaption === 'string') {
    const trimmed = body.featuredCaption == null ? null : body.featuredCaption.trim().slice(0, 280);
    update.featuredCaption = trimmed && trimmed.length > 0 ? trimmed : null;
  }

  if (Object.keys(update).length === 0) throw error(400, 'No updatable fields supplied');

  const [updated] = await db
    .update(stravaActivities)
    .set(update)
    .where(eq(stravaActivities.id, id))
    .returning({
      id: stravaActivities.id,
      featured: stravaActivities.featured,
      featuredOrder: stravaActivities.featuredOrder,
      featuredCaption: stravaActivities.featuredCaption,
    });

  if (!updated) throw error(404, 'Activity not found');
  return json(updated);
};
