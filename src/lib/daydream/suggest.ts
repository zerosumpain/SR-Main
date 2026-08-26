// src/lib/daydream/suggest.ts
//
// Filling the naming form in before it is opened.
//
// The bottleneck this exists to clear: seven of nine detectors gate on a place
// having a human-given name, 78 of 83 places have none, and the only way a name
// has ever arrived is a notification asking "what is this place you keep going
// to?" about a coordinate. That question is unanswerable from a phone — it names
// nothing the owner can recognise, so it gets ignored, so the detectors that
// need names never fire, so the only thing the system ever says is the question
// that nobody can answer.
//
// A suggestion turns that into a confirmation. "Costa Coffee, 12 High Row" is a
// question with a yes/no answer; a lat/lon is a memory test.
//
// The suggestion NEVER becomes a name on its own. It lands in `suggestedLabel`,
// which nothing downstream reads as fact — only a tap promotes it into `label`.
// That boundary is the whole reason these are separate columns; see the note in
// schema.ts on the confirmed > geocoded > inferred ladder.

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces } from '$lib/db/schema';
import { suggestPlaceName, type PlaceSuggestion } from './geocode';
import { errMsg } from './types';

/**
 * Nominatim's usage policy is one request per second, absolute.
 *
 * Written as a floor between requests rather than a burst allowance because a
 * burst is exactly what gets an IP blocked, and the whole feature degrades to
 * "no suggestions" if that happens. `geocode.ts` caches for 30 days, so the
 * steady-state cost of this job after the first sweep is close to zero.
 */
export const NOMINATIM_MIN_INTERVAL_MS = 1100;

/**
 * How many places one run will look up.
 *
 * At the interval above this is about 40 seconds of wall clock, which is a
 * comfortable fraction of the hourly cadence and leaves the run interruptible.
 * The queue drains over a few hours rather than in one go, and that is fine —
 * nothing downstream is waiting on any individual suggestion.
 */
export const DEFAULT_BATCH = 30;

/**
 * How long a suggestion is trusted before it is worth asking again.
 *
 * A shop changes hands; a coordinate does not. Long, because a stale suggestion
 * costs one slightly-wrong prefill that the owner corrects in the box, whereas
 * re-asking often costs the request budget the policy above is protecting.
 */
export const SUGGESTION_TTL_DAYS = 90;

export interface SuggestResult {
  /** Places examined this run. */
  considered: number;
  /** Places that came back with a usable name. */
  named: number;
  /** Looked up, but the geocoder had nothing to offer. */
  blank: number;
  /** Lookups that threw or timed out. */
  failed: number;
}

export const EMPTY_SUGGEST: SuggestResult = { considered: 0, named: 0, blank: 0, failed: 0 };

/**
 * Should this answer be written down?
 *
 * The distinction that keeps the queue from either thrashing or going deaf:
 *
 *   • A name, or a street with no name — an answer. Stamp it.
 *   • A successful lookup that resolved to nothing — also an answer, and the
 *     one that matters most. A lay-by, a field edge, a spot with bad GPS will
 *     never resolve, and without a stamp those exact places are retried on
 *     every run forever, crowding out the ones that would resolve.
 *   • An outage — NOT an answer. Stamping here would silence a perfectly
 *     nameable place for three months over a dropped connection.
 *
 * Pure, so the gate covers it. The bug it guards against is invisible in
 * production until the queue has been quietly stuck for weeks.
 */
export function shouldStamp(source: PlaceSuggestion['source']): boolean {
  return source !== 'unavailable';
}

/**
 * Places that still need a suggestion.
 *
 * Ordered by visit count so the places the owner actually spends time in are
 * offered first — the naming session should open with somewhere recognisable,
 * not with the first car park the clusterer happened to find.
 *
 * Skips anything already named (a suggestion for a named place is wasted) and
 * anything ignored (the owner said stop asking, and that has to mean stop
 * spending requests on it too).
 */
export async function placesNeedingSuggestion(limit = DEFAULT_BATCH) {
  const staleBefore = new Date(Date.now() - SUGGESTION_TTL_DAYS * 86_400_000);
  return db
    .select({
      id: daydreamPlaces.id,
      lat: daydreamPlaces.lat,
      lon: daydreamPlaces.lon,
      visitCount: daydreamPlaces.visitCount,
    })
    .from(daydreamPlaces)
    .where(
      and(
        eq(daydreamPlaces.status, 'active'),
        isNull(daydreamPlaces.label),
        sql`(${daydreamPlaces.suggestedAt} is null or ${daydreamPlaces.suggestedAt} < ${staleBefore})`,
      ),
    )
    .orderBy(sql`${daydreamPlaces.visitCount} desc`, asc(daydreamPlaces.id))
    .limit(limit);
}

/**
 * Look up a batch of unnamed places and store what came back.
 *
 * `suggestedAt` is stamped even when the lookup returns nothing usable. That is
 * deliberate: without it, every place the geocoder cannot name — a lay-by, a
 * field edge, a spot with bad GPS — would be retried on every single run
 * forever, and those are exactly the places that never resolve. Stamping a
 * blank means "asked, got nothing, ask again in three months".
 */
export async function backfillSuggestions(
  opts: { limit?: number; intervalMs?: number } = {},
): Promise<SuggestResult> {
  const limit = opts.limit ?? DEFAULT_BATCH;
  const interval = opts.intervalMs ?? NOMINATIM_MIN_INTERVAL_MS;
  const result: SuggestResult = { ...EMPTY_SUGGEST };

  const queue = await placesNeedingSuggestion(limit);
  if (queue.length === 0) return result;

  for (let i = 0; i < queue.length; i++) {
    const place = queue[i];
    result.considered++;

    // The rate limit is a floor between REQUESTS, so it is paid before each one
    // after the first rather than after each — a run that ends on a failure
    // should not also have slept for nothing.
    if (i > 0) await new Promise((r) => setTimeout(r, interval));

    try {
      const suggestion = await suggestPlaceName(place.lat, place.lon);
      if (!shouldStamp(suggestion.source)) {
        result.failed++;
        // Not stamped. An outage is not an answer, and stamping here would
        // silence the place for three months over a transient network fault.
        continue;
      }

      await db
        .update(daydreamPlaces)
        .set({
          suggestedLabel: suggestion.name,
          suggestedKind: suggestion.kind,
          suggestedAddress: suggestion.address,
          suggestedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(daydreamPlaces.id, place.id));

      if (suggestion.name) result.named++;
      else result.blank++;
    } catch (err) {
      result.failed++;
      console.error(`[daydream] suggestion for ${place.id} failed:`, errMsg(err));
    }
  }

  return result;
}
