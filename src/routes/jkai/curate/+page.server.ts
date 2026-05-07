import { listActiveSessions } from '$lib/curate/session-store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const sessions = await listActiveSessions();
  return { sessions };
};
