import type { PageServerLoad } from './$types';
import { GROUPS, NODES, EDGES } from '$lib/architecture/topology';
import { probeArchitecture } from '$lib/architecture/health';

export const load: PageServerLoad = async () => {
  return {
    groups: GROUPS,
    nodes: NODES,
    edges: EDGES,
    health: await probeArchitecture(),
  };
};
