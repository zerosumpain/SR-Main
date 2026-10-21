// src/lib/trips/pack.server.ts
//
// v8: the research pack, the I/O half (./pack has the rules). A `pack` job
// finds the trip's places once — OpenStreetMap round the stays (Overpass,
// with Nominatim's paced, bounded search when Overpass is busy), Wikidata for
// how famous each is and its photograph (Commons, through the shared photo
// cache), up to six web searches and three model calls to write it up — and
// stores them as `trip_place` rows with the summary on `trip.pack`.
//
// Built when a trip starts (./start.server) or its destination or dates
// change; refreshed on the first read inside the week before (hours,
// closures, events, the forecast); topped up on demand ("Look further").
// Every outside call degrades on its own: no search key → no searches and
// booking facts left unknown; no model → OSM's own facts; Overpass busy →
// Nominatim. A failed build leaves the pack it had.

import { localDateIn } from './routing';
export type { PackAction } from './pack';
import type { LatLng, PlaceImage, Wish } from './model';
import type { PackCalendarItem, PackPlace, PackSummary } from './decisions';
import { addPackPlaces, getPackPlace, listPackPlaces, readPack, removePackCandidates, runningJob, updatePackPlace, writePack } from './decisions.store.server';
import { newBudget, spend } from './agent';
import { jsonCall } from './llm.server';
import { elementsFromNominatim, viewboxAround } from './nearby-ideas';
import {
  batchSearchQuery,
  calendarSearchQuery,
  candidatesFromElements,
  closedOnDates,
  closureItems,
  commonsBatchUrl,
  FOOD_RADIUS_M,
  FOOD_TERMS,
  foodQuery,
  forecastReaches,
  forecastUrl,
  imagesFromCommonsBatch,
  KEEP_FOOD,
  KEEP_SIGHTS,
  PACK_BUDGET,
  PACK_STAGES,
  PACK_SYSTEM,
  packCounts,
  packDue,
  packHighlights,
  packNeighbourhoods,
  packPlaceOf,
  placesQuery,
  readSparql,
  readSynthesis,
  selectFood,
  selectSights,
  SIGHT_TERMS,
  SIGHTS_RADIUS_M,
  sightsQuery,
  sparqlFor,
  SYNTH_BATCH,
  synthesisPrompt,
  themeQuery,
  themeSearch,
  tripDates,
  weatherItems,
  filterPlaces,
  type PackAction,
  type PackCandidate,
  type SearchResult,
  type Written,
  mergeSamePlaces,
  highlightsSparql,
  readHighlights,
  middleOf,
  selectHighlights,
  KEEP_HIGHLIGHTS,
} from './pack';
import { emptyFacts } from './research';
import { nominatimAround, overpass, findPlace } from './research.server';
import { getTripById, loadState, type TripRecord } from './store.server';
import { JobCancelled, readJob, startJob, type JobHandle, type StageDecl, type TripJob } from './jobs.server';

const USER_AGENT = 'StrangeRamblingsTrips/1.0 (+https://strangeramblings.com; trips research pack)';
const FETCH_TIMEOUT_MS = 20_000;
const MODEL_TIMEOUT_MS = 120_000;

// ── The outside world (swappable in tests) ─────────────────────────────────

export interface PackDeps {
  overpass(query: string): Promise<unknown>;
  nominatim(term: string, viewbox: string, limit: number): Promise<unknown[]>;
  /** GET (or POST a form) and parse JSON; undefined when the service could not be asked. */
  fetchJson(url: string, init?: { method?: 'POST'; form?: Record<string, string>; accept?: string; timeoutMs?: number }): Promise<unknown | undefined>;
  /** True when a web search key is registered. */
  canSearch(): Promise<boolean>;
  search(query: string): Promise<SearchResult[]>;
  /** One write-up call (the cost-aware router picks the model). */
  model(system: string, user: string): Promise<unknown>;
  /** The shared photo cache (./images.server). */
  cachedImages(qs: string[]): Promise<Record<string, PlaceImage | null>>;
  rememberImages(got: Record<string, PlaceImage | null>): Promise<void>;
  /** Where a destination with no stay is (its centre). */
  findCentre(destination: string): Promise<LatLng | null>;
  now(): Date;
}

async function fetchJson(url: string, init: { method?: 'POST'; form?: Record<string, string>; accept?: string; timeoutMs?: number } = {}): Promise<unknown | undefined> {
  try {
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: init.accept ?? 'application/json', ...(init.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: init.form ? new URLSearchParams(init.form) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

/** Where a place is and its time zone, from Open-Meteo's geocoder (no key); null when it does not know it. */
export async function geocode(destination: string, get: PackDeps['fetchJson'] = fetchJson): Promise<{ name: string; location: LatLng; timeZone: string | null; country: string | null } | null> {
  const [name, ...rest] = destination.split(',').map((s) => s.trim()).filter(Boolean);
  if (!name) return null;
  const u = new URL('https://geocoding-api.open-meteo.com/v1/search');
  u.searchParams.set('name', name);
  u.searchParams.set('count', '5');
  u.searchParams.set('language', 'en');
  u.searchParams.set('format', 'json');
  const json = (await get(u.toString())) as { results?: Array<{ name?: string; latitude?: number; longitude?: number; timezone?: string; country?: string; population?: number }> } | undefined;
  const results = (json?.results ?? []).filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
  if (!results.length) return null;
  // "Rome, Italy": the one in that country; else the first (the geocoder ranks by size).
  const want = rest.join(' ').toLowerCase();
  const hit = (want && results.find((r) => (r.country ?? '').toLowerCase().includes(want) || want.includes((r.country ?? '').toLowerCase()))) || results[0];
  return { name: hit.name ?? name, location: { lat: hit.latitude!, lng: hit.longitude! }, timeZone: hit.timezone ?? null, country: hit.country ?? null };
}

export const LIVE_PACK_DEPS: PackDeps = {
  overpass: (q) => overpass(q, { attempts: 1, timeoutMs: 50_000 }),
  nominatim: (term, viewbox, limit) => nominatimAround(term, viewbox, limit, { background: true }),
  fetchJson,
  async canSearch() {
    try {
      const { getTavilyKey } = await import('$lib/llm/keys');
      return !!getTavilyKey();
    } catch {
      return false;
    }
  },
  async search(query) {
    const { search } = await import('$lib/deepdive/tavily');
    const found = await search(query, { purpose: 'trips.pack', maxResults: 6, searchDepth: 'basic' });
    return (found.results ?? []).map((r) => ({ title: r.title, url: r.url, content: (r.content ?? '').slice(0, 900) }));
  },
  model: (system, user) => jsonCall('trips-reader', [{ role: 'system', content: system }, { role: 'user', content: user }], { maxTokens: 6000, temperature: 0.2, timeoutMs: MODEL_TIMEOUT_MS }),
  async cachedImages(qs) {
    const { sharedImages } = await import('./images.server');
    return sharedImages(qs);
  },
  async rememberImages(got) {
    const { rememberImages } = await import('./images.server');
    await rememberImages(got);
  },
  async findCentre(destination) {
    return (await geocode(destination))?.location ?? (await findPlace(destination, null, { background: true }))?.location ?? null;
  },
  now: () => new Date(),
};

// ── Pieces of a build ──────────────────────────────────────────────────────

/** Where to look round: the stays (up to three), else the destination's centre. */
async function anchorsOf(trip: TripRecord, deps: PackDeps): Promise<{ anchors: LatLng[]; fromStays: boolean }> {
  const { stays } = await loadState(trip.id);
  const anchors: LatLng[] = [];
  for (const s of stays) if (!anchors.some((a) => Math.abs(a.lat - s.location.lat) < 0.004 && Math.abs(a.lng - s.location.lng) < 0.004)) anchors.push(s.location);
  if (anchors.length) return { anchors: anchors.slice(0, 3), fromStays: true };
  const centre = await deps.findCentre(trip.destination).catch(() => null);
  return { anchors: centre ? [centre] : [], fromStays: false };
}

/** Overpass, else Nominatim's paced search one term at a time. */
async function osmCandidates(queries: string[], terms: string[], anchors: LatLng[], radiusM: number, food: boolean, deps: PackDeps): Promise<PackCandidate[]> {
  const out: PackCandidate[] = [];
  for (const q of queries) {
    const answer = await deps.overpass(q).catch(() => null);
    out.push(...candidatesFromElements(answer, anchors, { food }));
    if (!out.length) break; // the first query failed: Overpass is busy, do not wait on the second
  }
  if (out.length) return dedupe(out);
  const rows: unknown[] = [];
  for (const term of terms) rows.push(...(await deps.nominatim(term, viewboxAround(anchors[0], radiusM), 30).catch(() => [])));
  return dedupe(candidatesFromElements({ elements: elementsFromNominatim(rows) }, anchors, { food }));
}

function dedupe(cands: PackCandidate[]): PackCandidate[] {
  const ids = new Set<string>();
  const names = new Set<string>();
  return cands
    .filter((c) => {
      const k = c.name.toLowerCase();
      if (ids.has(c.osmId) || names.has(k)) return false;
      ids.add(c.osmId);
      names.add(k);
      return true;
    })
    .sort((a, b) => a.distanceM - b.distanceM);
}

/** Wikidata: how many Wikipedias write about each, and its image file. In place. */
async function addFame(cands: PackCandidate[], deps: PackDeps): Promise<void> {
  const qs = [...new Set(cands.map((c) => c.wikidata).filter((q): q is string => !!q))];
  if (!qs.length) return;
  // sparqlFor takes 300 ids at a time; a city's highlights can bring more.
  const fame = new Map<string, { sitelinks: number; imageFile: string | null }>();
  for (let i = 0; i < qs.length && i < 1500; i += 300) {
    const json = await deps.fetchJson('https://query.wikidata.org/sparql', { method: 'POST', form: { query: sparqlFor(qs.slice(i, i + 300)), format: 'json' }, accept: 'application/sparql-results+json' }).catch(() => null);
    for (const [k, v] of readSparql(json)) fame.set(k, v);
  }
  for (const c of cands) {
    const f = c.wikidata ? fame.get(c.wikidata) : undefined;
    if (f) {
      c.sitelinks = f.sitelinks;
      c.imageFile = f.imageFile;
    }
  }
}

/** Photographs for the kept places: the shared cache first, then Commons in batches of 50. */
async function imagesFor(kept: PackCandidate[], deps: PackDeps): Promise<Map<string, PlaceImage>> {
  const out = new Map<string, PlaceImage>();
  const qs = kept.map((c) => c.wikidata).filter((q): q is string => !!q);
  const cached = await deps.cachedImages(qs).catch(() => ({}) as Record<string, PlaceImage | null>);
  for (const [q, img] of Object.entries(cached)) if (img) out.set(q, img);
  const wanted = new Map<string, string>();
  for (const c of kept) if (c.wikidata && c.imageFile && !(c.wikidata in cached)) wanted.set(c.imageFile, c.wikidata);
  const files = [...wanted.keys()];
  const got: Record<string, PlaceImage | null> = {};
  for (let i = 0; i < files.length; i += 50) {
    const chunk = files.slice(i, i + 50);
    const json = await deps.fetchJson(commonsBatchUrl(chunk));
    if (json === undefined) continue; // Wikimedia unreachable: ask again next time
    const found = imagesFromCommonsBatch(json, new Map(chunk.map((f) => [f, wanted.get(f)!])));
    for (const f of chunk) got[wanted.get(f)!] = found.get(wanted.get(f)!) ?? null;
  }
  for (const [q, img] of Object.entries(got)) if (img) out.set(q, img);
  await deps.rememberImages(got).catch(() => {});
  return out;
}

interface Spend {
  searches: ReturnType<typeof newBudget>;
  modelCalls: number;
}

/** One web search inside the build's budget; [] without a key, past the budget, or on failure. */
async function budgetedSearch(query: string, spent: Spend, can: boolean, deps: PackDeps): Promise<SearchResult[]> {
  if (!can) return [];
  if (!spend(spent.searches, 'web_search', { calls: PACK_BUDGET.searches, searches: PACK_BUDGET.searches }).ok) return [];
  try {
    return await deps.search(query);
  } catch (err) {
    console.warn('[trips/pack] search failed:', (err as Error)?.message);
    return [];
  }
}

/** One write-up call inside the budget; null past it or with no model. */
async function budgetedModel(user: string, spent: Spend, deps: PackDeps): Promise<unknown | null> {
  if (spent.modelCalls >= PACK_BUDGET.modelCalls) return null;
  spent.modelCalls++;
  try {
    return await deps.model(PACK_SYSTEM, user);
  } catch (err) {
    console.warn('[trips/pack] write-up unavailable:', (err as Error)?.message);
    return null;
  }
}

function travellersText(trip: TripRecord): string | null {
  const t = trip.profile?.travellers ?? [];
  if (!t.length) return null;
  return t.map((x) => (x.age != null && x.age < 18 ? `${x.name} (${x.age})` : x.name)).join(', ');
}

/** Mark the places a wish on the trip already uses as planned. */
function plannedMatch(place: Omit<PackPlace, 'id'>, wishes: Wish[]): Wish | null {
  return wishes.find((w) => !w.skipped && !w.suggested && ((place.place.osmId && w.place?.osmId === place.place.osmId) || w.title.toLowerCase() === place.name.toLowerCase())) ?? null;
}

const check = async (handle: JobHandle | null) => {
  if (handle && (await handle.cancelled())) throw new JobCancelled();
};

// ── The jobs ───────────────────────────────────────────────────────────────

export const PACK_JOB_STAGES: Record<PackAction, StageDecl[]> = {
  build: PACK_STAGES,
  refresh: PACK_STAGES.filter((s) => s.key === 'hours' || s.key === 'closures' || s.key === 'writing'),
  more: [
    { key: 'places', label: 'Looking further' },
    { key: 'writing', label: 'Writing it up' },
  ],
};

export interface PackResult {
  pack: PackSummary;
  places: PackPlace[];
}

/**
 * The whole build (the five stages). Old candidates go only at the end, so
 * a build that fails or is cancelled part way leaves the pack it had.
 */
export async function buildPack(trip: TripRecord, handle: JobHandle | null, deps: PackDeps = LIVE_PACK_DEPS): Promise<PackResult> {
  const before = await readPack(trip.id);
  try {
    return await build(trip, handle, deps);
  } catch (err) {
    // The pack it had stands; a first build that failed says so (a cancelled one is simply not there yet).
    const status: PackSummary['status'] = before.status === 'ready' ? 'ready' : err instanceof JobCancelled ? 'none' : 'failed';
    await writePack(trip.id, { status, stage: null }).catch(() => {});
    throw err;
  }
}

async function build(trip: TripRecord, handle: JobHandle | null, deps: PackDeps): Promise<PackResult> {
  const stage = (key: string, state: 'running' | 'done' | 'skipped' | 'failed', detail?: string | null) => handle?.stage(key, state, detail ?? null);
  const label = (key: string) => PACK_STAGES.find((s) => s.key === key)!.label;
  const checkedAt = deps.now().toISOString();
  const today = localDateIn(trip.timeZone, deps.now());
  const dates = tripDates(trip);
  const spent: Spend = { searches: newBudget(), modelCalls: 0 };
  const can = await deps.canSearch().catch(() => false);
  const [{ wishes }, existing] = await Promise.all([loadState(trip.id), listPackPlaces(trip.id)]);
  // Places in the plan or turned down stay from the last build; the new one does not repeat them.
  const keep = existing.filter((p) => p.status !== 'candidate');
  const exclude = new Set(keep.flatMap((p) => [p.place.osmId ?? '', p.name.toLowerCase()]).filter(Boolean));

  // 1. Places
  stage('places', 'running');
  await writePack(trip.id, { status: 'building', stage: label('places') });
  const where = await anchorsOf(trip, deps);
  const { fromStays } = where;
  if (!where.anchors.length) throw new Error(`could not place ${trip.destination} on the map`);
  // The city's famous sights, wherever the trip sleeps (Wikidata; best effort —
  // a slow answer only costs the highlights, never the build).
  const centre = fromStays ? await deps.findCentre(trip.destination).catch(() => null) : where.anchors[0];
  const highlightCands = centre
    ? readHighlights(await deps.fetchJson('https://query.wikidata.org/sparql', { method: 'POST', form: { query: highlightsSparql(centre), format: 'json' }, accept: 'application/sparql-results+json', timeoutMs: 40_000 }).catch(() => null), where.anchors)
    : [];
  // With no stay, look round the middle of the city's best-known sights, not
  // the geocoder's point for the name (for Rome that is by Termini, and the
  // "nearby" places all came from the Esquiline).
  const heart = fromStays ? null : middleOf(highlightCands);
  const anchors = heart ? [heart] : where.anchors;
  const sightCands = await osmCandidates([sightsQuery(anchors), placesQuery(anchors)], SIGHT_TERMS, anchors, SIGHTS_RADIUS_M, false, deps);
  await addFame(sightCands, deps);
  const highlights = selectHighlights(mergeSamePlaces(highlightCands), KEEP_HIGHLIGHTS, exclude);
  const nearby = selectSights(mergeSamePlaces(sightCands), KEEP_SIGHTS, new Set([...exclude, ...highlights.flatMap((h) => [h.osmId, h.name.toLowerCase()])]));
  const sights = mergeSamePlaces([...highlights, ...nearby]);
  stage('places', 'done', sights.length ? `Found ${sights.length} places` : 'OpenStreetMap had nothing to add just now');
  await check(handle);

  // 2. Food
  stage('food', 'running');
  await writePack(trip.id, { stage: label('food') });
  const foodCands = await osmCandidates([foodQuery(anchors)], FOOD_TERMS, anchors, FOOD_RADIUS_M, true, deps);
  await addFame(foodCands.filter((c) => c.wikidata), deps);
  const food = selectFood(mergeSamePlaces(foodCands), KEEP_FOOD, exclude);
  stage('food', 'done', food.length ? `${food.length} ${fromStays ? "near where you'll be" : 'near the centre'}` : 'None found nearby just now');
  await check(handle);

  // 3. Hours on the dates
  stage('hours', 'running');
  await writePack(trip.id, { stage: label('hours') });
  const kept = [...sights, ...food];
  const asFacts = kept.map((c) => ({ name: c.name, facts: c.openingHours ? { ...emptyFacts('brief', checkedAt), openingHoursText: c.openingHours } : null }));
  const closed = closedOnDates(asFacts, dates);
  const known = kept.filter((c) => c.openingHours).length;
  stage('hours', 'done', closed.length ? `${closed.length} closed on one of your days` : known ? `Hours known for ${known} places — none closed on your days` : 'Opening hours not on record');
  await check(handle);

  // 4. Closures, events, weather
  stage('closures', 'running');
  await writePack(trip.id, { stage: label('closures') });
  const calendarResults = await budgetedSearch(calendarSearchQuery(trip.destination, trip.startDate, trip.endDate), spent, can, deps);
  const weather = forecastReaches(trip.endDate, today) ? weatherItems(await deps.fetchJson(forecastUrl(anchors[0], trip.startDate, trip.endDate))) : [];
  const wet = weather.filter((w) => w.kind === 'weather');
  stage(
    'closures',
    'done',
    [wet.length ? `Rain likely on ${wet.length === 1 ? 'one day' : `${wet.length} days`}` : weather.length ? 'Dry on your dates' : 'Too far ahead for a forecast', can ? null : 'events not checked (no web search here)'].filter(Boolean).join(' · '),
  );
  await check(handle);

  // 5. Writing it up
  stage('writing', 'running');
  await writePack(trip.id, { stage: label('writing') });
  const batches: PackCandidate[][] = [];
  for (let i = 0; i < kept.length && batches.length < PACK_BUDGET.modelCalls; i += SYNTH_BATCH) batches.push(kept.slice(i, i + SYNTH_BATCH));
  const written = new Map<string, Written | null>();
  const neighbourhoods: Array<{ name: string; line: string }> = [];
  const found: Array<Omit<PackCalendarItem, 'placeId'> & { osmId: string | null }> = [];
  // The batches are written up side by side (each its own search and model
  // call, within the same budget): one after another took ~2.5 min of a
  // 4.5 min start on the preview, with the person watching.
  const reads = await Promise.all(
    batches.map(async (batch, i) => {
      const results = [...(await budgetedSearch(batchSearchQuery(trip.destination, batch, trip.startDate), spent, can, deps)), ...(i === 0 ? calendarResults : [])];
      const raw = await budgetedModel(synthesisPrompt({ trip, places: batch, results, travellers: travellersText(trip) }), spent, deps);
      return { batch, read: readSynthesis(raw, batch.length, results, trip) };
    }),
  );
  for (const { batch, read } of reads) {
    batch.forEach((c, j) => written.set(c.osmId, read.places[j]));
    neighbourhoods.push(...read.neighbourhoods);
    found.push(...read.calendar.map((c) => ({ date: c.date, kind: c.kind, text: c.text, sources: c.sources, osmId: c.ref !== null ? batch[c.ref].osmId : null })));
  }
  await check(handle);
  const images = await imagesFor(kept, deps);
  const rows = kept.map((c) => {
    const p = packPlaceOf(c, written.get(c.osmId) ?? null, c.wikidata ? (images.get(c.wikidata) ?? null) : null, checkedAt);
    const wish = plannedMatch(p, wishes);
    return wish ? { ...p, status: 'planned' as const, wishId: wish.id } : p;
  });
  await check(handle);
  await removePackCandidates(trip.id);
  const saved = await addPackPlaces(trip.id, rows);
  const all = [...keep, ...saved];
  const byOsm = new Map(saved.map((p) => [p.place.osmId, p.id]));
  const byName = new Map(saved.map((p) => [p.name, p.id]));
  const calendar: PackCalendarItem[] = [
    ...found.map(({ osmId, ...c }) => ({ ...c, placeId: osmId ? (byOsm.get(osmId) ?? null) : null })),
    ...closureItems(closed.map((c) => ({ ...c, id: byName.get(c.name) ?? null }))),
    ...weather,
  ];
  const summary = await writePack(trip.id, {
    status: 'ready',
    stage: null,
    builtAt: checkedAt,
    // Where it looked from: a trip with no stay is planned from here.
    centre: anchors[0] ?? null,
    counts: packCounts(all),
    calendar,
    neighbourhoods: packNeighbourhoods(trip.guide?.neighbourhoods ?? [], neighbourhoods, all),
    highlights: packHighlights(all, calendar),
  });
  stage('writing', 'done', summary.highlights[0] ?? `${all.length} places`);
  return { pack: summary, places: all };
}

/** The week-before refresh: hours, closures, events and the forecast; the places stay as they are. */
export async function refreshPack(trip: TripRecord, handle: JobHandle | null, deps: PackDeps = LIVE_PACK_DEPS): Promise<PackResult> {
  const stage = (key: string, state: 'running' | 'done' | 'skipped', detail?: string | null) => handle?.stage(key, state, detail ?? null);
  const now = deps.now();
  const checkedAt = now.toISOString();
  const today = localDateIn(trip.timeZone, now);
  const dates = tripDates(trip);
  const spent: Spend = { searches: newBudget(), modelCalls: 0 };
  const can = await deps.canSearch().catch(() => false);
  const [places, before] = await Promise.all([listPackPlaces(trip.id), readPack(trip.id)]);

  stage('hours', 'running');
  const live = places.filter((p) => p.status !== 'rejected');
  const closed = closedOnDates(live, dates);
  stage('hours', 'done', closed.length ? `${closed.length} closed on one of your days` : 'None closed on your days');
  await check(handle);

  stage('closures', 'running');
  const results = await budgetedSearch(calendarSearchQuery(trip.destination, trip.startDate, trip.endDate), spent, can, deps);
  const { anchors } = await anchorsOf(trip, deps);
  const weather = anchors.length && forecastReaches(trip.endDate, today) ? weatherItems(await deps.fetchJson(forecastUrl(anchors[0], trip.startDate, trip.endDate))) : [];
  stage('closures', 'done', weather.some((w) => w.kind === 'weather') ? 'Rain likely on some days' : weather.length ? 'Dry on your dates' : null);
  await check(handle);

  stage('writing', 'running');
  let found: PackCalendarItem[] = [];
  if (results.length) {
    const raw = await budgetedModel(synthesisPrompt({ trip, places: [], results }), spent, deps);
    found = readSynthesis(raw, 0, results, trip).calendar.map(({ ref: _r, ...c }) => ({ ...c, placeId: null }));
  }
  // What the build found online stays unless the refresh found something new.
  const kept = before.calendar.filter((c) => c.kind !== 'weather' && c.kind !== 'sun' && !(c.kind === 'closure' && c.sources.some((s) => /openstreetmap/.test(s.url))));
  const calendar = [...(found.length ? found : kept), ...closureItems(closed.map((c) => ({ ...c, id: c.id ?? null }))), ...weather];
  const summary = await writePack(trip.id, {
    status: 'ready',
    stage: null,
    refreshedAt: checkedAt,
    counts: packCounts(places),
    calendar,
    highlights: packHighlights(places, calendar),
    // A pack built before it kept its centre gets one (a trip with no stay is planned from it).
    ...(before.centre ? {} : { centre: middleOf(places.filter((p) => p.place?.location).map((p) => ({ osmId: p.place.osmId ?? p.id, name: p.name, location: p.place.location, address: null, kind: p.kind, tags: p.tags, openingHours: null, website: null, wikidata: p.wikidata, distanceM: 0, sitelinks: p.lessVisited ? 1 : 50, imageFile: null }))) ?? anchors[0] ?? null }),
  });
  stage('writing', 'done', summary.highlights.find((h) => /Rain/.test(h)) ?? 'Up to date');
  return { pack: summary, places };
}

/** "Look further": more places, optionally on a theme, added to the pack. */
export async function morePlaces(trip: TripRecord, theme: string | null, handle: JobHandle | null, deps: PackDeps = LIVE_PACK_DEPS): Promise<PackResult> {
  const stage = (key: string, state: 'running' | 'done', detail?: string | null) => handle?.stage(key, state, detail ?? null);
  const checkedAt = deps.now().toISOString();
  const spent: Spend = { searches: newBudget(), modelCalls: 0 };
  const can = await deps.canSearch().catch(() => false);
  const [{ wishes }, existing] = await Promise.all([loadState(trip.id), listPackPlaces(trip.id)]);
  const exclude = new Set(existing.flatMap((p) => [p.place.osmId ?? '', p.name.toLowerCase()]).filter(Boolean));

  stage('places', 'running');
  const { anchors } = await anchorsOf(trip, deps);
  if (!anchors.length) throw new Error(`could not place ${trip.destination} on the map`);
  const ask = themeSearch(theme);
  const cands = await osmCandidates([themeQuery(theme, anchors)], ask.terms, anchors, SIGHTS_RADIUS_M * 2, ask.food, deps);
  await addFame(cands, deps);
  const picked = (ask.food ? selectFood(cands, 12, exclude) : selectSights(cands, 12, exclude)).slice(0, 12);
  stage('places', 'done', picked.length ? `${picked.length} more` : 'Nothing new nearby');
  await check(handle);

  stage('writing', 'running');
  let saved: PackPlace[] = [];
  if (picked.length) {
    const results = await budgetedSearch(`${trip.destination} ${theme ?? 'less visited places'} ${picked.slice(0, 3).map((p) => p.name).join(', ')}`, spent, can, deps);
    const raw = await budgetedModel(synthesisPrompt({ trip, places: picked, results, theme, travellers: travellersText(trip) }), spent, deps);
    const read = readSynthesis(raw, picked.length, results, trip);
    const images = await imagesFor(picked, deps);
    saved = await addPackPlaces(
      trip.id,
      picked.map((c, i) => {
        const p = packPlaceOf(c, read.places[i], c.wikidata ? (images.get(c.wikidata) ?? null) : null, checkedAt);
        if (theme && !p.tags.includes(theme.toLowerCase().slice(0, 24))) p.tags = [...p.tags, theme.toLowerCase().slice(0, 24)].slice(0, 8);
        const wish = plannedMatch(p, wishes);
        return wish ? { ...p, status: 'planned' as const, wishId: wish.id } : p;
      }),
    );
  }
  const all = [...existing, ...saved];
  const before = await readPack(trip.id);
  const summary = await writePack(trip.id, { status: before.status === 'none' ? 'ready' : before.status, counts: packCounts(all), highlights: packHighlights(all, before.calendar) });
  stage('writing', 'done', saved.length ? `Added ${saved.length} ${saved.length === 1 ? 'place' : 'places'}` : 'Nothing new to add');
  return { pack: summary, places: all };
}

/** Builds running in this process, by trip — a second start joins the first. */
const building = new Map<string, { job: TripJob; owner: string }>();

/**
 * Start a pack job for `owner`. A job already running for the trip in this
 * process is returned instead (`joined`), so two reads never build twice.
 * After a build or refresh, questions are refreshed (a new booking deadline,
 * rain on a day with outdoor stops) unless the caller does that itself.
 */
export function startPackJob(
  trip: TripRecord,
  owner: string,
  action: PackAction,
  opts: { theme?: string | null; deps?: PackDeps; questions?: boolean } = {},
): { job: TripJob; joined: boolean; mine: boolean } {
  const running = building.get(trip.id);
  if (running) return { job: readJob(running.owner, running.job.id) ?? running.job, joined: true, mine: running.owner === owner.trim().toLowerCase() };
  const job = startJob(
    owner,
    'pack',
    async (handle) => {
      const deps = opts.deps ?? LIVE_PACK_DEPS;
      const fresh = (await getTripById(trip.id)) ?? trip;
      try {
        const result =
          action === 'refresh' ? await refreshPack(fresh, handle, deps) : action === 'more' ? await morePlaces(fresh, opts.theme ?? null, handle, deps) : await buildPack(fresh, handle, deps);
        if (opts.questions !== false && action !== 'more') {
          void import('./questions.server')
            .then((q) => q.refreshQuestions(fresh, { reason: 'research' }))
            .catch((err) => console.warn('[trips/pack] questions after research failed:', (err as Error)?.message));
        }
        return result;
      } finally {
        building.delete(trip.id);
      }
    },
    { tripId: trip.id, stages: PACK_JOB_STAGES[action] },
  );
  building.set(trip.id, { job, owner: owner.trim().toLowerCase() });
  return { job, joined: false, mine: true };
}

/**
 * Make sure the trip has a pack: a build when there is none (or the
 * destination or dates changed), a refresh when the trip is a week away and
 * the pack is older than that. Returns at once; the work runs as a job owned
 * by the trip's creator. Never throws.
 */
export async function ensurePack(trip: TripRecord, opts: { reason?: 'created' | 'changed' | 'read'; deps?: PackDeps } = {}): Promise<void> {
  try {
    // The placeholder draft has nowhere to look yet.
    if (!trip.destination || trip.destination === 'New trip' || building.has(trip.id)) return;
    // Another process (a deploy's overlap) may be building it.
    if (await runningJob(trip.id, 'pack').catch(() => null)) return;
    const stored = await readPack(trip.id);
    // 'building' with no job behind it: a build cut off by a restart. Treat it as failed.
    const pack = stored.status === 'building' ? { ...stored, status: 'failed' as const } : stored;
    let action: PackAction | null = null;
    if (opts.reason === 'changed') action = 'build';
    else if (opts.reason === 'created') action = pack.status === 'none' || pack.status === 'failed' ? 'build' : null;
    else action = packDue(trip, pack, localDateIn(trip.timeZone, new Date()));
    if (!action) return;
    startPackJob(trip, trip.ownerEmail, action, { deps: opts.deps });
  } catch (err) {
    console.warn('[trips/pack] could not start the research:', (err as Error)?.message);
  }
}

/** `GET pack`: the summary and the places, filtered by `?kind=` and `?tag=`. */
export async function packWire(tripId: string, q: { kind?: string | null; tag?: string | null } = {}): Promise<PackResult> {
  const [pack, places] = await Promise.all([readPack(tripId), listPackPlaces(tripId)]);
  return { pack, places: filterPlaces(places, q) };
}

/** Tests only. */
export function clearPackBuildsForTest(): void {
  building.clear();
}

/**
 * "Not this", from the pack browser: the place is turned down with why (a
 * preference signal the reaction questions read; it is never offered again).
 * The summary's counts follow. Null when there is no such place.
 */
export async function rejectPackPlace(tripId: string, placeId: string, reason: NonNullable<PackPlace['rejectReason']>): Promise<PackPlace | null> {
  const place = await getPackPlace(tripId, placeId);
  if (!place) return null;
  await updatePackPlace(tripId, placeId, { status: 'rejected', rejectReason: reason });
  const all = await listPackPlaces(tripId);
  const pack = await readPack(tripId);
  if (pack.status !== 'none') await writePack(tripId, { counts: packCounts(all), highlights: packHighlights(all, pack.calendar) }).catch(() => {});
  return { ...place, status: 'rejected', rejectReason: reason };
}
