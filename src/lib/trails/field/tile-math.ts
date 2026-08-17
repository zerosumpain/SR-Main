// Slippy-map tile arithmetic. Ported from JKAImaps.
//
// Pure — no Leaflet, no IndexedDB — so the download estimator can be tested
// without a browser.

export interface TileCoord {
  x: number;
  y: number;
  z: number;
}

export interface TileBounds {
  n: number;
  s: number;
  e: number;
  w: number;
}

export function latLngToTile(lat: number, lng: number, zoom: number): TileCoord {
  const n = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  // Clamp: a bound at the poles or the date line otherwise indexes off the grid.
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)), z: zoom };
}

export function tileKey(coord: TileCoord): string {
  return `${coord.z}/${coord.x}/${coord.y}`;
}

/**
 * Every tile covering `bounds` from minZoom to maxZoom inclusive.
 *
 * `padTiles` widens the area by whole tiles at each zoom, so panning slightly
 * off the route on the hill does not land on blank squares.
 */
export function getTilesInBounds(
  bounds: TileBounds,
  minZoom: number,
  maxZoom: number,
  padTiles = 1,
): TileCoord[] {
  const tiles: TileCoord[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const n = 2 ** z;
    const topLeft = latLngToTile(bounds.n, bounds.w, z);
    const bottomRight = latLngToTile(bounds.s, bounds.e, z);
    const x0 = Math.max(0, Math.min(topLeft.x, bottomRight.x) - padTiles);
    const x1 = Math.min(n - 1, Math.max(topLeft.x, bottomRight.x) + padTiles);
    const y0 = Math.max(0, Math.min(topLeft.y, bottomRight.y) - padTiles);
    const y1 = Math.min(n - 1, Math.max(topLeft.y, bottomRight.y) + padTiles);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) tiles.push({ x, y, z });
    }
  }
  return tiles;
}

/**
 * Rough download size.
 *
 * 25 KB per tile, measured rather than assumed: a sample over urban Sheffield
 * at z13 averaged ~27 KB. Empty countryside is lighter and dense city heavier,
 * so this is a middle figure — but it is deliberately not the 15 KB the
 * original JKAImaps used, which under-reported real downloads by about half
 * and would mislead anyone deciding whether to fetch a region on mobile data.
 */
export function estimateBytes(tileCount: number): number {
  return tileCount * 25_000;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
