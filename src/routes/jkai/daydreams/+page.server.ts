import type { PageServerLoad } from './$types';
import { loadLedger } from '$lib/daydream/ledger';
import { getSetting } from '$lib/server/models/settings';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';

// Owner-gated by hooks (the whole /jkai area is owner-only).
//
// Every read tolerates the tables being empty — on a fresh install they are,
// and for the first fortnight of a real one they are nearly so. A page that
// only renders once there is data is a page nobody can use to find out why
// there is no data.

export const load: PageServerLoad = async () => {
  try {
    const [ledger, enabled] = await Promise.all([
      loadLedger(),
      getSetting<boolean>(SETTINGS_ENABLED_KEY),
    ]);
    // Unset/null means enabled, matching the self-improvement engine.
    return { ...ledger, enabled: enabled !== false, loadError: null };
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
      enabled: true,
      loadError: errMsg(err),
    };
  }
};
