import { hasToken } from '$lib/health/tokens';
import { db } from '$lib/db';
import { healthSyncState } from '$lib/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const [stravaConnected, whoopConnected] = await Promise.all([
    hasToken('strava'),
    hasToken('whoop'),
  ]);

  const syncStates = await db.select().from(healthSyncState);
  const connected = url.searchParams.get('connected');

  return {
    strava: { connected: stravaConnected },
    whoop: { connected: whoopConnected },
    syncStates: syncStates.map((s) => ({
      service: s.service,
      status: s.status,
      lastSyncAt: s.lastSyncAt,
      recordsSynced: s.recordsSynced,
    })),
    justConnected: connected,
  };
};
