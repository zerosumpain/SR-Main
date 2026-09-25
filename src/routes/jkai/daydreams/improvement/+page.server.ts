import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { loadImprovementDashboard } from '$lib/dashboard/improvement.server';
import { loadOvernight } from '$lib/daydream/rooms/overnight.server';

// The overnight and the improvement ledger. The loop scoreboard, the appetite
// board and the seven-stage "loop, end to end" strip read the daydream engine
// that P4a (2026-09-25) deleted — faults, the appetite ledger, swept signals
// and findings — so they went with it.
export const load: PageServerLoad = async () => {
  const [improvement, night] = await Promise.all([
    loadImprovementDashboard().catch((err) => {
      console.error('[daydream] improvement load failed:', errMsg(err));
      return null;
    }),
    // What actually ran, from the pulse ledger. Its own catch, because a night
    // that cannot be read must not take the whole room down with it.
    loadOvernight(),
  ]);
  return { improvement, night };
};
