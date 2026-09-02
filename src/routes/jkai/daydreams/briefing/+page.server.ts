import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { loadBriefingDashboard } from '$lib/briefing/dashboard.server';

// The briefing is an independently useful surface: its profile and source
// configuration must render even when the daydream ledger cannot be read.
export const load: PageServerLoad = async () => {
  const briefing = await loadBriefingDashboard().catch((err) => {
    console.error('[daydream] briefing load failed:', errMsg(err));
    return null;
  });
  return { briefing };
};
