import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getGraphAnalysis } from '$lib/jkai/intel/analytics/load';
import { buildClusterRoster } from '$lib/jkai/intel/cluster-roster';
import { isOwnerScope } from '$lib/jkai/intel/scope';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

// Owner-only, like /api/jkai/intel/clusters: the roster is one global list over
// the owner's graph, and building it reconciles (rewrites) that list.
export const load: PageServerLoad = async (event) => {
  const scope = await resolveRequestScope(event);
  if (!isOwnerScope(scope)) throw error(403, 'The cluster roster is owner-only');
  const analysis = await getGraphAnalysis(false, { scope });
  return await buildClusterRoster(analysis);
};
