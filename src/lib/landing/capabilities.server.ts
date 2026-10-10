// capabilities.server.ts — the slow-moving facts the landing page's capability
// sections print beside the live readings.
//
// Same rule as the Engine Room study this page links into: nothing here is a
// literal. The think cadence and its waking hours are imported from the module
// the Daydream loop runs on, the endpoint count is read from the route manifest
// the build emits, and the hit rate is the impact figure the study itself shows.
// Counts and ratios only: no note, title or path leaves the server.
//
// The front door pays no slow-path latency for these. The DB-backed figure is
// read through the showcase's Daydream impact memo (five minutes, timeboxed,
// shared, so the page runs the impact query once however many sections print
// from it), so a cold or missing table renders as a dash on that one line,
// never as a slow page.

import { ROUTE_MANIFEST } from 'virtual:sr-route-manifest';
import { THINK_CADENCE_MS } from '$lib/daydream/think/questions';
import { ACTIVE_HOURS } from '$lib/daydream/budget';
import { IMPACT_WINDOW_DAYS } from '$lib/daydream/impact';

import { nativeCounts } from './showcase-data';
import { daydreamImpact } from './showcase.server';
import type { CapabilityFacts } from './capabilities';

export type { CapabilityFacts };

export async function loadCapabilityFacts(now = new Date()): Promise<CapabilityFacts> {
  return {
    daydream: {
      cadenceMinutes: THINK_CADENCE_MS / 60_000,
      activeHours: { ...ACTIVE_HOURS },
      hitRate: (await daydreamImpact(now))?.hitRate ?? null,
      windowDays: IMPACT_WINDOW_DAYS,
    },
    app: {
      nativeEndpoints: nativeCounts(ROUTE_MANIFEST).endpoints,
    },
  };
}
