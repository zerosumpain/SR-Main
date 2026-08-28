// Load the live-data observation layer for the /monitor "are we on track?" dashboard.
// The route's visibility guard + headers are handled by +layout.server.ts; here we only
// add the tracked indicators (cheap DB read) with a short shared-cache window.

import { loadTrackedIndicators } from '$lib/policy-engine/tracking/ingest.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders, parent }) => {
  await parent(); // run the layout guard first
  let tracked: Awaited<ReturnType<typeof loadTrackedIndicators>> = [];
  try {
    tracked = await loadTrackedIndicators();
  } catch {
    tracked = []; // never break the page if the DB hiccups
  }
  setHeaders({ 'cache-control': 'public, max-age=0, s-maxage=900' });
  return { tracked };
};
