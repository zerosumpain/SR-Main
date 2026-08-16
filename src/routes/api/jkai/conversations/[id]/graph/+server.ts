import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildThreadGraph } from '$lib/jkai/thread-graph.server';
import { deleteDerivedIntel } from '$lib/jkai/intel/auto-extract';

/** Knowledge graph for one /jkai thread — the right rail's contents.
 *  Owner-gated by hooks.server.ts along with the rest of /api/jkai. */
export const GET: RequestHandler = async ({ params }) => {
  const graph = await buildThreadGraph(params.id);
  return json(graph);
};

/**
 * Forget what this thread contributed to /jkai/intel.
 *
 * Turning the rail's toggle off only stops FUTURE extraction — this is the
 * separate, explicit removal. It runs the same cascade a deleted Drive file or
 * deep dive runs, so an entity another note also asserts survives: the thread
 * being withdrawn is not evidence that the thing it named stopped existing.
 *
 * Awaited rather than queued. The rail refetches the graph straight afterwards
 * and a fire-and-forget delete would race it into showing the nodes it has just
 * been told are gone.
 */
export const DELETE: RequestHandler = async ({ params }) => {
  const result = await deleteDerivedIntel('chat', params.id);
  return json(result);
};
