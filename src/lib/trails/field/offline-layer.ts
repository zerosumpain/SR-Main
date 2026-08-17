// A Leaflet tile layer that reads the offline cache before the network.
//
// Without this the download button is decoration: tiles would sit in
// IndexedDB while the map still went to openstreetmap.org and showed grey
// squares the moment there was no signal — which is exactly the situation the
// feature exists for.

import { getTile } from './tile-store';
import { tileKey } from './tile-math';

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const SUBDOMAINS = ['a', 'b', 'c'];

function networkUrl(coords: { x: number; y: number; z: number }): string {
  return OSM_URL.replace('{s}', SUBDOMAINS[(coords.x + coords.y) % SUBDOMAINS.length])
    .replace('{z}', String(coords.z))
    .replace('{x}', String(coords.x))
    .replace('{y}', String(coords.y));
}

/**
 * Build the cached-first tile layer.
 *
 * `L` is passed in rather than imported: Leaflet is loaded at runtime from
 * /vendor, so it does not exist as a module here.
 */
export function createOfflineTileLayer(L: any): any {
  const Layer = L.TileLayer.extend({
    createTile(coords: { x: number; y: number; z: number }, done: (err: unknown, tile: HTMLElement) => void) {
      const tile = document.createElement('img');
      tile.alt = '';
      const key = tileKey(coords);

      const fallBackToNetwork = () => {
        tile.crossOrigin = 'anonymous';
        tile.src = networkUrl(coords);
      };

      tile.onload = () => done(undefined, tile);
      tile.onerror = () => done(undefined, tile);

      getTile(key)
        .then((cached) => {
          if (cached?.blob) {
            const url = URL.createObjectURL(cached.blob);
            // Release the object URL once the image has taken it, or a long
            // session panning a cached region leaks a blob per tile.
            tile.onload = () => {
              URL.revokeObjectURL(url);
              done(undefined, tile);
            };
            tile.onerror = () => {
              URL.revokeObjectURL(url);
              fallBackToNetwork();
            };
            tile.src = url;
          } else {
            fallBackToNetwork();
          }
        })
        .catch(fallBackToNetwork);

      return tile;
    },
  });

  return new Layer('', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  });
}
