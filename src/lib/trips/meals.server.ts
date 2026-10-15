// src/lib/trips/meals.server.ts
//
// Finding the places for planned meals (./meals): Overpass round where you
// will be, Nominatim's bounded search when Overpass is busy (it answers 504
// from porkserv often enough to matter), ranked by ./meals. In the
// background after each solve; the bundle reads what is cached, so the phone
// carries the options offline. Cached in `app_settings` per trip by meal stop,
// with what the answer was for, so a re-plan that keeps lunch where it was
// keeps its options and one that moves it asks again.

import type { MealOption, SolvedPlan, Wish } from './model';
import { mealQuery, mealSearchArea, mealSlots, mealTerms, rankMealOptions, slotFingerprint, type MealSlot } from './meals';
import { dietaryHints, elementsFromNominatim, viewboxAround } from './nearby-ideas';
import { startImages } from './images.server';
import { nominatimAround, overpass } from './research.server';
import { readSetting, writeSetting } from './settings-cache.server';
import { latestPlan, loadState, type TripRecord } from './store.server';

/** Options are re-asked after this, places change hands. */
const FRESH_MS = 14 * 24 * 3600_000;
/** Meals looked up per run (each is an Overpass call, or two paced Nominatim ones). */
const PER_RUN = 16;

const cacheKey = (tripId: string) => `trips.meals.${tripId}`;

export type MealCache = Record<string, { fingerprint: string; options: MealOption[]; at: string }>;

/** Each meal stop's options, where the cache answers for that stop as it is now. */
export async function readMealOptions(tripId: string, plan: SolvedPlan): Promise<Record<string, MealOption[]>> {
  const cache = await readSetting<MealCache>(cacheKey(tripId), {});
  return currentOptions(cache, mealSlots(plan));
}

export function currentOptions(cache: MealCache, slots: MealSlot[]): Record<string, MealOption[]> {
  const out: Record<string, MealOption[]> = {};
  for (const slot of slots) {
    const hit = cache[slot.stopId];
    if (hit && hit.fingerprint === slotFingerprint(slot)) out[slot.stopId] = hit.options;
  }
  return out;
}

/** The meals whose options are missing, for another place or time, or old. */
export function staleSlots(cache: MealCache, slots: MealSlot[], now = Date.now()): MealSlot[] {
  return slots.filter((slot) => {
    const hit = cache[slot.stopId];
    return !hit || hit.fingerprint !== slotFingerprint(slot) || now - Date.parse(hit.at) > FRESH_MS;
  });
}

async function findFor(slot: MealSlot, wishes: Wish[], hints: string[]): Promise<MealOption[]> {
  const area = mealSearchArea(slot);
  let answer = await overpass(mealQuery(slot, area), { attempts: 1, timeoutMs: 12_000 }).catch(() => null);
  let options = rankMealOptions(answer, slot, { existing: wishes, hints });
  if (!options.length) {
    // Overpass busy or empty: Nominatim's bounded search, one paced term at a time.
    const rows: unknown[] = [];
    for (const term of mealTerms(slot)) rows.push(...(await nominatimAround(term, viewboxAround(area.centre, area.radiusM), 25)));
    answer = { elements: elementsFromNominatim(rows) };
    options = rankMealOptions(answer, slot, { existing: wishes, hints });
  }
  return options;
}

const running = new Set<string>();

/** Fill the trip's meal options in the background (one run per trip at a time). */
export function startMeals(trip: Pick<TripRecord, 'id' | 'profile'>, plan?: SolvedPlan): void {
  if (running.has(trip.id)) return;
  running.add(trip.id);
  void (async () => {
    try {
      const solved = plan ?? (await latestPlan(trip.id))?.plan;
      if (!solved) return;
      const [{ wishes }, cache] = await Promise.all([loadState(trip.id), readSetting<MealCache>(cacheKey(trip.id), {})]);
      const slots = mealSlots(solved);
      const hints = dietaryHints(trip.profile);
      let changed = false;
      for (const slot of staleSlots(cache, slots).slice(0, PER_RUN)) {
        const options = await findFor(slot, wishes, hints);
        cache[slot.stopId] = { fingerprint: slotFingerprint(slot), options, at: new Date().toISOString() };
        changed = true;
      }
      // Meals no longer in the plan go.
      const live = new Set(slots.map((s) => s.stopId));
      for (const id of Object.keys(cache)) if (!live.has(id)) { delete cache[id]; changed = true; }
      if (changed) await writeSetting(cacheKey(trip.id), cache);
      startImages(trip.id, wishes, Object.values(cache).flatMap((c) => c.options));
    } catch (err) {
      console.warn('[trips/meals] run failed:', (err as Error)?.message);
    } finally {
      running.delete(trip.id);
    }
  })();
}

/** Whether any meal of the plan still needs looking up (the bundle starts a run when so). */
export async function mealsPending(tripId: string, plan: SolvedPlan): Promise<boolean> {
  const cache = await readSetting<MealCache>(cacheKey(tripId), {});
  return staleSlots(cache, mealSlots(plan)).length > 0;
}

