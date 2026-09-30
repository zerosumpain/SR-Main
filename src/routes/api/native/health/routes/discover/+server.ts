import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { discoverNearby, discoverOne, isSport } from '$lib/server/native-routes';

/**
 * GET /api/native/health/routes/discover?lat=&lng=&sport= — published OSM
 *     routes within 15 km (names only).
 * GET /api/native/health/routes/discover?osmId=&sport= — one of them, stitched,
 *     with its climb and difficulty grade, ready to save.
 */
export const GET: RequestHandler = withDevice(async ({ url }) => {
  const sport = url.searchParams.get('sport') ?? 'walk';
  if (!isSport(sport)) return json({ error: 'Pick a sport.' }, { status: 400 });

  const osmIdRaw = url.searchParams.get('osmId');
  try {
    if (osmIdRaw !== null) {
      const osmId = Number(osmIdRaw);
      if (!Number.isInteger(osmId) || osmId <= 0) return json({ error: 'No such route.' }, { status: 404 });
      return await discoverOne(osmId, sport);
    }
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    if (!url.searchParams.has('lat') || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return json({ error: 'Set a point on the map first.' }, { status: 400 });
    }
    return await discoverNearby(lat, lng, sport);
  } catch (error) {
    console.error('[native] route discover failed', error);
    return json({ error: 'OpenStreetMap is not answering right now.' }, { status: 502 });
  }
});
