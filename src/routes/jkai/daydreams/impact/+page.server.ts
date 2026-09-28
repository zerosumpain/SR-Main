import type { PageServerLoad } from './$types';
import { loadImpact } from '$lib/daydream/impact.server';
import { errMsg } from '$lib/daydream/types';

// Impact (spec 2026-09-28): is daydream worth having? Twelve weeks of notes
// across both engines, what was acted on, and what came back. Owner-gated by
// hooks like the rest of /jkai.
export const load: PageServerLoad = async () => {
  try {
    return { ...(await loadImpact()), loadError: null as string | null };
  } catch (err) {
    console.error('[daydream] impact failed:', errMsg(err));
    return { impact: null, results: [], loadError: errMsg(err) };
  }
};
