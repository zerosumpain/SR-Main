// Client helper for the Broads Pilot ratings proxy. Fetches a Google Places
// rating + highlight/lowlight snippet for a POI, caches per place/name in-module
// so re-opening a drawer doesn't refetch. Fails SOFT — any error or non-ok
// response resolves to { available:false } and never throws, so callers can
// fall back to the deep-links cleanly.
export interface Rating {
  available: boolean;
  rating?: number;
  count?: number;
  highlight?: string;
  lowlight?: string;
}

const cache = new Map<string, Rating>();

export async function getRating(opts: {
  place_id?: string | null;
  name?: string;
  lat?: number;
  lng?: number;
}): Promise<Rating> {
  const key = opts.place_id || opts.name || '';
  if (!key) return { available: false };

  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const params = new URLSearchParams();
    if (opts.place_id) params.set('place_id', opts.place_id);
    if (opts.name) params.set('name', opts.name);
    if (opts.lat != null) params.set('lat', String(opts.lat));
    if (opts.lng != null) params.set('lng', String(opts.lng));

    const res = await fetch(`/api/broads-pilot/ratings?${params}`);
    if (!res.ok) {
      const miss: Rating = { available: false };
      cache.set(key, miss);
      return miss;
    }
    const data = (await res.json()) as Rating;
    const result: Rating = data && typeof data.available === 'boolean' ? data : { available: false };
    cache.set(key, result);
    return result;
  } catch {
    const miss: Rating = { available: false };
    cache.set(key, miss);
    return miss;
  }
}
