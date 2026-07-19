import type { PageServerLoad } from './$types';
import { listAgents } from '$lib/agents/store';

// Owner-gated by hooks. Loads the persistent agent team from the datastore
// (seeds the default team on first access).
export const load: PageServerLoad = async () => {
  return { agents: await listAgents() };
};
