// Run CGQL by hand and see exactly the block a build would be handed.
//
// The point of this surface is that it renders the SAME text the push channel
// injects, produced by the same loader. A console that showed a prettier
// version would let the two drift, and you would be tuning a query against
// something no build ever sees.
import type { PageServerLoad } from './$types';
import { CgqlError, parseCgql } from '$lib/codegraph/query';
import { buildContextBlock, runPlan } from '$lib/codegraph/retrieve';

export const load: PageServerLoad = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return { q: '', result: null, block: '', error: null };

  try {
    const result = await runPlan(parseCgql(q));
    return {
      q,
      result: {
        outcome: result.outcome,
        durationMs: result.durationMs,
        lessons: result.lessons,
        episodes: result.episodes,
        nodes: result.nodes,
      },
      block: buildContextBlock(result),
      error: null,
    };
  } catch (e) {
    if (e instanceof CgqlError) return { q, result: null, block: '', error: `${e.message} (at character ${e.position})` };
    return { q, result: null, block: '', error: (e as Error).message };
  }
};
