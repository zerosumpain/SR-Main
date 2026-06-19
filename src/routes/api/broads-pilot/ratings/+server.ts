// Public ratings proxy for Broads Pilot. Returns a numeric Google Places rating
// + a highlight/lowlight review snippet for a pub/mooring/attraction, cached
// in-memory. Fails SOFT: with no GOOGLE_PLACES_API_KEY it returns
// {available:false} and the UI falls back to deep-links (compliant — we never
// scrape or cache TripAdvisor; Google Places content is shown per its terms).
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

interface Cached { available: boolean; rating?: number; count?: number; highlight?: string; lowlight?: string; at: number }
const cache = new Map<string, Cached>();
const TTL = 21 * 24 * 60 * 60 * 1000; // Google Places content cache window

const KEY = () => env.GOOGLE_PLACES_API_KEY || '';

async function findPlaceId(name: string, lat?: number, lng?: number): Promise<string | null> {
  const params = new URLSearchParams({ input: name, inputtype: 'textquery', fields: 'place_id', key: KEY() });
  if (lat != null && lng != null) params.set('locationbias', `point:${lat},${lng}`);
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${params}`);
  if (!res.ok) return null;
  const j = await res.json();
  return j.candidates?.[0]?.place_id ?? null;
}

async function details(placeId: string): Promise<Cached> {
  const params = new URLSearchParams({ place_id: placeId, fields: 'rating,user_ratings_total,reviews', key: KEY() });
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params}`);
  if (!res.ok) return { available: false, at: Date.now() };
  const j = await res.json();
  const r = j.result;
  if (!r || r.rating == null) return { available: false, at: Date.now() };
  const reviews: { rating: number; text: string }[] = (r.reviews ?? []).filter((v: any) => v.text);
  const top = [...reviews].sort((a, b) => b.rating - a.rating)[0];
  const bottom = [...reviews].sort((a, b) => a.rating - b.rating)[0];
  const trim = (s?: string) => (s ? (s.length > 220 ? s.slice(0, 217) + '…' : s) : undefined);
  return {
    available: true, rating: r.rating, count: r.user_ratings_total,
    highlight: trim(top?.text), lowlight: bottom && bottom.rating <= 3 ? trim(bottom.text) : undefined,
    at: Date.now(),
  };
}

export const GET: RequestHandler = async ({ url }) => {
  if (!KEY()) return json({ available: false });
  const placeId = url.searchParams.get('place_id');
  const name = url.searchParams.get('name');
  const lat = url.searchParams.has('lat') ? Number(url.searchParams.get('lat')) : undefined;
  const lng = url.searchParams.has('lng') ? Number(url.searchParams.get('lng')) : undefined;
  const cacheKey = placeId || name || '';
  if (!cacheKey) return json({ available: false });

  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL) {
    const { at, ...rest } = hit;
    return json(rest);
  }
  try {
    const id = placeId || (name ? await findPlaceId(name, lat, lng) : null);
    const result = id ? await details(id) : { available: false, at: Date.now() };
    cache.set(cacheKey, result);
    const { at, ...rest } = result;
    return json(rest);
  } catch {
    return json({ available: false });
  }
};
