import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTripOwner } from '$lib/trips/access.server';
import { findPlace } from '$lib/trips/research.server';

/**
 * GET /api/trips/places?q=&lat=&lng= — find a stay or a wish's place on
 * OpenStreetMap (Nominatim), which may be stored. Mapbox search is never used
 * here: its results may not be stored, and a stay is.
 */
export const GET: RequestHandler = async (event) => {
  await requireTripOwner(event);
  const q = (event.url.searchParams.get('q') ?? '').trim().slice(0, 200);
  if (q.length < 3) return json({ error: 'Type at least three letters.' }, { status: 400 });
  const lat = Number(event.url.searchParams.get('lat'));
  const lng = Number(event.url.searchParams.get('lng'));
  const near = event.url.searchParams.has('lat') && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const place = await findPlace(q, near);
  return json({ place: place ? { name: place.name, address: place.address, location: place.location, osmId: place.osmId } : null });
};
