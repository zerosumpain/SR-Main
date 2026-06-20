// Loads the bundled datasets from static/broads-pilot/*.json once and caches
// them. The service worker precaches these, so the planner works offline.
import type { Datasets, WaterGraph, Restrictions, Broad, Mooring, Poi, MooringPois, Boat, Meta } from './types';

let cache: Datasets | null = null;
let inflight: Promise<Datasets> | null = null;

const BASE = '/broads-pilot';

export async function loadDatasets(fetchFn: typeof fetch = fetch): Promise<Datasets> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const get = async <T>(name: string): Promise<T> => {
      const res = await fetchFn(`${BASE}/${name}.json`);
      if (!res.ok) throw new Error(`failed to load ${name}.json (${res.status})`);
      return (await res.json()) as T;
    };
    // broads.json is additive (bold open-water highlighting) — tolerate its
    // absence on older cached deploys rather than failing the whole load.
    const getOpt = async <T>(name: string, fallback: T): Promise<T> => {
      try { const res = await fetchFn(`${BASE}/${name}.json`); return res.ok ? ((await res.json()) as T) : fallback; }
      catch { return fallback; }
    };
    const [graph, restrictions, broadsDoc, moorings, pois, mooringPois, fleet, meta] = await Promise.all([
      get<WaterGraph>('graph'),
      get<Restrictions>('restrictions'),
      getOpt<{ broads: Broad[] }>('broads', { broads: [] }),
      get<Mooring[]>('moorings'),
      get<Poi[]>('pois'),
      get<MooringPois>('mooring_pois'),
      get<Boat[]>('fleet'),
      get<Meta>('meta'),
    ]);
    cache = { graph, restrictions, broads: broadsDoc.broads ?? [], moorings, pois, mooringPois, fleet, meta };
    inflight = null;
    return cache;
  })();
  return inflight;
}
