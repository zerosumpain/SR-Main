import type { PageServerLoad } from './$types';
import { listAgents, listTeamMemory } from '$lib/agents/store';
import { loadStacks, stackTokens } from '$lib/jkai/prompts/workbench';

// Owner-gated by hooks. Loads the persistent agent team from the datastore
// (seeds the default team on first access) plus the shared team-memory
// scratchpad so the agents' collective knowledge is visible.
export const load: PageServerLoad = async () => {
  const [agents, teamMemory, rawStacks] = await Promise.all([
    listAgents(),
    listTeamMemory(),
    loadStacks(),
  ]);
  return {
    agents,
    teamMemory,
    stacks: rawStacks.map((stack) => ({ ...stack, approxTokens: stackTokens(stack.files) })),
  };
};
