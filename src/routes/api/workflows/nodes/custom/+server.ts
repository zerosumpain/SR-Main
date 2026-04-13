import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadDynamicNodeDefinitions, DYNAMIC_NODES_DIR } from '$lib/workflows/orchestrator/dynamic-nodes';

export const GET: RequestHandler = async () => {
  const definitions = loadDynamicNodeDefinitions(DYNAMIC_NODES_DIR);
  return json(definitions);
};
