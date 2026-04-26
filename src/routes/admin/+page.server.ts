import { hasToken } from '$lib/health/tokens';
import { db } from '$lib/db';
import { healthSyncState, healthSyncJobs } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const [stravaConnected, whoopConnected] = await Promise.all([
    hasToken('strava'),
    hasToken('whoop'),
  ]);

  const [syncStates, recentJobs] = await Promise.all([
    db.select().from(healthSyncState),
    db.select().from(healthSyncJobs).orderBy(desc(healthSyncJobs.startedAt)).limit(10),
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
    justConnected: connected,
  };
};
