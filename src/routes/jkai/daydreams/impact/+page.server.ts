import type { PageServerLoad } from './$types';
import { loadImpact } from '$lib/daydream/impact.server';
import { errMsg } from '$lib/daydream/types';
import { isOwnerRequest } from '$lib/server/owner';

// Impact (spec 2026-09-28): is daydream worth having? Twelve weeks of notes
// across both engines, what was acted on, and what came back. Owner-gated by
// hooks like the rest of /jkai, except for a member holding jkai · daydreams:
// they see the aggregates and never the latest results, whose titles are the
// notes themselves and link into the owner's Inbox.
export const load: PageServerLoad = async (event) => {
  const member = !(await isOwnerRequest(event));
  try {
    const { impact, results } = await loadImpact();
    return { impact, results: member ? [] : results, loadError: null as string | null, member };
  } catch (err) {
    console.error('[daydream] impact failed:', errMsg(err));
    return { impact: null, results: [], loadError: member ? 'Impact could not be read.' : errMsg(err), member };
  }
};
