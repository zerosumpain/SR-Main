import type { PageServerLoad } from './$types';
import { loadLedger } from '$lib/daydream/ledger';
import { getSetting } from '$lib/server/models/settings';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import { loadLoopHealth, loopVerdict } from '$lib/daydream/loop-health';
import { MIN_PAIRS } from '$lib/daydream/stats/tests';
import { listMonitors } from '$lib/monitors/monitors.server';
import { loadBriefingDashboard } from '$lib/briefing/dashboard.server';
import { loadImprovementDashboard } from '$lib/dashboard/improvement.server';

// Owner-gated by hooks (the whole /jkai area is owner-only).
//
// Every read tolerates the tables being empty — on a fresh install they are,
// and for the first fortnight of a real one they are nearly so. A page that
// only renders once there is data is a page nobody can use to find out why
// there is no data.

export const load: PageServerLoad = async () => {
  // The briefing is an independently useful surface. Keep its load promise
  // outside the main ledger try/catch so a stale detector/daydream schema does
  // not erase an otherwise healthy briefing profile and source configuration.
  const briefingPromise = loadBriefingDashboard().catch((err) => {
    console.error('[daydream] briefing load failed:', errMsg(err));
    return null;
  });
  try {
    const [ledger, enabled, loop, monitors, briefing, improvement] = await Promise.all([
      loadLedger(),
      getSetting<boolean>(SETTINGS_ENABLED_KEY),
      loadLoopHealth(MIN_PAIRS),
      listMonitors().catch((err) => {
        console.error('[daydream] monitors load failed:', errMsg(err));
        return [];
      }),
      briefingPromise,
      loadImprovementDashboard().catch((err) => {
        console.error('[daydream] improvement load failed:', errMsg(err));
        return null;
      }),
    ]);
    // Unset/null means enabled, matching the self-improvement engine.
    return {
      ...ledger,
      enabled: enabled !== false,
      loop,
      loopVerdict: loopVerdict(loop),
      monitors,
      briefing,
      improvement,
      loadError: null,
    };
  } catch (err) {
    console.error('[daydream] page load failed:', errMsg(err));
    return {
      engine: {
        lastDetectAt: null,
        lastObserveAt: null,
        coverage: null,
        trailSpanDays: null,
        sources: [],
        pausedActions: [],
        summary: null,
      },
      detectors: [],
      threshold: { value: 0, feedbackCount: 0 },
      thoughts: [],
      places: [],
      counts: { byStatus: {}, places: 0, namedPlaces: 0, unnamedPlaces: 0, thoughts7d: 0 },
      budget: null,
      rules: [],
      digest: null,
      steers: [],
      delivery: null,
      // `detail` must be present on BOTH branches or the page's union type has
      // no such property. The per-person Family section reads it.
      family: { members: [], detail: {} },
      money: null,
      discoveries: null,
      telemetry: null,
      provenance: { sources: [], minPairs: 0, registered: 0, sweepable: 0 },
      enabled: true,
      // Both branches or the union type has no such property — `tsc` does not
      // catch it, only `svelte-check`, and only after `svelte-kit sync`.
      loop: {
        tools: {
          total: 0,
          enabled: 0,
          everCalled: 0,
          shippedRecently: 0,
          shippedRecentlyCalled: 0,
          windowDays: 14,
        },
        toolSignals: null,
        error: errMsg(err),
      },
      loopVerdict: { state: 'unknown' as const, line: 'Could not read the loop\u2019s state.' },
      monitors: [],
      briefing: await briefingPromise,
      improvement: null,
      loadError: errMsg(err),
    };
  }
};
