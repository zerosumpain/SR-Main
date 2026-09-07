import type { PageServerLoad } from './$types';
import { orsConfigured } from '$lib/trails/ors';
import { proposeSession } from '$lib/trails/planner';
import { lastKnownDeviceLocation } from '$lib/trails/device-location';
import { parsePlannerSeed } from '$lib/health/deep-links';

export const load: PageServerLoad = async ({ url }) => {
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

  // A session commissioned from somewhere else — today it is section D of
  // /health, whose ranked moves each carry the outing they argue for. Parsed
  // here rather than in the component so an unknown sport or an absurd distance
  // is gone before it reaches a form field, and so the contract has one tested
  // owner (`$lib/health/deep-links`) shared with the page that emits it.
  //
  // The seed never REPLACES the proposal — both are rendered, and the proposal
  // is the one computed from live readiness. A link written when the body was
  // fresh must not quietly commission a hard session on a day the planner would
  // have vetoed it.
  const seed = parsePlannerSeed(url.searchParams);

  return { configured, proposal, deviceLocation, seed };
};
