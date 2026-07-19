import type { PageServerLoad } from './$types';
import { listAgents, listTeamMemory } from '$lib/agents/store';

// Owner-gated by hooks. Loads the persistent agent team from the datastore
// (seeds the default team on first access) plus the shared team-memory
// scratchpad so the agents' collective knowledge is visible.
export const load: PageServerLoad = async () => {
  const [agents, teamMemory] = await Promise.all([listAgents(), listTeamMemory()]);
  return { agents, teamMemory };
};
