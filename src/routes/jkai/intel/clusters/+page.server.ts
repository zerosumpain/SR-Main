import type { PageServerLoad } from './$types';
import { getGraphAnalysis } from '$lib/jkai/intel/analytics/load';
import { buildClusterRoster } from '$lib/jkai/intel/cluster-roster';

export const load: PageServerLoad = async () => {
  const analysis = await getGraphAnalysis();
  return await buildClusterRoster(analysis);
};
