import type { PageServerLoad } from './$types';
import { orsConfigured } from '$lib/trails/ors';
import { proposeSession } from '$lib/trails/planner';

export const load: PageServerLoad = async () => {
  // The proposal is advisory; a dead analytic must not stop the page loading.
  let proposal: Awaited<ReturnType<typeof proposeSession>> | null = null;
  try {
    proposal = await proposeSession();
  } catch (err) {
    console.warn('[trails/plan] session proposal failed:', (err as Error)?.message);
  }

  return { configured: await orsConfigured(), proposal };
};
