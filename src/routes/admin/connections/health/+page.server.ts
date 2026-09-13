import { hasToken } from '$lib/health-sync/tokens';
import { db } from '$lib/db';
import { healthSyncState, healthSyncJobs, stravaActivities } from '$lib/db/schema';
import { desc, asc, eq, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const whoopConnected = await hasToken('whoop');

  // These columns are what the Strava integration left behind when it was
  // removed on 2026-09-13. The table and its 671 rows stay, SR-Health renders
  // the featured ones on /health, and this page is where they are curated —
  // so the picker below outlives the connector that filled it.
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
    // Pull all activities for client-side filtering — payload is small (~200 KB
    // for ~600 rows) and avoids round-trips when the user is hunting for an
    // old "epic" candidate.
    db.select(baseFields).from(stravaActivities).orderBy(desc(stravaActivities.startDate)),
    db
      .select(baseFields)
      .from(stravaActivities)
      .where(eq(stravaActivities.featured, true))
      .orderBy(asc(sql`COALESCE(${stravaActivities.featuredOrder}, 9999)`), desc(stravaActivities.startDate)),
  ]);
  const connected = url.searchParams.get('connected');

  return {
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
