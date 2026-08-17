import { error } from '@sveltejs/kit';
import { getRoute } from '$lib/trails/routes-service';
import { routeToGpx } from '$lib/trails/planner';
import { GPX_MIME_TYPE } from '$lib/route-exports';
import type { RequestHandler } from './$types';

/**
 * Download a saved route as GPX.
 *
 * Served inline from the owner-gated API rather than minted as a capability
 * token: that token flow exists so an agent can hand John a link over
 * WhatsApp, and re-using it here would create a durable public URL for every
 * route the browser merely looked at.
 */
export const GET: RequestHandler = async ({ params }) => {
  const route = await getRoute(params.id);
  if (!route) throw error(404, 'Route not found');

  const gpx = routeToGpx(route.coordinates, route.name);
  const safeName =
    route.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'route';

  return new Response(gpx, {
    headers: {
      'Content-Type': GPX_MIME_TYPE,
      'Content-Disposition': `attachment; filename="${safeName}.gpx"`,
      'Cache-Control': 'no-store',
    },
  });
};
