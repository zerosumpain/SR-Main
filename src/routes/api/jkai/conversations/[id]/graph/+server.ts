import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildThreadGraph } from '$lib/jkai/thread-graph';

/** Knowledge graph for one /jkai thread — the right rail's contents.
 *  Owner-gated by hooks.server.ts along with the rest of /api/jkai. */
export const GET: RequestHandler = async ({ params }) => {
  const graph = await buildThreadGraph(params.id);
  return json(graph);
};
