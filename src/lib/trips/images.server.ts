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
import { metresBetween } from './nearby-ideas';
import { findPlace, lookupPlace } from './research.server';
import { readSetting, writeSetting } from './settings-cache.server';

const USER_AGENT = 'StrangeRamblingsTrips/1.0 (+https://strangeramblings.com; trips photos from Wikimedia Commons)';
const TIMEOUT_MS = 10_000;
const MISS_RETRY_MS = 30 * 24 * 3600_000;
/** A place whose Wikidata id could not be found is looked up again after this. */
const LOOKUP_RETRY_MS = 7 * 24 * 3600_000;
/** A place found by name must be this close to where the plan has it, or it is not the place. */
const SAME_PLACE_M = 400;
/** Places looked up per run (background lane, a second each): a big trip fills over a few runs. */
const PER_RUN = 10;
const MAX_SHARED = 3000;

const SHARED_KEY = 'trips.images.wikidata';
const tripKey = (tripId: string) => `trips.images.${tripId}`;

type Shared = Record<string, { image: PlaceImage | null; at: string }>;
type PerTrip = Record<string, { osmId: string | null; wikidata: string | null; at: string }>;

/** The answer, or `undefined` when the service could not be asked (never cached as "none"). */
async function getJson(url: string): Promise<unknown | undefined> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

/** One Wikidata entry's photograph; null when it has none we can use; undefined when Wikimedia could not be asked. */
export async function fetchImage(q: string): Promise<PlaceImage | null | undefined> {
  const entity = await getJson(WIKIDATA_URL(q));
  if (entity === undefined) return undefined;
  const file = imageFileFromEntity(entity, q);
  if (!file) return null;
  const info = await getJson(commonsInfoUrl(file));
  if (info === undefined) return undefined;
  return imageFromCommons(info, q);
}

const fresh = (at: string, ms: number, now: number) => now - Date.parse(at) < ms;

/** A placed wish whose Wikidata id has not been looked up (or is due a retry). */
function lookupDue(entry: PerTrip[string] | undefined, osmId: string | null, now: number): boolean {
  if (!entry || entry.osmId !== osmId) return true;
  return !entry.wikidata && !fresh(entry.at, LOOKUP_RETRY_MS, now);
}

/** A Wikidata id whose photo has not been fetched (or whose miss is due a re-check). */
function imageDue(entry: Shared[string] | undefined, now: number): boolean {
  return !entry || (!entry.image && !fresh(entry.at, MISS_RETRY_MS, now));
}

/**
 * Wish id (or meal option OSM id) → photograph, from the caches only — and
 * whether there is anything left to look up, decided from the same read, so
 * a bundle read starts a run only when one would do something.
 */
export async function tripImages(tripId: string, wishes: Wish[], meals: MealOption[]): Promise<{ images: Record<string, PlaceImage>; pending: boolean }> {
  const [shared, perTrip] = await Promise.all([readSetting<Shared>(SHARED_KEY, {}), readSetting<PerTrip>(tripKey(tripId), {})]);
  const now = Date.now();
  const images: Record<string, PlaceImage> = {};
  let pending = false;
  for (const w of wishes) {
    if (!w.place || w.suggested) continue;
    const entry = perTrip[w.id];
    if (lookupDue(entry, w.place.osmId ?? null, now)) pending = true;
    if (!entry?.wikidata || entry.osmId !== (w.place.osmId ?? null)) continue;
    const have = shared[entry.wikidata];
    if (imageDue(have, now)) pending = true;
    if (have?.image) images[w.id] = have.image;
  }
  for (const m of meals) {
    const q = wikidataId(m.wikidata);
    if (!q) continue;
    if (imageDue(shared[q], now)) pending = true;
    const image = shared[q]?.image;
    if (image) images[m.id] = image;
  }
  return { images, pending };
}

const running = new Set<string>();

/**
 * Fill the caches for a trip's placed wishes and its meal options, in the
 * background lane (behind anything a person is waiting on). One run per
 * trip at a time; each place is looked up once, a miss again after a week.
 */
export function startImages(tripId: string, wishes: Wish[], meals: MealOption[] = []): void {
  if (running.has(tripId)) return;
  running.add(tripId);
  void (async () => {
    try {
      const now = Date.now();
      const perTrip = await readSetting<PerTrip>(tripKey(tripId), {});
      let lookedUp = 0;
      let tripChanged = false;
      // Wishes that have gone take their entries with them.
      const live = new Set(wishes.map((w) => w.id));
      for (const id of Object.keys(perTrip)) if (!live.has(id)) { delete perTrip[id]; tripChanged = true; }
      for (const w of wishes) {
        if (!w.place || w.suggested || lookedUp >= PER_RUN) continue;
        const osmId = w.place.osmId ?? null;
        if (!lookupDue(perTrip[w.id], osmId, now)) continue;
        lookedUp++;
        // By its OSM id; a place placed by hand (no id) by its name near
        // where it is — accepted only when the match is that same spot.
        let found = osmId ? await lookupPlace(osmId, { background: true }) : null;
        if (!osmId) {
          const near = await findPlace(w.place.name || w.title, w.place.location, { background: true });
          found = near && metresBetween(near.location, w.place.location) <= SAME_PLACE_M ? near : null;
        }
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
      const got: Shared = {};
      for (const q of wanted) {
        if (!imageDue(shared[q], now)) continue;
        const image = await fetchImage(q);
        // Wikimedia unreachable: ask again next time, never "no photo" for a month.
        if (image === undefined) continue;
        got[q] = { image, at: new Date().toISOString() };
      }
      if (Object.keys(got).length) {
        // Read again just before writing: another trip's run may have added its own.
        const latest = await readSetting<Shared>(SHARED_KEY, {});
        const merged = { ...latest, ...got };
        const kept = Object.fromEntries(Object.entries(merged).sort((a, b) => (a[1].at < b[1].at ? 1 : -1)).slice(0, MAX_SHARED));
        await writeSetting(SHARED_KEY, kept);
      }
    } catch (err) {
      console.warn('[trips/images] run failed:', (err as Error)?.message);
    } finally {
      running.delete(tripId);
    }
  })();
}

/** v8: the shared photo cache for some Wikidata entries (the research pack reads it before asking Commons). */
export async function sharedImages(qs: string[]): Promise<Record<string, PlaceImage | null>> {
  const shared = await readSetting<Shared>(SHARED_KEY, {});
  const now = Date.now();
  const out: Record<string, PlaceImage | null> = {};
  for (const q of qs) if (shared[q] && !imageDue(shared[q], now)) out[q] = shared[q].image;
  return out;
}

/** v8: photographs (or their absence) found in one batch, added to the shared cache. */
export async function rememberImages(got: Record<string, PlaceImage | null>): Promise<void> {
  if (!Object.keys(got).length) return;
  const at = new Date().toISOString();
  const latest = await readSetting<Shared>(SHARED_KEY, {});
  const merged: Shared = { ...latest, ...Object.fromEntries(Object.entries(got).map(([q, image]) => [q, { image, at }])) };
  const kept = Object.fromEntries(Object.entries(merged).sort((a, b) => (a[1].at < b[1].at ? 1 : -1)).slice(0, MAX_SHARED));
  await writeSetting(SHARED_KEY, kept);
}
