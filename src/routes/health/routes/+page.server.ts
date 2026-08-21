import type { PageServerLoad } from './$types';
import { listRoutes } from '$lib/trails/routes-service';

export const load: PageServerLoad = async () => {
  try {
    return { routes: await listRoutes(), error: null };
  } catch (err) {
    console.warn('[trails/routes] list failed:', (err as Error)?.message);
    return { routes: [], error: 'Could not load saved routes.' };
  }
};
