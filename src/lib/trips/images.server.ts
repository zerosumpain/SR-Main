// src/lib/trips/images.server.ts
//
// Fetching places' photographs (./images): the place's Wikidata id from its
// OSM tags (a Nominatim lookup, paced like every other), then Wikidata for
// the image claim and Commons for the thumbnail and credits. In the
// background, after a plan or meal options change; the bundle reads what is
// cached. Two caches in `app_settings`:
//
//   trips.images.wikidata   Q-id → image or null, shared by every trip
//                           (a place's photo is the same for everyone),
//                           a miss re-checked after 30 days
//   trips.images.<tripId>   wish id → { osmId, wikidata }, so each place's
//                           OSM lookup is done once

import type { MealOption, PlaceImage, Wish } from './model';
import { commonsInfoUrl, imageFileFromEntity, imageFromCommons, WIKIDATA_URL, wikidataId } from './images';
import { lookupPlace } from './research.server';
import { readSetting, writeSetting } from './settings-cache.server';

const USER_AGENT = 'StrangeRamblingsTrips/1.0 (+https://strangeramblings.com; trips photos from Wikimedia Commons)';
const TIMEOUT_MS = 10_000;
const MISS_RETRY_MS = 30 * 24 * 3600_000;
/** Places looked up per run: a big trip fills over a few runs, not one long one. */
const PER_RUN = 40;
const MAX_SHARED = 3000;

const SHARED_KEY = 'trips.images.wikidata';
const tripKey = (tripId: string) => `trips.images.${tripId}`;

type Shared = Record<string, { image: PlaceImage | null; at: string }>;
type PerTrip = Record<string, { osmId: string | null; wikidata: string | null; at: string }>;

async function getJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** One Wikidata entry's photograph, or null when it has none we can use. */
export async function fetchImage(q: string): Promise<PlaceImage | null> {
  const file = imageFileFromEntity(await getJson(WIKIDATA_URL(q)), q);
  if (!file) return null;
  return imageFromCommons(await getJson(commonsInfoUrl(file)), q);
}

/** Wish id (or meal option OSM id) → photograph, from the caches only. */
export async function tripImages(tripId: string, wishes: Wish[], meals: MealOption[]): Promise<Record<string, PlaceImage>> {
  const [shared, perTrip] = await Promise.all([readSetting<Shared>(SHARED_KEY, {}), readSetting<PerTrip>(tripKey(tripId), {})]);
  const out: Record<string, PlaceImage> = {};
  for (const w of wishes) {
    const entry = perTrip[w.id];
    if (!entry?.wikidata || entry.osmId !== (w.place?.osmId ?? null)) continue;
    const image = shared[entry.wikidata]?.image;
    if (image) out[w.id] = image;
  }
  for (const m of meals) {
    const q = wikidataId(m.wikidata);
    const image = q ? shared[q]?.image : null;
    if (image) out[m.id] = image;
  }
  return out;
}

const running = new Set<string>();

/**
 * Fill the caches for a trip's placed wishes and its meal options, in the
 * background. Safe to call often: one run per trip at a time, and each
 * place is looked up once.
 */
export function startImages(tripId: string, wishes: Wish[], meals: MealOption[] = []): void {
  if (running.has(tripId)) return;
  running.add(tripId);
  void (async () => {
    try {
      const perTrip = await readSetting<PerTrip>(tripKey(tripId), {});
      let lookedUp = 0;
      let tripChanged = false;
      for (const w of wishes) {
        if (!w.place || w.suggested || lookedUp >= PER_RUN) continue;
        const osmId = w.place.osmId ?? null;
        if (perTrip[w.id] && perTrip[w.id].osmId === osmId) continue;
        lookedUp++;
        const found = osmId ? await lookupPlace(osmId) : null;
        perTrip[w.id] = { osmId, wikidata: wikidataId(found?.wikidata), at: new Date().toISOString() };
        tripChanged = true;
      }
      if (tripChanged) await writeSetting(tripKey(tripId), perTrip);

      const wanted = new Set<string>();
      for (const e of Object.values(perTrip)) if (e.wikidata) wanted.add(e.wikidata);
      for (const m of meals) {
        const q = wikidataId(m.wikidata);
        if (q) wanted.add(q);
      }
      const shared = await readSetting<Shared>(SHARED_KEY, {});
      let sharedChanged = false;
      const now = Date.now();
      for (const q of wanted) {
        const have = shared[q];
        if (have && (have.image || now - Date.parse(have.at) < MISS_RETRY_MS)) continue;
        shared[q] = { image: await fetchImage(q), at: new Date().toISOString() };
        sharedChanged = true;
      }
      if (sharedChanged) {
        const kept = Object.fromEntries(Object.entries(shared).sort((a, b) => (a[1].at < b[1].at ? 1 : -1)).slice(0, MAX_SHARED));
        await writeSetting(SHARED_KEY, kept);
      }
    } catch (err) {
      console.warn('[trips/images] run failed:', (err as Error)?.message);
    } finally {
      running.delete(tripId);
    }
  })();
}
