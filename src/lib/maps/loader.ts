/** Keep WebGL and its CSS out of routes that do not render a map. */
export async function loadMapbox(options: { offline?: boolean } = {}) {
  const { createMapTools } = await import('./mapbox');
  return createMapTools(options);
}
export type { MapView, MapLayer, MapTools } from './mapbox';
