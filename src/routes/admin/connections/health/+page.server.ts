import { getWhoopStatus } from '$lib/server/health-service';
import { db } from '$lib/db';
import { healthSyncState, healthSyncJobs } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const whoopConnected = (await getWhoopStatus()).connected;

  const [syncStates, recentJobs] = await Promise.all([
    db.select().from(healthSyncState),
    db.select().from(healthSyncJobs).orderBy(desc(healthSyncJobs.startedAt)).limit(10),
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
    justConnected: connected,
  };
};
