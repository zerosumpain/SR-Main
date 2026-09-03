import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { loadLoopHealth, loopVerdict } from '$lib/daydream/loop-health';
import { MIN_PAIRS } from '$lib/daydream/stats/tests';
import { loadImprovementDashboard } from '$lib/dashboard/improvement.server';

export const load: PageServerLoad = async () => {
  const [loop, improvement] = await Promise.all([
    loadLoopHealth(MIN_PAIRS),
    loadImprovementDashboard().catch((err) => {
      console.error('[daydream] improvement load failed:', errMsg(err));
      return null;
    }),
  ]);
  return { loop, loopVerdict: loopVerdict(loop), improvement };
};
