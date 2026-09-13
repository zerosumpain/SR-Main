import { json } from '@sveltejs/kit';
import { mapboxConfig, MAPBOX_SETUP_MESSAGE } from './token.server';

// The browser's Mapbox token, for whoever is drawing a map.
//
// THIS IS NOT A MAIN FEATURE, AND THAT IS WHY IT WAS DELETED BY ACCIDENT.
// #871 pruned Main's whole `$lib/maps` tree — correctly: the health domain
// moved to SR-Health and nothing in Main draws a map any more. It took this
// endpoint with it, and SR-Health's browser code still fetches
// `/api/maps/config` by absolute path. cloudflared routes `/api/maps` here, not
// there, so every map on /health went to "Map imagery unavailable" the moment
// that release landed — the owner's activity pages, the routes, the segments
// and the shared copies alike. The dependency is an HTTP one, so nothing in
// either repository's build could see it.
//
// It lives HERE rather than in SR-Health because the token does: it is an
// `integration_credentials` row, encrypted at rest, created and rotated through
// Main's Admin → Connections → Credentials. Moving this endpoint means moving
// credential decryption into a second application, which is a decision to make
// deliberately and not inside an outage.
//
// The lookup is in `token.server.ts` beside this file rather than in it: a
// route may export only the HTTP verbs, and anything else fails the BUILD
// rather than the typecheck.

/** Public rendering configuration for shared maps; only a validated pk. token. */
export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const config = await mapboxConfig();
    return config
      ? json(config, { headers })
      : json({ message: MAPBOX_SETUP_MESSAGE }, { status: 503, headers });
  } catch {
    return json(
      { message: 'Map credentials are unavailable. Check Admin → Connections → Credentials.' },
      { status: 503, headers },
    );
  }
}
