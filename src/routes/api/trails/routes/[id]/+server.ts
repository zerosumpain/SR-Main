import { json } from '@sveltejs/kit';
import { addWaypoint, deleteRoute, getRoute } from '$lib/trails/routes-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const route = await getRoute(params.id);
  if (!route) return json({ error: 'not found' }, { status: 404 });
  return json(route);
};

export const DELETE: RequestHandler = async ({ params }) => {
  const ok = await deleteRoute(params.id);
  if (!ok) return json({ error: 'not found' }, { status: 404 });
  return json({ deleted: true });
};

/** POST adds a waypoint to this route. */
export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => null);
  if (!body || !Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
    return json({ error: 'lat and lng are required' }, { status: 400 });
  }

  const route = await getRoute(params.id);
  if (!route) return json({ error: 'not found' }, { status: 404 });

  const id = await addWaypoint({
    routeId: params.id,
    name: String(body.name ?? 'Waypoint').slice(0, 120),
    icon: typeof body.icon === 'string' ? body.icon : 'custom',
    lat: body.lat,
    lng: body.lng,
    note: typeof body.note === 'string' ? body.note.slice(0, 1000) : null,
  });

  return json({ id }, { status: 201 });
};
