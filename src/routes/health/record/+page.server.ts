import type { PageServerLoad } from './$types';
import { getRoute } from '$lib/trails/routes-service';

export const load: PageServerLoad = async ({ url }) => {
  const routeId = url.searchParams.get('route');
  if (!routeId) return { route: null };

  // A missing route is not fatal here — you can always record without one.
  const route = await getRoute(routeId).catch(() => null);
  return {
    route: route
      ? { id: route.id, name: route.name, sport: route.sport, coordinates: route.coordinates, bounds: route.bounds }
      : null,
  };
};
