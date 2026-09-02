import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { listMonitors } from '$lib/monitors/monitors.server';

export const load: PageServerLoad = async () => {
  const monitors = await listMonitors().catch((err) => {
    console.error('[daydream] monitors load failed:', errMsg(err));
    return [] as Awaited<ReturnType<typeof listMonitors>>;
  });
  return { monitors };
};
