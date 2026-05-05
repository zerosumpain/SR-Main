import { hasToken } from '$lib/health/tokens';
import { db } from '$lib/db';
import { healthSyncState, healthSyncJobs, stravaActivities } from '$lib/db/schema';
import { desc, asc, eq, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const [stravaConnected, whoopConnected] = await Promise.all([
    hasToken('strava'),
    hasToken('whoop'),
  ]);

  const baseFields = {
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
  };

  const [syncStates, recentJobs, recentActivities, featuredActivities] = await Promise.all([
    db.select().from(healthSyncState),
    db.select().from(healthSyncJobs).orderBy(desc(healthSyncJobs.startedAt)).limit(10),
    db.select(baseFields).from(stravaActivities).orderBy(desc(stravaActivities.startDate)).limit(60),
    db
      .select(baseFields)
      .from(stravaActivities)
      .where(eq(stravaActivities.featured, true))
      .orderBy(asc(sql`COALESCE(${stravaActivities.featuredOrder}, 9999)`), desc(stravaActivities.startDate)),
  ]);
  const connected = url.searchParams.get('connected');

  return {
    strava: { connected: stravaConnected },
    whoop: { connected: whoopConnected },
    syncStates: syncStates.map((s) => ({
      service: s.service,
      status: s.status,
      lastSyncAt: s.lastSyncAt,
      recordsSynced: s.recordsSynced,
      errorMessage: s.errorMessage,
    })),
    recentJobs,
    recentActivities,
    featuredActivities,
    justConnected: connected,
  };
};
