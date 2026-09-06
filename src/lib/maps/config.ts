export const MAPBOX_STYLE = 'mapbox://styles/mapbox/outdoors-v12';
export const MAPBOX_SETUP_MESSAGE = 'Add a Mapbox public token in Admin → Connections → Credentials, then reload the map.';

/** Only public, browser-safe tokens may cross the server boundary. */
export function isMapboxPublicToken(value: unknown): value is string {
  return typeof value === 'string' && /^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

export const OFFLINE_STYLE = {
  version: 8 as const, sources: {},
  layers: [{ id: 'offline-ground', type: 'background' as const, paint: { 'background-color': '#ede4d4' } }],
};
