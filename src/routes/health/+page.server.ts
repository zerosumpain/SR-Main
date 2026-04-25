import type { PageServerLoad } from './$types';
import { getHealthSeries30d } from '$lib/health/series-30d-service';

export const load: PageServerLoad = async () => {
  const data = await getHealthSeries30d();
  return { ...data, loadedAt: new Date().toISOString() };
};
