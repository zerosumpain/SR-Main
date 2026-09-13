import { json } from '@sveltejs/kit';
import { getCredential, listCredentials } from '$lib/integrations/credentials';

// The browser's Mapbox token, for whoever is drawing a map.
//
// THIS IS NOT A MAIN FEATURE, AND THAT IS WHY IT WAS DELETED BY ACCIDENT.
// #871 pruned Main's whole `$lib/maps` tree — correctly: the health domain
// moved to SR-Health and nothing in Main draws a map any more. It took this
// endpoint with it, and SR-Health's browser code still fetches `/api/maps/config`
// by absolute path. cloudflared routes `/api/maps` here, not there, so every map
// on /health went to "Map imagery unavailable" the moment that release landed —
// the owner's activity pages, the routes, the segments and the shared copies
// alike. The dependency was an HTTP one and so nothing in either repository's
// build could see it.
//
// It lives HERE rather than in SR-Health because the token does: it is an
// `integration_credentials` row, encrypted at rest, created and rotated through
// Main's Admin → Connections → Credentials. Moving this endpoint means moving
// credential decryption into a second application, which is a decision to make
// deliberately and not inside an outage.
//
// Self-contained on purpose. The three constants below were the only part of
// `$lib/maps/config.ts` this route ever used, and restoring the tree around them
// would put back a maps library Main genuinely does not have a caller for.

const MAPBOX_STYLE = 'mapbox://styles/mapbox/outdoors-v12';
const SETUP_MESSAGE =
  'Add a Mapbox public token in Admin → Connections → Credentials, then reload the map.';

/** Only public, browser-safe tokens may cross the server boundary. */
export function isMapboxPublicToken(value: unknown): value is string {
  return typeof value === 'string' && /^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

export async function mapboxConfig(): Promise<{ accessToken: string; style: string } | null> {
  const credentials = await listCredentials('mapbox');
  // Creating a replacement credential rotates the token without a deployment.
  credentials.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  if (!credentials.length) return null;
  const credential = await getCredential<'apikey'>(credentials[0].id);
  if (
    credential?.integrationType !== 'mapbox' ||
    credential.kind !== 'apikey' ||
    // The gate that makes this route publishable at all: a secret key would
    // otherwise be one mis-typed credential away from the open internet.
    !isMapboxPublicToken(credential.payload.key)
  ) {
    return null;
  }
  return { accessToken: credential.payload.key, style: MAPBOX_STYLE };
}

/** Public rendering configuration for shared maps; only a validated pk. token. */
export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const config = await mapboxConfig();
    return config ? json(config, { headers }) : json({ message: SETUP_MESSAGE }, { status: 503, headers });
  } catch {
    return json(
      { message: 'Map credentials are unavailable. Check Admin → Connections → Credentials.' },
      { status: 503, headers },
    );
  }
}
