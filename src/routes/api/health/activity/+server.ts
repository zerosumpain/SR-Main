import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { stravaActivities } from '$lib/db/schema';
import { desc, or, eq, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

const DEFAULT_LIMIT = 60;

export const GET: RequestHandler = async ({ url }) => {
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT)) || DEFAULT_LIMIT));
  const featuredOnly = url.searchParams.get('featured') === '1';

  const where = featuredOnly ? eq(stravaActivities.featured, true) : undefined;

  const rows = await db
    .select({
      id: stravaActivities.id,
      name: stravaActivities.name,
      type: stravaActivities.type,
      sportType: stravaActivities.sportType,
      startDate: stravaActivities.startDate,
      distance: stravaActivities.distance,
      movingTime: stravaActivities.movingTime,
      totalElevationGain: stravaActivities.totalElevationGain,
      featured: stravaActivities.featured,
      featuredOrder: stravaActivities.featuredOrder,
      featuredCaption: stravaActivities.featuredCaption,
    })
    .from(stravaActivities)
    .where(where ?? sql`true`)
    .orderBy(desc(stravaActivities.startDate))
    .limit(limit);

  return json({ activities: rows });
};
