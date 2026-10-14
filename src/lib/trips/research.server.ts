// src/lib/trips/research.server.ts
//
// The brief scan (D4) and the free-text reader, the I/O half of ./research.
//
// Per wish: (a) the place from OpenStreetMap — Nominatim with `extratags`
// gives the position, `opening_hours`, `website` and `wikidata` in one
// request, and OSM answers MAY be stored (Mapbox search results may not, so
// they are never used here); (b) ONE web search (Tavily, through the shared
// client and its ledger); (c) ONE cheap model call reading those results into
// a fact sheet. "Look deeper" is one more search for one wish, depth 'deep'.
// After a full scan, up to five nearby extras from Overpass are offered as
// suggestions — never planned until accepted.
//
// It runs as a background job in this process; progress is written to the
// trip row (`research`) and the page polls it. A failure for one wish marks
// that wish's unknowns and moves on: research never blocks planning.

import { jsonCall } from './llm.server';
import type { Facts, LatLng, Wish } from './model';
import {
  emptyFacts,
  factsPrompt,
  FACTS_SYSTEM,
  overpassNearbyQuery,
  parseLooseJson,
  placeFromNominatim,
  readDraftWishes,
  readFacts,
  placeQueries,
  searchQuery,
  suggestionsFromOverpass,
  WISHES_SYSTEM,
  type DraftWish,
  type OsmPlace,
} from './research';
import { addWishes, getTrip, loadState, setResearch, updateWish, type ResearchState, type TripRecord } from './store.server';

const USER_AGENT = 'StrangeRamblingsTrips/1.0 (+https://strangeramblings.com)';
const OSM_TIMEOUT_MS = 10_000;
const LLM_TIMEOUT_MS = 45_000;
/** Nominatim's policy: one request a second from one source. */
const NOMINATIM_GAP_MS = 1_100;
/** A job that has not moved in this long is treated as dead (a restart mid-run). */
const STALE_MS = 15 * 60_000;
export const MAX_SUGGESTIONS = 5;

// ── The model ──────────────────────────────────────────────────────────────

/** One JSON call on the `trips-reader` workload. Throws when no model answers. */
async function readerJson(system: string, user: string, maxTokens: number): Promise<unknown> {
  return jsonCall('trips-reader', [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], { maxTokens, temperature: 0, timeoutMs: LLM_TIMEOUT_MS });
}

/** Free text → draft wishes for the person to confirm. Throws a sentence when no model answers. */
export async function draftWishesFromText(text: string, trip: Pick<TripRecord, 'destination'>): Promise<DraftWish[]> {
  try {
    const raw = await readerJson(WISHES_SYSTEM, `Trip to ${trip.destination}.\n\nWhat they wrote:\n${text.slice(0, 4000)}`, 1500);
    return readDraftWishes(raw);
  } catch (err) {
    console.warn('[trips/research] wish reader failed:', (err as Error)?.message);
    throw new Error('The reader is not available just now — add the wishes one at a time instead.');
  }
}

// ── OpenStreetMap ──────────────────────────────────────────────────────────

let nominatimChain = Promise.resolve();
function paced<T>(fn: () => Promise<T>): Promise<T> {
  const slot = nominatimChain.then(fn);
  nominatimChain = slot.then(
    () => new Promise((r) => setTimeout(r, NOMINATIM_GAP_MS)),
    () => new Promise((r) => setTimeout(r, NOMINATIM_GAP_MS)),
  );
  return slot;
}

async function nominatim(path: string, params: Record<string, string>): Promise<unknown[]> {
  return paced(async () => {
    const url = new URL(`https://nominatim.openstreetmap.org${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('extratags', '1');
    url.searchParams.set('accept-language', 'en');
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(OSM_TIMEOUT_MS) });
      if (!res.ok) return [];
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  });
}

/** Try `placeQueries` in turn until one is found (each one Nominatim request, paced). */
export async function findPlaceLoosely(query: string, destination: string | null, near: LatLng | null): Promise<OsmPlace | null> {
  for (const q of placeQueries(query, destination)) {
    const hit = await findPlace(q, near);
    if (hit) return hit;
  }
  return null;
}

/** Find a wish's place near the trip (a ~20 km box round `near` when known). */
export async function findPlace(query: string, near: LatLng | null): Promise<OsmPlace | null> {
  const params: Record<string, string> = { q: query, limit: '1' };
  if (near) {
    params.viewbox = `${near.lng - 0.2},${near.lat + 0.2},${near.lng + 0.2},${near.lat - 0.2}`;
    params.bounded = '1';
  }
  let rows = await nominatim('/search', params);
  if (!rows.length && near) rows = await nominatim('/search', { q: query, limit: '1' });
  return placeFromNominatim(rows[0]);
}

/** OSM tags for a place we already have, by its id (`node/123`). */
async function lookupPlace(osmId: string): Promise<OsmPlace | null> {
  const m = /^(node|way|relation)\/(\d+)$/.exec(osmId);
  if (!m) return null;
  const rows = await nominatim('/lookup', { osm_ids: `${m[1][0].toUpperCase()}${m[2]}` });
  return placeFromNominatim(rows[0]);
}

/** Overpass, with one retry: the public instance answers 504 when busy. */
export async function overpass(query: string, opts: { attempts?: number; timeoutMs?: number } = {}): Promise<unknown> {
  const attempts = opts.attempts ?? 2;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
      });
      if (res.ok) return await res.json();
    } catch {
      /* retry once */
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 3_000));
  }
  return null;
}

// ── One wish ───────────────────────────────────────────────────────────────

function centreOf(points: LatLng[]): LatLng | null {
  if (!points.length) return null;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
  };
}

async function researchWish(trip: TripRecord, wish: Wish, near: LatLng | null, depth: 'brief' | 'deep'): Promise<void> {
  const checkedAt = new Date().toISOString();
  // (a) the place
  let osm: OsmPlace | null = null;
  if (wish.place?.osmId) osm = await lookupPlace(wish.place.osmId);
  if (!osm && !wish.place) osm = await findPlace(`${wish.title}, ${trip.destination}`, near);
  const place: Wish['place'] =
    wish.place ?? (osm ? { name: osm.name, location: osm.location, osmId: osm.osmId, address: osm.address } : null);
  const osmFacts = { openingHoursText: osm?.openingHoursText ?? null, website: osm?.website ?? null, wikidata: osm?.wikidata ?? null };

  // (b) one search, (c) one read
  let facts: Facts;
  try {
    const { search } = await import('$lib/deepdive/tavily');
    const found = await search(searchQuery({ title: wish.title, place }, trip, depth), {
      purpose: depth === 'brief' ? 'trips.brief' : 'trips.deeper',
      maxResults: depth === 'brief' ? 5 : 8,
      searchDepth: 'basic',
    });
    const results = (found.results ?? []).map((r) => ({ title: r.title, url: r.url, content: r.content ?? '' }));
    let raw: unknown = null;
    if (results.length) {
      try {
        raw = await readerJson(FACTS_SYSTEM, factsPrompt({ wish: { title: wish.title, place }, trip, results, osm: osmFacts }), 900);
      } catch (err) {
        console.warn('[trips/research] fact reader failed:', (err as Error)?.message);
      }
    }
    facts = readFacts({ raw, results, osm: osmFacts, previous: wish.facts, depth, checkedAt });
  } catch (err) {
    // No search key, a timeout, a refusal: the sheet keeps what OSM said and lists the rest as unknown.
    console.warn('[trips/research] search failed:', (err as Error)?.message);
    facts = readFacts({ raw: null, results: [], osm: osmFacts, previous: wish.facts, depth, checkedAt });
    if (!wish.facts?.summary) facts.summary = 'Web search unavailable — only OpenStreetMap was checked.';
  }
  await updateWish(trip.id, wish.id, { place, facts });
}

// ── The job ────────────────────────────────────────────────────────────────

const running = new Set<string>();

function isLive(state: ResearchState | null): boolean {
  if (!state || state.state !== 'running') return false;
  return Date.now() - Date.parse(state.startedAt) < STALE_MS;
}

/**
 * Start the scan in the background. `wishIds` null = every wish not yet
 * researched (and not a suggestion); depth 'deep' is "look deeper" for one wish.
 * Returns false when a scan is already running for this trip.
 */
export async function startResearch(
  owner: string,
  tripId: string,
  opts: { wishIds: string[] | null; depth: 'brief' | 'deep'; onDone?: (tripId: string) => Promise<unknown> },
): Promise<boolean> {
  const trip = await getTrip(owner, tripId);
  if (!trip) return false;
  if (running.has(tripId) || isLive(trip.research)) return false;
  const { wishes, stays } = await loadState(tripId);
  const targets = wishes.filter((w) =>
    opts.wishIds ? opts.wishIds.includes(w.id) : !w.suggested && !w.skipped && (!w.facts || w.facts.depth === 'manual'),
  );
  const state: ResearchState = {
    state: 'running',
    depth: opts.depth,
    total: targets.length,
    done: 0,
    current: targets[0]?.title ?? null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    note: null,
  };
  await setResearch(tripId, state);
  running.add(tripId);
  void (async () => {
    try {
      const near = centreOf([...stays.map((s) => s.location), ...wishes.flatMap((w) => (w.place ? [w.place.location] : []))]);
      for (const [i, wish] of targets.entries()) {
        await setResearch(tripId, { ...state, done: i, current: wish.title });
        try {
          await researchWish(trip, wish, near, opts.depth);
        } catch (err) {
          console.warn(`[trips/research] ${wish.title}:`, (err as Error)?.message);
        }
      }
      let note: string | null = null;
      if (!opts.wishIds) note = await suggestNearby(tripId);
      await setResearch(tripId, { ...state, state: 'done', done: targets.length, current: null, finishedAt: new Date().toISOString(), note });
      if (opts.onDone) await opts.onDone(tripId).catch((err) => console.warn('[trips/research] re-plan failed:', (err as Error)?.message));
    } catch (err) {
      console.error('[trips/research] job failed:', err);
      await setResearch(tripId, { ...state, state: 'failed', current: null, finishedAt: new Date().toISOString(), note: 'The scan stopped — try again.' }).catch(() => {});
    } finally {
      running.delete(tripId);
    }
  })();
  return true;
}

/** Up to five nearby extras as suggestions (never planned until accepted). */
export async function suggestNearby(tripId: string, near: LatLng | null = null): Promise<string | null> {
  const { wishes, stays } = await loadState(tripId);
  const pending = wishes.filter((w) => w.suggested).length;
  if (pending >= MAX_SUGGESTIONS) return null;
  const located = wishes.filter((w) => !w.suggested && w.place).map((w) => w.place!.location);
  const centre = near ?? centreOf(located.length ? located : stays.map((s) => s.location));
  if (!centre) return null;
  const answer = await overpass(overpassNearbyQuery(centre, 1500));
  if (!answer) return 'Nearby suggestions unavailable (OpenStreetMap did not answer).';
  const picks = suggestionsFromOverpass(answer, wishes, centre, MAX_SUGGESTIONS - pending);
  await addWishes(
    tripId,
    picks.map((s) => ({
      title: s.title,
      priority: 'nice',
      durationSec: null,
      partOfDay: 'any',
      fixedDate: null,
      fixedStartMin: null,
      note: `Nearby ${s.kind.replace(/_/g, ' ')} — suggested from OpenStreetMap.`,
      suggested: true,
      place: s.place,
      facts: {
        ...emptyFacts('brief', new Date().toISOString()),
        openingHoursText: s.openingHoursText,
        officialUrl: s.website,
        sources: [{ url: 'https://www.openstreetmap.org/copyright', title: 'OpenStreetMap contributors' }],
        unknown: ['whether booking is needed', 'how far ahead to book', 'official booking link', 'price', 'typical visit length'],
      },
    })),
  );
  return picks.length ? `${picks.length} nearby suggestion${picks.length === 1 ? '' : 's'} added.` : null;
}
