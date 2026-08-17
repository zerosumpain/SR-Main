import type { PageServerLoad } from './$types';
import { orsConfigured } from '$lib/trails/ors';
import { suggestTarget } from '$lib/trails/planner';

export const load: PageServerLoad = async () => {
  // The suggestion is advisory; a dead analytic must not stop the page loading.
  let suggested: Awaited<ReturnType<typeof suggestTarget>> | null = null;
  try {
    suggested = await suggestTarget('run');
  } catch (err) {
    console.warn('[trails/plan] target suggestion failed:', (err as Error)?.message);
  }

  return { configured: await orsConfigured(), suggested };
};
