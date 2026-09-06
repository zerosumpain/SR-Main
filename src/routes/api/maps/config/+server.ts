import { json } from '@sveltejs/kit';
import { mapboxConfig } from '$lib/maps/config.server';
import { MAPBOX_SETUP_MESSAGE } from '$lib/maps/config';

/** Public rendering configuration for shared maps; only a validated pk. token. */
export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const config = await mapboxConfig();
    return config ? json(config, { headers })
      : json({ message: MAPBOX_SETUP_MESSAGE }, { status: 503, headers });
  } catch {
    return json({ message: 'Map credentials are unavailable. Check Admin → Connections → Credentials.' }, { status: 503, headers });
  }
}
