import type { PageServerLoad } from './$types';
import { loadStacks, stackTokens } from '$lib/jkai/prompts/workbench';

// Owner-gated by hooks. Loads both prompt stacks server-side so the page opens
// with real content rather than a spinner + fetch.
export const load: PageServerLoad = async () => {
  const stacks = await loadStacks();
  return {
    stacks: stacks.map((s) => ({ ...s, approxTokens: stackTokens(s.files) })),
  };
};
