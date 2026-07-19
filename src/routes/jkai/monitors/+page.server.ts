import type { PageServerLoad } from './$types';
import { listMonitors } from '$lib/monitors/monitors.server';

// Owner-gated by hooks. Lists monitors with schedule + last-run state.
export const load: PageServerLoad = async () => {
  return { monitors: await listMonitors() };
};
