import { getCredential, listCredentials } from '$lib/integrations/credentials';

// The Mapbox browser token, read out of the credential store.
//
// A SIBLING MODULE, not part of `+server.ts`, because SvelteKit allows a route
// file to export only the HTTP verbs and a short list of config names — a
// helper exported beside `GET` fails the build with "Invalid export", at
// `analyse_endpoint`, after everything else has passed. See
// $lib/db/schema.ts's own note about what may live in a generated file: same
// class of rule, different file.
//
// `.server.ts` rather than a plain `.ts`: this decrypts a credential, and the
// suffix is what makes SvelteKit refuse to bundle it into anything the browser
// can load, rather than that being true only by inspection.

export const MAPBOX_STYLE = 'mapbox://styles/mapbox/outdoors-v12';
export const MAPBOX_SETUP_MESSAGE =
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
