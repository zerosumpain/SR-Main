// Offline map tiles in IndexedDB — the reason JKAImaps existed.
//
// Browser-only. Tiles stay client-side rather than moving to Postgres: they
// are third-party raster data measured in hundreds of megabytes, they must be
// readable with no network by definition, and the server has no use for them.

import { openDB, type IDBPDatabase } from 'idb';
import { estimateBytes, getTilesInBounds, tileKey, type TileBounds, type TileCoord } from './tile-math';

const DB_NAME = 'sr-trails-tiles';
const DB_VERSION = 1;
const STORE = 'tiles';
const REGIONS = 'regions';

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export interface CachedTile {
  key: string;
  blob: Blob;
  routeId: string | null;
  cachedAt: number;
  size: number;
}

export interface TileRegion {
  routeId: string;
  name: string;
  minZoom: number;
  maxZoom: number;
  tileCount: number;
  bytes: number;
  status: 'downloading' | 'complete' | 'partial';
  updatedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('routeId', 'routeId');
        }
        if (!database.objectStoreNames.contains(REGIONS)) {
          database.createObjectStore(REGIONS, { keyPath: 'routeId' });
        }
      },
    });
  }
  return dbPromise;
}

export async function getTile(key: string): Promise<CachedTile | undefined> {
  return (await db()).get(STORE, key);
}

export async function putTile(tile: CachedTile): Promise<void> {
  await (await db()).put(STORE, tile);
}

export async function listRegions(): Promise<TileRegion[]> {
  return (await db()).getAll(REGIONS);
}

export async function getRegion(routeId: string): Promise<TileRegion | undefined> {
  return (await db()).get(REGIONS, routeId);
}

export async function deleteRegion(routeId: string): Promise<void> {
  const database = await db();
  const tx = database.transaction([STORE, REGIONS], 'readwrite');
  const index = tx.objectStore(STORE).index('routeId');
  for await (const cursor of index.iterate(routeId)) cursor.delete();
  await tx.objectStore(REGIONS).delete(routeId);
  await tx.done;
}

export async function cacheUsage(): Promise<{ tiles: number; bytes: number }> {
  const database = await db();
  let tiles = 0;
  let bytes = 0;
  for await (const cursor of database.transaction(STORE).store.iterate()) {
    tiles++;
    bytes += (cursor.value as CachedTile).size ?? 0;
  }
  return { tiles, bytes };
}

export interface DownloadProgress {
  done: number;
  total: number;
  bytes: number;
  failed: number;
}

export interface DownloadOptions {
  routeId: string;
  name: string;
  bounds: TileBounds;
  minZoom?: number;
  maxZoom?: number;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}

/**
 * Tiles already held are skipped, so re-running a download tops up cheaply.
 *
 * Two tiles of padding, not one: the screen is wider than the route's bounding
 * box, so at the zoom you actually navigate at the viewport edges fall outside
 * it. With one tile of padding a verified offline run still fetched three
 * edge tiles from the network — which on a hill means three grey squares.
 */
export function planDownload(
  bounds: TileBounds,
  minZoom = 12,
  maxZoom = 16,
): { tiles: TileCoord[]; estimatedBytes: number } {
  const tiles = getTilesInBounds(bounds, minZoom, maxZoom, 2);
  return { tiles, estimatedBytes: estimateBytes(tiles.length) };
}

/**
 * Fetch and store every tile for a route's bounds.
 *
 * Sequential with a small delay rather than parallel: OSM's tile policy asks
 * for no bulk downloading and no heavy concurrency, and getting the home IP
 * blocked from the tile servers would take the map away everywhere, not just
 * here.
 */
export async function downloadRegion(opts: DownloadOptions): Promise<TileRegion> {
  const minZoom = opts.minZoom ?? 12;
  const maxZoom = opts.maxZoom ?? 16;
  const { tiles } = planDownload(opts.bounds, minZoom, maxZoom);

  const region: TileRegion = {
    routeId: opts.routeId,
    name: opts.name,
    minZoom,
    maxZoom,
    tileCount: tiles.length,
    bytes: 0,
    status: 'downloading',
    updatedAt: Date.now(),
  };
  await (await db()).put(REGIONS, region);

  let done = 0;
  let failed = 0;

  for (const coord of tiles) {
    if (opts.signal?.aborted) break;
    const key = tileKey(coord);

    if (await getTile(key)) {
      done++;
      opts.onProgress?.({ done, total: tiles.length, bytes: region.bytes, failed });
      continue;
    }

    try {
      const url = TILE_URL.replace('{z}', String(coord.z))
        .replace('{x}', String(coord.x))
        .replace('{y}', String(coord.y));
      const res = await fetch(url, { signal: opts.signal });
      if (!res.ok) throw new Error(`tile ${key}: ${res.status}`);
      const blob = await res.blob();
      await putTile({ key, blob, routeId: opts.routeId, cachedAt: Date.now(), size: blob.size });
      region.bytes += blob.size;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') break;
      failed++;
    }

    done++;
    opts.onProgress?.({ done, total: tiles.length, bytes: region.bytes, failed });
    await new Promise((r) => setTimeout(r, 60));
  }

  region.status = opts.signal?.aborted || failed > 0 || done < tiles.length ? 'partial' : 'complete';
  region.updatedAt = Date.now();
  await (await db()).put(REGIONS, region);
  return region;
}
