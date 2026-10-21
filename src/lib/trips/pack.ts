// src/lib/trips/pack.ts
//
// v8: the research pack, the pure half. The pack is found ONCE when a trip
// starts (and refreshed a week before), so proposals, swaps and ideas draw
// on a stock of real places in seconds instead of searching live each time:
//
//   1. places    — OpenStreetMap round the stays (or the destination's
//                  centre): sights, museums, galleries, viewpoints, parks,
//                  historic places, markets, notable churches. Elements with
//                  a Wikidata entry are preferred; the entry's sitelink count
//                  is the fame signal (few sitelinks → `lessVisited`) and its
//                  image (P18) the photograph.
//   2. food      — restaurants, cafés and gelato near where they sleep.
//   3. hours     — each place's OSM opening hours checked against the dates.
//   4. closures  — one web search for closures, strikes and events on the
//                  dates (when a search key is registered) and the forecast
//                  (Open-Meteo, no key) when the trip is within 16 days.
//   5. writing   — ONE model call per ≤ 25 places writes why / kind / tags /
//                  duration / indoor / children / cost / booking, citing only
//                  URLs it was shown. Without a search, booking and price are
//                  left unknown rather than guessed.
//
// PURE: the fetches and the store are in ./pack.server.

import { addDays, datesBetween, dayNumber, isoWeekday } from './solver/calendar';
import { windowsOn } from './solver/hours';
import { haversineM } from './solver/estimate';
import { dayLabel } from './changes';
import type { Facts, LatLng, LocalDate, Neighbourhood, PlaceImage, Trip } from './model';
import type { CalendarKind, PackCalendarItem, PackKind, PackPlace, PackSummary, RejectReason, Source } from './decisions';
import { emptyFacts, officialOnly } from './research';
import { cleanImageUrl, imageFromCommons, wikidataId } from './images';
import type { StageDecl } from './jobs.server';

// ── Budget and stages ──────────────────────────────────────────────────────

/** Per build: web searches and model calls. */
export const PACK_BUDGET = { searches: 6, modelCalls: 3 } as const;
/** Places per model call. */
export const SYNTH_BATCH = 25;
/** What a build keeps: ~40–60 places. */
export const KEEP_SIGHTS = 38;
export const KEEP_FOOD = 18;
/** Fewer Wikipedia editions than this = not one of the famous few. */
export const LESS_VISITED_SITELINKS = 25;
/** The week-before refresh. */
export const REFRESH_WITHIN_DAYS = 7;
/** Open-Meteo forecasts this far ahead. */
export const FORECAST_DAYS = 16;
/** Sights within this of a stay (or the centre); food within FOOD_RADIUS_M of a stay. */
export const SIGHTS_RADIUS_M = 2000;
export const FOOD_RADIUS_M = 650;

export const PACK_STAGES: StageDecl[] = [
  { key: 'places', label: 'Finding places' },
  { key: 'food', label: 'Finding places to eat' },
  { key: 'hours', label: 'Checking opening hours on your dates' },
  { key: 'closures', label: 'Looking for closures and events' },
  { key: 'writing', label: 'Writing it up' },
];

// ── OpenStreetMap ──────────────────────────────────────────────────────────

const around = (r: number, at: LatLng) => `(around:${Math.round(r)},${at.lat.toFixed(6)},${at.lng.toFixed(6)})`;

/**
 * Sights with a Wikidata entry (the notability filter), plus museums,
 * galleries and viewpoints even without one, round each anchor. Parks,
 * churches and markets are a second query (./pack.server): on a busy public
 * Overpass the place_of_worship scan is what times out, and the first query
 * should not fail with it.
 */
export function sightsQuery(anchors: LatLng[], radiusM = SIGHTS_RADIUS_M): string {
  const lines = anchors.slice(0, 3).flatMap((a) => [
    `nwr["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|aquarium|theme_park)$"]["name"]["wikidata"]${around(radiusM, a)};`,
    `nwr["historic"~"^(monument|castle|ruins|archaeological_site|city_gate|fort|palace|aqueduct|church)$"]["name"]["wikidata"]${around(radiusM, a)};`,
    `nwr["tourism"~"^(museum|gallery|viewpoint)$"]["name"]${around(radiusM * 0.75, a)};`,
  ]);
  return `[out:json][timeout:45];(\n${lines.join('\n')}\n);out center tags qt 400;`;
}

/** How far from a city's centre its famous sights are looked for, and how many always join the pack. */
export const HIGHLIGHTS_RADIUS_M = 6000;
export const KEEP_HIGHLIGHTS = 24;
/** Wikipedia editions a place needs to count as one of a city's highlights. */
export const HIGHLIGHT_SITELINKS = 25;

/**
 * The city's famous sights, wherever the trip sleeps: the radius round a stay
 * (or one centre point) can miss the very places people go for — a Rome pack
 * centred on the Esquiline had no Pantheon, Trevi, Navona or St Peter's.
 * Asked of Wikidata (its geo search answers in seconds and ranks by fame;
 * Overpass was "at capacity" for a city-wide query), restricted to kinds of
 * place a visitor goes to — not the empires, treaties and artworks that also
 * carry Rome's coordinates.
 */
export const HIGHLIGHT_CLASSES = [
  'Q570116', // tourist attraction
  'Q33506', // museum
  'Q4989906', // monument
  'Q839954', // archaeological site
  'Q16970', // church building
  'Q174782', // square
  'Q483453', // fountain
  'Q22698', // park
  'Q23413', // castle
  'Q16560', // palace
  'Q12518', // tower
  'Q12280', // bridge
  'Q1081138', // historic site
  'Q44539', // temple
  'Q1107656', // garden
  'Q57821', // fortification
  'Q53060', // gate
  'Q2319498', // landmark
  'Q24398318', // religious building
];

export function highlightsSparql(centre: LatLng, radiusM = HIGHLIGHTS_RADIUS_M, minLinks = HIGHLIGHT_SITELINKS, limit = 40): string {
  return [
    'SELECT ?item (SAMPLE(?label) AS ?name) (SAMPLE(?loc) AS ?coord) (MAX(?links) AS ?n) (SAMPLE(?image) AS ?img) WHERE {',
    `  SERVICE wikibase:around { ?item wdt:P625 ?loc . bd:serviceParam wikibase:center "Point(${centre.lng} ${centre.lat})"^^geo:wktLiteral . bd:serviceParam wikibase:radius "${Math.round(radiusM / 100) / 10}" . }`,
    `  ?item wikibase:sitelinks ?links . FILTER(?links >= ${minLinks})`,
    // Two subclass steps, not P279*: the full closure took over 20 s uncached.
    '  ?item wdt:P31/wdt:P279?/wdt:P279? ?class .',
    `  VALUES ?class { ${HIGHLIGHT_CLASSES.map((q) => `wd:${q}`).join(' ')} }`,
    '  OPTIONAL { ?item wdt:P18 ?image }',
    '  ?item rdfs:label ?label . FILTER(LANG(?label) = "en")',
    `} GROUP BY ?item ORDER BY DESC(?n) LIMIT ${limit}`,
  ].join('\n');
}

/** A highlight's key until it is matched to OpenStreetMap: `wd:<Q>` (never stored as an OSM id). */
export const isWikidataKey = (id: string | null | undefined) => !!id && id.startsWith('wd:');

/** Wikidata's answer → candidates (distance from the nearest anchor; sitelinks and image file filled). */
export function readHighlights(json: unknown, anchors: LatLng[]): PackCandidate[] {
  const rows = (json as { results?: { bindings?: Array<Record<string, { value?: string }>> } } | null)?.results?.bindings ?? [];
  const out: PackCandidate[] = [];
  for (const b of rows) {
    const q = wikidataId(b.item?.value?.split('/').pop());
    const name = b.name?.value?.trim();
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord?.value ?? '');
    if (!q || !name || !m) continue;
    const location = { lat: Number(m[2]), lng: Number(m[1]) };
    const file = b.img?.value ? decodeURIComponent(b.img.value.split('/').pop() ?? '').replace(/_/g, ' ') : null;
    const lower = name.toLowerCase();
    const kind: PackKind = /museum|musei|gallery|galleria|chapel/.test(lower) ? 'museum' : /basilica|church|chiesa|cathedral|duomo|san |santa |santi /.test(lower) ? 'church' : /park|garden|villa /.test(lower) ? 'park' : 'sight';
    out.push({
      osmId: `wd:${q}`,
      name,
      location,
      address: null,
      kind,
      tags: [],
      openingHours: null,
      website: null,
      wikidata: q,
      distanceM: Math.round(Math.min(...anchors.map((a) => metresApart(a, location)))),
      sitelinks: Number(b.n?.value ?? 0) || null,
      imageFile: file || null,
    });
  }
  return out;
}

/** The best-known of the city-wide candidates, most Wikipedia editions first. */
export function selectHighlights(cands: PackCandidate[], keep = KEEP_HIGHLIGHTS, exclude: Set<string> = new Set()): PackCandidate[] {
  return cands
    .filter((c) => !isFood(c.kind) && !exclude.has(c.osmId) && !exclude.has(c.name.toLowerCase()) && (c.sitelinks ?? 0) >= HIGHLIGHT_SITELINKS)
    .sort((a, b) => (b.sitelinks ?? 0) - (a.sitelinks ?? 0) || a.name.localeCompare(b.name))
    .slice(0, keep);
}

export function placesQuery(anchors: LatLng[], radiusM = SIGHTS_RADIUS_M): string {
  const lines = anchors.slice(0, 3).flatMap((a) => [
    `nwr["leisure"~"^(park|garden)$"]["name"]["wikidata"]${around(radiusM, a)};`,
    `nwr["amenity"~"^(place_of_worship|marketplace)$"]["name"]["wikidata"]${around(radiusM, a)};`,
    `nwr["amenity"="marketplace"]["name"]${around(radiusM * 0.75, a)};`,
  ]);
  return `[out:json][timeout:40];(\n${lines.join('\n')}\n);out center tags qt 300;`;
}

export function foodQuery(anchors: LatLng[], radiusM = FOOD_RADIUS_M): string {
  const lines = anchors.slice(0, 3).map((a) => `nwr["amenity"~"^(restaurant|cafe|ice_cream)$"]["name"]${around(radiusM, a)};`);
  return `[out:json][timeout:30];(\n${lines.join('\n')}\n);out center tags qt 300;`;
}

/** Nominatim terms for the fallback when Overpass is busy (one paced request each). */
export const SIGHT_TERMS = ['museum', 'gallery', 'monument', 'church', 'park', 'viewpoint', 'market', 'attraction'];
export const FOOD_TERMS = ['restaurant', 'cafe', 'gelato'];

/** "More" with a theme: what to look for, as Overpass lines and Nominatim terms. */
export function themeSearch(theme: string | null): { lines: (r: number, a: LatLng) => string[]; terms: string[]; food: boolean } {
  const t = (theme ?? '').toLowerCase();
  if (/kid|child|family|play/.test(t))
    return { lines: (r, a) => [`nwr["leisure"~"^(playground|park|water_park)$"]["name"]${around(r, a)};`, `nwr["tourism"~"^(zoo|aquarium|theme_park)$"]["name"]${around(r * 3, a)};`], terms: ['playground', 'zoo', 'park'], food: false };
  if (/food|eat|restaurant|pizza|lunch|dinner|street/.test(t))
    return { lines: (r, a) => [`nwr["amenity"~"^(restaurant|fast_food|cafe|ice_cream)$"]["name"]${around(r, a)};`], terms: ['restaurant', 'pizza', 'trattoria'], food: true };
  if (/rain|indoor|museum|art|gallery/.test(t))
    return { lines: (r, a) => [`nwr["tourism"~"^(museum|gallery)$"]["name"]${around(r * 1.5, a)};`], terms: ['museum', 'gallery'], food: false };
  if (/park|green|nature|garden|walk|view/.test(t))
    return { lines: (r, a) => [`nwr["leisure"~"^(park|garden|nature_reserve)$"]["name"]${around(r * 2, a)};`, `nwr["tourism"="viewpoint"]${around(r * 2, a)};`], terms: ['park', 'garden', 'viewpoint'], food: false };
  if (/shop|market/.test(t))
    return { lines: (r, a) => [`nwr["amenity"="marketplace"]["name"]${around(r * 1.5, a)};`, `nwr["shop"~"^(books|antiques|art|craft|deli)$"]["name"]${around(r, a)};`], terms: ['market', 'bookshop'], food: false };
  // No theme (or one we do not know): further out than the build looked.
  return { lines: (r, a) => [`nwr["tourism"~"^(attraction|museum|gallery|viewpoint)$"]["name"]["wikidata"]${around(r * 2, a)};`, `nwr["historic"]["name"]["wikidata"]${around(r * 2, a)};`], terms: ['museum', 'attraction', 'park'], food: false };
}

export function themeQuery(theme: string | null, anchors: LatLng[], radiusM = SIGHTS_RADIUS_M): string {
  const s = themeSearch(theme);
  const lines = anchors.slice(0, 2).flatMap((a) => s.lines(radiusM, a));
  return `[out:json][timeout:40];(\n${lines.join('\n')}\n);out center tags qt 300;`;
}

/** A place OpenStreetMap gave us, before Wikidata and the model have added to it. */
export interface PackCandidate {
  osmId: string;
  name: string;
  location: LatLng;
  address: string | null;
  kind: PackKind;
  tags: string[];
  openingHours: string | null;
  website: string | null;
  wikidata: string | null;
  /** Metres to the nearest anchor (stay or centre). */
  distanceM: number;
  /** Wikipedia editions about it — the fame signal; null when unknown. */
  sitelinks: number | null;
  /** The Wikidata entry's image (P18) file name. */
  imageFile: string | null;
}

/** OSM tags → our kind; null for something the pack does not keep. */
export function kindOfTags(t: Record<string, string>): PackKind | null {
  const cuisine = (t.cuisine ?? '').toLowerCase();
  if (t.amenity === 'ice_cream' || /(^|;)\s*(ice_cream|gelato)/.test(cuisine)) return 'gelato';
  if (t.amenity === 'cafe') return 'cafe';
  if (t.amenity === 'restaurant' || t.amenity === 'fast_food') return 'food';
  if (t.amenity === 'marketplace') return 'market';
  if (t.amenity === 'place_of_worship' || t.historic === 'church') return 'church';
  if (t.tourism === 'zoo' || t.tourism === 'aquarium' || t.tourism === 'theme_park' || t.leisure === 'playground' || t.leisure === 'water_park') return 'kids';
  if (t.tourism === 'museum' || t.tourism === 'gallery') return 'museum';
  if (t.tourism === 'viewpoint') return 'viewpoint';
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'nature_reserve') return 'park';
  if (t.shop) return 'shop';
  if (t.historic || t.tourism === 'attraction') return 'sight';
  return null;
}

const FOOD_KINDS: readonly PackKind[] = ['food', 'cafe', 'gelato'];
export const isFood = (k: PackKind) => FOOD_KINDS.includes(k);

/** Tags OSM can vouch for; the model adds its own. */
function osmTags(t: Record<string, string>, kind: PackKind): string[] {
  const out = new Set<string>();
  if (t.fee === 'no') out.add('free');
  if (kind === 'museum' || kind === 'church') out.add('rainy-day');
  if (t.tourism === 'gallery') out.add('art');
  if (t.historic === 'archaeological_site' || t.historic === 'ruins') out.add('ancient');
  if (kind === 'park' || kind === 'viewpoint') out.add('outdoor');
  for (const c of (t.cuisine ?? '').toLowerCase().split(/[;,]/).map((x) => x.trim().replace(/_/g, ' ')).filter(Boolean).slice(0, 2)) out.add(c);
  return [...out].slice(0, 6);
}

/** Overpass `elements` (or Nominatim rows made to look like them) → candidates, nearest anchor first. */
export function candidatesFromElements(answer: unknown, anchors: LatLng[], opts: { food?: boolean } = {}): PackCandidate[] {
  const elements = (answer as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const seen = new Set<string>();
  const names = new Set<string>();
  const out: PackCandidate[] = [];
  for (const raw of elements) {
    const e = raw as { type?: string; id?: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> };
    const t = e.tags ?? {};
    const name = (t['name:en'] ?? t.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const lat = Number(e.lat ?? e.center?.lat);
    const lng = Number(e.lon ?? e.center?.lon);
    if (!name || !e.type || e.id == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const kind = kindOfTags(t);
    if (!kind || isFood(kind) !== (opts.food === true)) continue;
    const osmId = `${e.type}/${e.id}`;
    const key = name.toLowerCase();
    if (seen.has(osmId) || names.has(key)) continue;
    seen.add(osmId);
    names.add(key);
    const at = { lat, lng };
    const address = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ') || null;
    out.push({
      osmId,
      name,
      location: at,
      address,
      kind,
      tags: osmTags(t, kind),
      openingHours: t.opening_hours?.trim() || null,
      website: officialOnly(t.website ?? t['contact:website'] ?? null),
      wikidata: wikidataId(t.wikidata),
      distanceM: anchors.length ? Math.round(Math.min(...anchors.map((a) => haversineM(a, at)))) : 0,
      sitelinks: null,
      imageFile: null,
    });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM || a.name.localeCompare(b.name));
}

/** A place is "less visited" when Wikidata says few write about it (or nobody has). Food never is. */
export function lessVisitedOf(c: Pick<PackCandidate, 'kind' | 'sitelinks' | 'wikidata'>): boolean {
  if (isFood(c.kind)) return false;
  if (c.sitelinks === null) return true;
  return c.sitelinks < LESS_VISITED_SITELINKS;
}

/** Kinds worth keeping even when obscure (a quiet museum is a find; a minor plaque is not). */
const WORTH_FINDING: readonly PackKind[] = ['museum', 'park', 'viewpoint', 'church', 'market', 'kids'];

/**
 * The sights to keep: the famous first (most sitelinks), then at least a
 * quarter less visited — nearest first, one kind at a time so it is not all
 * churches — so a proposal is never just the five most famous places.
 */
export function selectSights(cands: PackCandidate[], keep = KEEP_SIGHTS, exclude: Set<string> = new Set()): PackCandidate[] {
  const pool = cands.filter((c) => !isFood(c.kind) && !exclude.has(c.osmId) && !exclude.has(c.name.toLowerCase()));
  // A "sight" with no Wikidata entry, or one with a single article, is usually a plaque or a statue.
  const worthy = pool.filter((c) => WORTH_FINDING.includes(c.kind) || (c.sitelinks ?? 0) >= 3);
  const famous = worthy.filter((c) => !lessVisitedOf(c)).sort((a, b) => (b.sitelinks ?? 0) - (a.sitelinks ?? 0) || a.distanceM - b.distanceM);
  const quiet = worthy.filter((c) => lessVisitedOf(c)).sort((a, b) => a.distanceM - b.distanceM || (b.sitelinks ?? 0) - (a.sitelinks ?? 0));
  const quietShare = Math.max(Math.ceil(keep / 4), keep - famous.length);
  const out = famous.slice(0, keep - Math.min(quietShare, quiet.length));
  // Round-robin by kind among the quieter ones.
  const byKind = new Map<PackKind, PackCandidate[]>();
  for (const c of quiet) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
  const queues = [...byKind.values()];
  for (let i = 0; out.length < keep && queues.some((q) => q.length); i++) {
    const q = queues[i % queues.length];
    const next = q.shift();
    if (next) out.push(next);
  }
  return out;
}

/** Food near where they sleep: some of each (gelato, cafés, restaurants), the best-described first. */
export function selectFood(cands: PackCandidate[], keep = KEEP_FOOD, exclude: Set<string> = new Set()): PackCandidate[] {
  const caps: Partial<Record<PackKind, number>> = { gelato: 4, cafe: 5, food: keep };
  const score = (c: PackCandidate) => (c.openingHours ? 2 : 0) + (c.tags.length ? 1 : 0) + (c.website ? 1 : 0) + (c.wikidata ? 2 : 0) - c.distanceM / 250;
  const sorted = cands.filter((c) => isFood(c.kind) && !exclude.has(c.osmId) && !exclude.has(c.name.toLowerCase())).sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  const used: Partial<Record<PackKind, number>> = {};
  const out: PackCandidate[] = [];
  for (const c of sorted) {
    if (out.length >= keep) break;
    if ((used[c.kind] ?? 0) >= (caps[c.kind] ?? keep)) continue;
    used[c.kind] = (used[c.kind] ?? 0) + 1;
    out.push(c);
  }
  return out;
}

// ── Wikidata and Commons ───────────────────────────────────────────────────

/** One query for every entry: how many Wikipedias write about it, and its image. */
export function sparqlFor(qs: string[]): string {
  const ids = [...new Set(qs.map(wikidataId).filter((q): q is string => !!q))].slice(0, 300);
  return `SELECT ?item ?links ?image WHERE { VALUES ?item { ${ids.map((q) => `wd:${q}`).join(' ')} } ?item wikibase:sitelinks ?links . OPTIONAL { ?item wdt:P18 ?image } }`;
}

/** The SPARQL answer → Q-id → sitelinks and the first image's file name. */
export function readSparql(json: unknown): Map<string, { sitelinks: number; imageFile: string | null }> {
  const out = new Map<string, { sitelinks: number; imageFile: string | null }>();
  const rows = (json as { results?: { bindings?: Array<Record<string, { value?: string }>> } } | null)?.results?.bindings ?? [];
  for (const b of rows) {
    const q = wikidataId(b.item?.value?.split('/').pop());
    const links = Number(b.links?.value);
    if (!q || !Number.isFinite(links)) continue;
    let file: string | null = null;
    const img = b.image?.value;
    if (img && /Special:FilePath\//.test(img)) {
      try {
        file = decodeURIComponent(img.split('Special:FilePath/')[1]);
      } catch {
        file = null;
      }
      if (file && !/\.(jpe?g|png|webp|tiff?)$/i.test(file)) file = null;
    }
    const had = out.get(q);
    out.set(q, { sitelinks: links, imageFile: had?.imageFile ?? file });
  }
  return out;
}

/** Commons: thumbnails and credits for up to 50 files in one call. */
export function commonsBatchUrl(files: string[], width = 800): string {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  u.searchParams.set('action', 'query');
  u.searchParams.set('format', 'json');
  u.searchParams.set('prop', 'imageinfo');
  u.searchParams.set('iiprop', 'url|extmetadata|size');
  u.searchParams.set('iiurlwidth', String(width));
  u.searchParams.set('titles', files.slice(0, 50).map((f) => `File:${f}`).join('|'));
  return u.toString();
}

/** A batch answer → Q-id → image, matching each page back through Commons' title normalisation. */
export function imagesFromCommonsBatch(json: unknown, fileToQ: Map<string, string>): Map<string, PlaceImage> {
  const out = new Map<string, PlaceImage>();
  const q = (json as { query?: { normalized?: Array<{ from: string; to: string }>; pages?: Record<string, { title?: string }> } } | null)?.query;
  if (!q?.pages) return out;
  const norm = (s: string) => s.replace(/^File:/, '').replace(/_/g, ' ').trim();
  const byTitle = new Map<string, string>();
  for (const [file, id] of fileToQ) byTitle.set(norm(file), id);
  for (const n of q.normalized ?? []) {
    const id = byTitle.get(norm(n.from));
    if (id) byTitle.set(norm(n.to), id);
  }
  for (const page of Object.values(q.pages)) {
    const id = page.title ? byTitle.get(norm(page.title)) : undefined;
    if (!id) continue;
    const image = imageFromCommons({ query: { pages: { p: page } } }, id);
    if (image && cleanImageUrl(image.url)) out.set(id, image);
  }
  return out;
}

// ── Web search ─────────────────────────────────────────────────────────────

const monthYear = (d: LocalDate) => {
  const [y, m] = d.split('-').map(Number);
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`;
};

/** One search per batch of places: booking lead times and tickets for the best known of them. */
export function batchSearchQuery(destination: string, places: Array<Pick<PackCandidate, 'name' | 'sitelinks'>>, startDate: LocalDate): string {
  const top = [...places].sort((a, b) => (b.sitelinks ?? 0) - (a.sitelinks ?? 0)).slice(0, 4).map((p) => p.name);
  return `${destination} ${top.join(', ')} tickets book in advance how far ahead opening hours ${monthYear(startDate)}`;
}

export function calendarSearchQuery(destination: string, startDate: LocalDate, endDate: LocalDate): string {
  return `${destination} closures strikes public holidays events ${dayLabel(startDate)} to ${dayLabel(endDate)} ${startDate.slice(0, 4)}`;
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

// ── The write-up (one model call per batch) ────────────────────────────────

export const PACK_SYSTEM = `You write up a traveller's research pack: for each place given (found on OpenStreetMap near where they are staying), what it is and why it suits this trip, from the web search results given and widely known, stable facts.
Per place (by its "ref"): "why" (one plain sentence, what it is and why it suits them), "kind" (sight|museum|church|walk|park|viewpoint|market|food|cafe|gelato|kids|shop|experience|other), "tags" (≤ 5 short lower-case words: e.g. rainy-day, evening, free, roman, pizza, views, art), "durationMin" (a typical visit), "indoor" (true/false/null), "kidFriendly" (true/false/null), "neighbourhood" (the area of the city it is in, or null), "costText" ("€10 each", "Free", or null), "bookingRequired" (true/false/null), "bookAheadDays" (days ahead tickets typically sell out, or null), "sourceUrls" (result URLs you relied on for it).
Rules: cost, booking and how far ahead ONLY from the search results — null when they do not say (never a guess). Never write a URL that is not in the results. Keep "why" free of opening times and prices. British English, plain words, no emoji.
Also: "neighbourhoods": up to 6 {"name", "line": its feel in one line} for the areas the places are in; "calendar": things on the trip's dates from the results — closures, public holidays, strikes, events — each {"date": "YYYY-MM-DD" or null, "kind": "closure"|"holiday"|"event"|"strike"|"other", "text": one short line, "ref": the place's ref or null, "sourceUrl": a result URL}; [] when the results say nothing.
Answer ONLY with JSON: {"places": [{"ref", ...}], "neighbourhoods": [...], "calendar": [...]}`;

export function synthesisPrompt(input: {
  trip: Pick<Trip, 'destination' | 'startDate' | 'endDate'>;
  places: PackCandidate[];
  results: SearchResult[];
  theme?: string | null;
  travellers?: string | null;
}): string {
  const lines = [
    `Trip: ${input.trip.destination}, ${dayLabel(input.trip.startDate)} to ${dayLabel(input.trip.endDate)}.`,
    input.travellers ? `Travelling: ${input.travellers}.` : '',
    input.theme ? `They asked for more: ${input.theme}.` : '',
    '',
    'Places:',
    ...input.places.map((p, i) =>
      JSON.stringify({ ref: `p${i}`, name: p.name, osm: p.kind, tags: p.tags, wikipediaEditions: p.sitelinks, openingHours: p.openingHours, website: p.website }),
    ),
    '',
    input.results.length ? 'Search results:' : 'Search results: (none — the web search is not available; leave cost and booking null)',
    ...input.results.slice(0, 10).map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 700)}`),
  ];
  return lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

export interface Written {
  why: string | null;
  kind: PackKind | null;
  tags: string[];
  durationMin: number | null;
  indoor: boolean | null;
  kidFriendly: boolean | null;
  neighbourhood: string | null;
  costText: string | null;
  bookingRequired: boolean | null;
  bookAheadDays: number | null;
  sources: Source[];
}

const KINDS: readonly PackKind[] = ['sight', 'museum', 'church', 'walk', 'park', 'viewpoint', 'market', 'food', 'cafe', 'gelato', 'kids', 'shop', 'experience', 'other'];
const CAL_KINDS: readonly CalendarKind[] = ['closure', 'holiday', 'event', 'strike', 'other'];
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const int = (v: unknown, lo: number, hi: number): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null;
};
const isDate = (v: unknown): v is LocalDate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Read one write-up. Places are matched by their `ref`; sources keep only
 * URLs from the search results (never one the model made up); without
 * results, cost and booking stay unknown whatever the model wrote.
 */
export function readSynthesis(
  raw: unknown,
  count: number,
  results: SearchResult[],
  window: { startDate: LocalDate; endDate: LocalDate },
): { places: Array<Written | null>; neighbourhoods: Array<{ name: string; line: string }>; calendar: Array<Omit<PackCalendarItem, 'placeId'> & { ref: number | null }> } {
  const r = isObj(raw) ? raw : {};
  const seen = new Map(results.map((x) => [x.url, x.title]));
  const searched = results.length > 0;
  const sourcesOf = (v: unknown): Source[] =>
    (Array.isArray(v) ? v : [])
      .filter((u): u is string => typeof u === 'string' && seen.has(u))
      .filter((u, i, a) => a.indexOf(u) === i)
      .slice(0, 3)
      .map((url) => ({ url, title: seen.get(url) ?? null }));
  const places: Array<Written | null> = Array.from({ length: count }, () => null);
  for (const p of Array.isArray(r.places) ? r.places : []) {
    if (!isObj(p)) continue;
    const m = /^p(\d+)$/.exec(String(p.ref ?? ''));
    const i = m ? Number(m[1]) : -1;
    if (i < 0 || i >= count || places[i]) continue;
    const sources = sourcesOf(p.sourceUrls);
    // Facts that need checking are kept only when the search was there to check them.
    const checked = searched && sources.length > 0;
    places[i] = {
      why: text(p.why, 240),
      kind: KINDS.includes(p.kind as PackKind) ? (p.kind as PackKind) : null,
      tags: (Array.isArray(p.tags) ? p.tags : [])
        .map((t) => text(t, 24)?.toLowerCase() ?? null)
        .filter((t): t is string => !!t && /^[a-z][a-z -]*$/.test(t))
        .slice(0, 5),
      durationMin: int(p.durationMin, 5, 600),
      indoor: bool(p.indoor),
      kidFriendly: bool(p.kidFriendly),
      neighbourhood: text(p.neighbourhood, 60),
      costText: checked ? text(p.costText, 60) : null,
      bookingRequired: checked ? bool(p.bookingRequired) : null,
      bookAheadDays: checked ? int(p.bookAheadDays, 0, 365) : null,
      sources,
    };
  }
  const neighbourhoods = (Array.isArray(r.neighbourhoods) ? r.neighbourhoods : [])
    .filter(isObj)
    .map((n) => ({ name: text(n.name, 60), line: text(n.line, 200) }))
    .filter((n): n is { name: string; line: string } => !!n.name && !!n.line)
    .slice(0, 6);
  const calendar = (Array.isArray(r.calendar) ? r.calendar : [])
    .filter(isObj)
    .map((c) => {
      const url = typeof c.sourceUrl === 'string' && seen.has(c.sourceUrl) ? c.sourceUrl : null;
      const m = /^p(\d+)$/.exec(String(c.ref ?? ''));
      const date = isDate(c.date) && c.date >= window.startDate && c.date <= window.endDate ? c.date : null;
      return {
        date,
        kind: CAL_KINDS.includes(c.kind as CalendarKind) ? (c.kind as CalendarKind) : 'other',
        text: text(c.text, 160),
        ref: m && Number(m[1]) < count ? Number(m[1]) : null,
        sources: url ? [{ url, title: seen.get(url) ?? null }] : [],
        // A dated claim with a date outside the trip is about another time.
        dated: isDate(c.date),
      };
    })
    // Only what a result supports, and only for the trip's own dates.
    .filter((c): c is typeof c & { text: string } => !!c.text && c.sources.length > 0 && (!c.dated || c.date !== null))
    .map(({ dated: _d, ...c }) => c)
    .slice(0, 12);
  return { places, neighbourhoods, calendar };
}

/** Typical minutes by kind, when the model did not say. */
const DEFAULT_MIN: Record<PackKind, number> = { sight: 45, museum: 90, church: 30, walk: 60, park: 60, viewpoint: 20, market: 45, food: 75, cafe: 30, gelato: 15, kids: 90, shop: 30, experience: 120, other: 45 };
const DEFAULT_INDOOR: Partial<Record<PackKind, boolean>> = { museum: true, church: true, food: true, cafe: true, park: false, viewpoint: false, walk: false };

/** A candidate and its write-up → the stored place. Unchecked facts are listed as unknown. */
export function packPlaceOf(c: PackCandidate, w: Written | null, image: PlaceImage | null, checkedAt: string): Omit<PackPlace, 'id'> {
  const kind = w?.kind && isFood(w.kind) === isFood(c.kind) ? w.kind : c.kind;
  const durationMin = w?.durationMin ?? DEFAULT_MIN[kind];
  const indoor = w?.indoor ?? DEFAULT_INDOOR[kind] ?? null;
  const sources: Source[] = [
    ...(w?.sources ?? []),
    ...(c.wikidata ? [{ url: `https://www.wikidata.org/wiki/${c.wikidata}`, title: 'Wikidata' }] : []),
    ...(isWikidataKey(c.osmId) ? [] : [{ url: `https://www.openstreetmap.org/${c.osmId}`, title: 'OpenStreetMap contributors' }]),
  ];
  const tags = [...new Set([...c.tags, ...(w?.tags ?? []), ...(indoor === true && !isFood(kind) ? ['rainy-day'] : [])])].slice(0, 8);
  const facts: Facts = {
    ...emptyFacts('brief', checkedAt),
    openingHoursText: c.openingHours,
    bookingRequired: w?.bookingRequired ?? null,
    bookAheadDays: w?.bookAheadDays ?? null,
    officialUrl: c.website,
    priceText: w?.costText ?? null,
    typicalVisitSec: durationMin * 60,
    summary: w?.why ?? null,
    sources,
  };
  facts.unknown = [
    ...(c.openingHours ? [] : ['opening hours']),
    ...(facts.bookingRequired === null ? ['whether booking is needed'] : []),
    ...(facts.bookingRequired && facts.bookAheadDays === null ? ['how far ahead to book'] : []),
    ...(facts.priceText === null ? ['price'] : []),
  ];
  return {
    name: c.name,
    kind,
    tags,
    place: { name: c.name, location: c.location, osmId: isWikidataKey(c.osmId) ? null : c.osmId, address: c.address },
    why: w?.why ?? null,
    neighbourhood: w?.neighbourhood ?? null,
    durationMin,
    indoor,
    kidFriendly: w?.kidFriendly ?? (kind === 'kids' ? true : null),
    costText: w?.costText ?? (c.tags.includes('free') ? 'Free' : null),
    lessVisited: lessVisitedOf(c),
    bookingRequired: w?.bookingRequired ?? null,
    bookAheadDays: w?.bookAheadDays ?? null,
    facts,
    image,
    wikidata: c.wikidata,
    sources,
    status: 'candidate',
    rejectReason: null,
    wishId: null,
    checkedAt,
  };
}

// ── Hours on the dates, weather, the calendar ──────────────────────────────

/** Places closed all day on one of the trip's dates, by their OSM hours (unknown counts as open). */
export function closedOnDates(places: Array<Pick<PackPlace, 'name' | 'facts'> & { id?: string }>, dates: LocalDate[]): Array<{ name: string; id: string | null; dates: LocalDate[] }> {
  const out: Array<{ name: string; id: string | null; dates: LocalDate[] }> = [];
  for (const p of places) {
    const closed = dates.filter((d) => {
      const w = windowsOn(p.facts, d);
      return w !== null && w.length === 0;
    });
    // Closed every day is more likely an hours tag we read wrongly than a closure: say nothing.
    if (closed.length && closed.length < dates.length) out.push({ name: p.name, id: p.id ?? null, dates: closed });
  }
  return out;
}

/** "Closed on Mon 26 Oct" items for the calendar (the few most notable). */
export function closureItems(closed: Array<{ name: string; id: string | null; dates: LocalDate[] }>, limit = 6): PackCalendarItem[] {
  return closed.slice(0, limit).map((c) => ({
    date: c.dates.length === 1 ? c.dates[0] : null,
    kind: 'closure' as const,
    text: `${c.name} is closed on ${c.dates.map((d) => dayLabel(d)).join(', ')}`,
    placeId: c.id,
    sources: [{ url: 'https://www.openstreetmap.org/copyright', title: 'OpenStreetMap contributors' }],
  }));
}

/** True when Open-Meteo can forecast every day of the trip (≤ 16 days ahead). */
export function forecastReaches(endDate: LocalDate, today: LocalDate): boolean {
  return dayNumber(endDate) - dayNumber(today) < FORECAST_DAYS && dayNumber(endDate) >= dayNumber(today);
}

export function forecastUrl(at: LatLng, startDate: LocalDate, endDate: LocalDate): string {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', at.lat.toFixed(4));
  u.searchParams.set('longitude', at.lng.toFixed(4));
  u.searchParams.set('daily', 'precipitation_probability_max,temperature_2m_max,temperature_2m_min,sunrise,sunset');
  u.searchParams.set('hourly', 'precipitation_probability');
  u.searchParams.set('timezone', 'auto');
  u.searchParams.set('start_date', startDate);
  u.searchParams.set('end_date', endDate);
  return u.toString();
}

const PARTS: Array<{ name: string; from: number; to: number }> = [
  { name: 'morning', from: 8, to: 12 },
  { name: 'afternoon', from: 12, to: 18 },
  { name: 'evening', from: 18, to: 23 },
];
/** At or above this chance of rain, it is "likely". */
export const RAIN_LIKELY_PCT = 55;

const hhmmOf = (iso: unknown): string | null => (typeof iso === 'string' && /T(\d{2}:\d{2})/.test(iso) ? /T(\d{2}:\d{2})/.exec(iso)![1] : null);

/**
 * The forecast as calendar lines: "Rain likely in the afternoon" for each
 * day and part of the day at RAIN_LIKELY_PCT or more, and one line with the
 * light (sunrise and sunset). The source is Open-Meteo.
 */
export function weatherItems(json: unknown): PackCalendarItem[] {
  const j = (isObj(json) ? json : {}) as { daily?: Record<string, unknown[]>; hourly?: { time?: unknown[]; precipitation_probability?: unknown[] } };
  const days = (j.daily?.time ?? []).filter(isDate);
  if (!days.length) return [];
  const src: Source[] = [{ url: 'https://open-meteo.com/', title: 'Open-Meteo forecast' }];
  const out: PackCalendarItem[] = [];
  const hours = j.hourly?.time ?? [];
  const pop = j.hourly?.precipitation_probability ?? [];
  for (const date of days) {
    const wet: string[] = [];
    for (const part of PARTS) {
      let max = -1;
      hours.forEach((t, i) => {
        if (typeof t !== 'string' || !t.startsWith(date)) return;
        const h = Number(t.slice(11, 13));
        const v = Number(pop[i]);
        if (h >= part.from && h < part.to && Number.isFinite(v)) max = Math.max(max, v);
      });
      if (max >= RAIN_LIKELY_PCT) wet.push(part.name);
    }
    if (wet.length === PARTS.length) out.push({ date, kind: 'weather', text: 'Rain likely all day', placeId: null, sources: src });
    else if (wet.length) out.push({ date, kind: 'weather', text: `Rain likely in the ${wet.join(' and ')}`, placeId: null, sources: src });
  }
  const rise = hhmmOf(j.daily?.sunrise?.[0]);
  const set = hhmmOf(j.daily?.sunset?.[0]);
  if (rise && set) out.push({ date: null, kind: 'sun', text: `Light from about ${rise} to ${set}`, placeId: null, sources: src });
  return out;
}

/** Which parts of a date are wet, from the calendar's weather lines. */
export function wetParts(calendar: PackCalendarItem[], date: LocalDate): string[] {
  const item = calendar.find((c) => c.kind === 'weather' && c.date === date);
  if (!item) return [];
  if (/all day/.test(item.text)) return PARTS.map((p) => p.name);
  return PARTS.map((p) => p.name).filter((p) => item.text.includes(p));
}

// ── The summary ────────────────────────────────────────────────────────────

export function packCounts(places: Array<Pick<PackPlace, 'kind' | 'status' | 'bookingRequired' | 'lessVisited' | 'indoor' | 'tags'>>): PackSummary['counts'] {
  const live = places.filter((p) => p.status !== 'rejected');
  return {
    places: live.length,
    food: live.filter((p) => isFood(p.kind)).length,
    toBook: live.filter((p) => p.bookingRequired === true).length,
    lessVisited: live.filter((p) => p.lessVisited).length,
    rainy: live.filter((p) => !isFood(p.kind) && (p.indoor === true || p.tags.includes('rainy-day'))).length,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Rain likely in the afternoon" on a Thursday → "Rain likely Thu afternoon". */
export function rainLine(item: Pick<PackCalendarItem, 'date' | 'text'>): string {
  const wd = item.date ? dayLabel(item.date).split(' ')[0] : '';
  const m = /^Rain likely in the (.+)$/.exec(item.text);
  if (m && wd) return `Rain likely ${wd} ${m[1]}`;
  if (/all day/.test(item.text) && wd) return `Rain likely all day ${wd}`;
  return wd ? `${item.text} (${wd})` : item.text;
}

/** The progress card's lines: "Found 38 places", "3 need booking — Colosseum about 14 days ahead", "Rain likely Thu afternoon". */
export function packHighlights(places: Array<Pick<PackPlace, 'name' | 'kind' | 'status' | 'bookingRequired' | 'bookAheadDays' | 'lessVisited' | 'indoor' | 'tags'>>, calendar: PackCalendarItem[]): string[] {
  const counts = packCounts(places);
  const out: string[] = [];
  const sights = counts.places - counts.food;
  if (sights) out.push(`Found ${plural(sights, 'place')} to see`);
  if (counts.food) out.push(`${plural(counts.food, 'place')} to eat near where you'll be`);
  const book = places.filter((p) => p.status !== 'rejected' && p.bookingRequired === true);
  if (book.length) {
    const longest = [...book].sort((a, b) => (b.bookAheadDays ?? 0) - (a.bookAheadDays ?? 0))[0];
    out.push(`${book.length} ${book.length === 1 ? 'needs' : 'need'} booking${longest.bookAheadDays ? ` — ${longest.name} about ${plural(longest.bookAheadDays, 'day')} ahead` : ''}`);
  }
  const rain = calendar.filter((c) => c.kind === 'weather' && c.date);
  for (const r of rain.slice(0, 2)) out.push(rainLine(r));
  const closures = calendar.filter((c) => c.kind === 'closure' || c.kind === 'strike' || c.kind === 'holiday');
  if (closures.length && out.length < 5) out.push(closures[0].text);
  if (counts.lessVisited && out.length < 5) out.push(`${plural(counts.lessVisited, 'quieter place')} off the usual list`);
  return out.slice(0, 5);
}

/** Neighbourhoods for the pack: the city guide's, then any the write-up named, each with its places. */
export function packNeighbourhoods(guide: Neighbourhood[], written: Array<{ name: string; line: string }>, places: Array<Pick<PackPlace, 'name' | 'neighbourhood'>>): Neighbourhood[] {
  const out = new Map<string, Neighbourhood>();
  for (const n of guide) out.set(n.name.toLowerCase(), { ...n, places: [...n.places] });
  for (const n of written) if (!out.has(n.name.toLowerCase())) out.set(n.name.toLowerCase(), { name: n.name, line: n.line, places: [] });
  for (const p of places) {
    const n = p.neighbourhood ? out.get(p.neighbourhood.toLowerCase()) : undefined;
    if (n && !n.places.includes(p.name)) n.places.push(p.name);
  }
  return [...out.values()].filter((n) => n.places.length > 0).slice(0, 8);
}

// ── When to build, when to refresh ─────────────────────────────────────────

/**
 * What a read of the trip should start: a first build when there is no pack
 * yet and the trip is real (not the placeholder draft), a refresh inside the
 * week before when neither the build nor a refresh happened in that window;
 * else nothing.
 */
export function packDue(trip: Pick<Trip, 'destination' | 'startDate' | 'endDate'>, pack: Pick<PackSummary, 'status' | 'builtAt' | 'refreshedAt'>, today: LocalDate): 'build' | 'refresh' | null {
  if (!trip.destination || trip.destination === 'New trip') return null;
  if (dayNumber(trip.endDate) < dayNumber(today)) return null;
  if (pack.status === 'building') return null;
  const days = dayNumber(trip.startDate) - dayNumber(today);
  if (pack.status === 'none' || pack.status === 'failed') return days <= REFRESH_WITHIN_DAYS ? 'build' : null;
  if (days > REFRESH_WITHIN_DAYS) return null;
  const windowStart = addDays(trip.startDate, -REFRESH_WITHIN_DAYS);
  const last = [pack.refreshedAt, pack.builtAt].filter((x): x is string => !!x).sort().at(-1);
  return !last || last.slice(0, 10) < windowStart ? 'refresh' : null;
}

/** The trip's dates. */
export const tripDates = (trip: Pick<Trip, 'startDate' | 'endDate'>) => datesBetween(trip.startDate, trip.endDate);

/** `?kind=` (comma list; 'food' also means cafés and gelato) and `?tag=`. */
export function filterPlaces(places: PackPlace[], q: { kind?: string | null; tag?: string | null }): PackPlace[] {
  const kinds = new Set((q.kind ?? '').split(',').map((k) => k.trim()).filter(Boolean));
  if (kinds.has('food')) for (const k of FOOD_KINDS) kinds.add(k);
  const tag = (q.tag ?? '').trim().toLowerCase();
  return places.filter((p) => (!kinds.size || kinds.has(p.kind)) && (!tag || p.tags.includes(tag)));
}

/** Weekday of a date, 1 = Monday — re-exported for the questions' "closed on its day". */
export { isoWeekday };

// ── The routes' body ───────────────────────────────────────────────────────

export type PackAction = 'build' | 'refresh' | 'more';

const REJECT_REASONS: readonly RejectReason[] = ['too-far', 'too-busy', 'not-for-us', 'been-before', 'other'];

/** `POST pack` `{ action: 'reject', placeId, reason }`: turn one place down, with why. */
export function parsePackReject(body: unknown): { ok: true; placeId: string; reason: RejectReason } | { ok: false; error: string } | null {
  const b = isObj(body) ? body : {};
  if (b.action !== 'reject') return null;
  const placeId = typeof b.placeId === 'string' && /^[0-9a-f-]{36}$/i.test(b.placeId) ? b.placeId : null;
  if (!placeId) return { ok: false, error: 'Say which place (placeId).' };
  const reason = REJECT_REASONS.includes(b.reason as RejectReason) ? (b.reason as RejectReason) : null;
  if (!reason) return { ok: false, error: 'reason is too-far, too-busy, not-for-us, been-before or other.' };
  return { ok: true, placeId, reason };
}

/** `POST pack` `{ action: 'build'|'refresh'|'more', theme? }`. */
export function parsePackAsk(body: unknown): { ok: true; action: PackAction; theme: string | null } | { ok: false; error: string } {
  const b = isObj(body) ? body : {};
  const action = b.action ?? 'build';
  if (action !== 'build' && action !== 'refresh' && action !== 'more') return { ok: false, error: 'action is build, refresh, more or reject.' };
  const theme = text(b.theme, 60);
  if (theme && !/^[\p{L}\p{N} ,'’&-]+$/u.test(theme)) return { ok: false, error: 'Say the theme in a few words.' };
  return { ok: true, action, theme: action === 'more' ? theme : null };
}

/** Folds a name for comparing: lower case, no accents, letters and digits only. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function metresApart(a: LatLng, b: LatLng): number {
  const r = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/**
 * The same place under two names — OpenStreetMap often maps a monument twice
 * (the building and its site, "Colosseo" and "Colosseum") — would otherwise
 * appear twice in a day's plan. Two candidates are one place when they share
 * a Wikidata entry, or sit within 300 m (a monument is big) with names that agree (the same, one
 * contained in the other as whole words, or two one-word names sharing their
 * first six letters). The better-known one is
 * kept: the most Wikipedia articles, then a Wikidata entry, then the nearer.
 */
export function mergeSamePlaces(cands: PackCandidate[]): PackCandidate[] {
  const rank = (c: PackCandidate) => (c.sitelinks ?? -1) * 10 + (c.wikidata ? 5 : 0) + (isWikidataKey(c.osmId) ? 0 : 2) - c.distanceM / 10_000;
  const sorted = [...cands].sort((a, b) => rank(b) - rank(a));
  const out: PackCandidate[] = [];
  for (const c of sorted) {
    const n = fold(c.name);
    const same = out.some((k) => {
      if (c.wikidata && k.wikidata && c.wikidata === k.wikidata) return true;
      if (metresApart(c.location, k.location) > 300) return false;
      const m = fold(k.name);
      if (n === m) return true;
      // Containment only for a whole-word match ("Pantheon" in "Il Pantheon"), and a
      // shared start only for one-word names (Colosseo / Colosseum) — never for
      // "Trattoria da Enzo" and "Trattoria Pizzeria", two places that share a word.
      const words = (x: string) => x.split(' ');
      const within = (a: string, b: string) => ` ${b} `.includes(` ${a} `);
      const oneWord = words(n).length === 1 && words(m).length === 1;
      return within(n, m) || within(m, n) || (oneWord && n.length >= 6 && m.length >= 6 && n.slice(0, 6) === m.slice(0, 6));
    });
    if (!same) out.push(c);
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}

/**
 * The middle of a city's ten best-known sights (the median, so one outlier —
 * a basilica outside the walls — does not drag it), or null with fewer than three.
 */
export function middleOf(cands: PackCandidate[]): LatLng | null {
  const top = [...cands].sort((a, b) => (b.sitelinks ?? 0) - (a.sitelinks ?? 0)).slice(0, 10);
  if (top.length < 3) return null;
  const median = (xs: number[]) => {
    const v = [...xs].sort((a, b) => a - b);
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  return { lat: median(top.map((c) => c.location.lat)), lng: median(top.map((c) => c.location.lng)) };
}
