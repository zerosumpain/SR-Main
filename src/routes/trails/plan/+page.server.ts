import type { PageServerLoad } from './$types';
import { orsConfigured } from '$lib/trails/ors';
import { proposeSession } from '$lib/trails/planner';
import { lastKnownDeviceLocation } from '$lib/trails/device-location';

export const load: PageServerLoad = async () => {
  // Everything here is advisory; a dead analytic or an unreachable Home
  // Assistant must not stop the page loading. Fetched concurrently — the
  // slowest of the three sets the page's time-to-first-byte, not the sum.
  const [configured, proposal, deviceLocation] = await Promise.all([
    orsConfigured(),
    proposeSession().catch((err) => {
      console.warn('[trails/plan] session proposal failed:', (err as Error)?.message);
      return null;
    }),
    lastKnownDeviceLocation(),
  ]);

  return { configured, proposal, deviceLocation };
};
