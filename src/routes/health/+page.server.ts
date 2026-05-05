import type { PageServerLoad } from './$types';
import { getHealthSeries30d } from '$lib/health/series-30d-service';
import { getFeaturedActivities } from '$lib/health/featured-activities-service';

export const load: PageServerLoad = async () => {
  const [data, featuredActivities] = await Promise.all([
    getHealthSeries30d(),
    getFeaturedActivities(),
  ]);
  return { ...data, featuredActivities, loadedAt: new Date().toISOString() };
};
