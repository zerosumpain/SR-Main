// The one rule for which Mapbox token may be stored and sent to browsers.
//
// Shared by the credential create/replace routes (which refuse anything else)
// and `/api/maps/config` (which refuses to publish anything else). A secret
// `sk.` token must never be one mis-pasted credential away from the open
// internet. Pure, so it is safe to import from anywhere.

/** Only public, browser-safe tokens may cross the server boundary. */
export function isMapboxPublicToken(value: unknown): value is string {
  return typeof value === 'string' && /^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}
