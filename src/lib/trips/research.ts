// src/lib/trips/research.ts
//
// The pure half of the brief scan (D4): what to search for, what to ask the
// model, how to read its answer into `Facts`, how to read OpenStreetMap
// (Nominatim with extratags, Overpass for nearby extras), and the rule that a
// booking link is the official seller's, never a reseller's. The I/O is in
// ./research.server.

import type { Facts, LatLng, PartOfDay, Priority, Trip, Wish } from './model';
import { haversineM } from './solver/estimate';
import { parseOpeningHours } from './solver/hours';

/** Ticket resellers and aggregators — never offered as the booking link (D5). */
export const RESELLER_HOSTS = [
  'getyourguide.',
  'viator.com',
  'tiqets.com',
  'klook.com',
  'musement.com',
  'civitatis.com',
  'headout.com',
  'tripadvisor.',
  'expedia.',
  'booking.com',
  'isango.com',
  'golden-tours.',
  'citypass.',
  'gocity.com',
  'ticketbar.',
  'tickets-',
  'skip-the-line',
  'skiptheline',
  'tourist-',
];

export function isReseller(url: string | null | undefined): boolean {
  if (!url) return false;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true; // not a URL at all: never a link we show
  }
  return RESELLER_HOSTS.some((r) => host.includes(r));
}

/** Only http(s), never a reseller. */
export function officialOnly(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return isReseller(u.toString()) ? null : u.toString();
  } catch {
    return null;
  }
}

export function searchQuery(wish: Pick<Wish, 'title' | 'place'>, trip: Pick<Trip, 'destination'>, depth: 'brief' | 'deep'): string {
  const name = wish.place?.name && wish.place.name !== wish.title ? `${wish.title} (${wish.place.name})` : wish.title;
  return depth === 'brief'
    ? `${name} ${trip.destination} official site tickets opening hours`
    : `${name} ${trip.destination} official booking how far in advance sold out closed days visit length`;
}

export const FACTS_SYSTEM = [
  'You read web search results about one place a traveller wants to visit and fill a fact sheet.',
  'Answer ONLY with a JSON object with these keys:',
  '{"bookingRequired": true|false|null, "bookAheadDays": number|null, "bookingUrl": string|null,',
  ' "officialUrl": string|null, "priceText": string|null, "typicalVisitMin": number|null,',
  ' "closedDays": string|null, "closedDates": string[], "weeklyHours": {"Mo": string|null, ..., "Su": string|null}|null,',
  ' "summary": string|null, "sourceUrls": string[]}',
  'Rules: use only what the results say; null when they do not say. bookingUrl and officialUrl must be the',
  "venue's OWN official site or its official ticket office, copied exactly from the results — never a reseller,",
  'tour operator or aggregator (GetYourGuide, Viator, Tiqets, Klook, Tripadvisor and the like). bookAheadDays is',
  'how many days ahead tickets typically sell out or must be booked. closedDays is a short phrase such as',
  '"Sundays; 25 Dec". closedDates lists the dates of the visit window (YYYY-MM-DD) on which the results say it is',
  'closed (a holiday, a strike, works) — [] when they do not say. weeklyHours gives each weekday the results state,',
  'as "09:00-19:00" (or "09:00-13:00,15:00-19:00") or "closed"; null for a day they do not state, and null for the',
  'whole object when they give no hours. Never guess hours.',
  'summary is one plain sentence. sourceUrls lists the result URLs you relied on.',
].join('\n');

export function factsPrompt(input: {
  wish: Pick<Wish, 'title' | 'place'>;
  trip: Pick<Trip, 'destination' | 'startDate' | 'endDate'>;
  results: Array<{ title: string; url: string; content: string }>;
  osm: { openingHoursText: string | null; website: string | null };
}): string {
  const lines = [
    `Place: ${input.wish.title}${input.wish.place?.name ? ` (${input.wish.place.name})` : ''}, ${input.trip.destination}.`,
    `Visit between ${input.trip.startDate} and ${input.trip.endDate}.`,
    input.osm.website ? `OpenStreetMap website tag: ${input.osm.website}` : 'OpenStreetMap has no website tag.',
    input.osm.openingHoursText ? `OpenStreetMap opening_hours: ${input.osm.openingHoursText}` : '',
    '',
    'Search results:',
    ...input.results.slice(0, 6).map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 900)}`),
  ];
  return lines.filter((l) => l !== '').join('\n');
}

/** Parse a model's JSON answer, tolerating code fences and prose around it. */
export function parseLooseJson(text: string): unknown {
  const tries = [text.trim()];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) tries.push(fence[1].trim());
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const a = text.indexOf(open);
    const b = text.lastIndexOf(close);
    if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  }
  for (const t of tries) {
    try {
      return JSON.parse(t);
    } catch {
      /* next */
    }
  }
  return null;
}

const FACT_FIELDS: Array<[keyof Facts, string]> = [
  ['openingHoursText', 'opening hours'],
  ['bookingRequired', 'whether booking is needed'],
  ['bookAheadDays', 'how far ahead to book'],
  ['bookingUrl', 'official booking link'],
  ['officialUrl', 'official website'],
  ['priceText', 'price'],
  ['typicalVisitSec', 'typical visit length'],
];

/** An empty sheet: everything unknown. */
export function emptyFacts(depth: Facts['depth'] = 'brief', checkedAt: string | null = null): Facts {
  return {
    openingHoursText: null,
    hours: null,
    closedDates: [],
    bookingRequired: null,
    bookAheadDays: null,
    bookingUrl: null,
    officialUrl: null,
    priceText: null,
    typicalVisitSec: null,
    summary: null,
    sources: [],
    checkedAt,
    depth,
    unknown: FACT_FIELDS.map(([, label]) => label),
  };
}

function str(v: unknown, max = 300): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

const WEEKDAY_CODES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

/**
 * The reader's `weeklyHours` into `Facts['hours']`: only the days it states
 * (a missing day stays unknown — never "closed" by omission), each through the
 * same opening_hours parser as OSM's text. Null when no day is readable.
 */
export function readWeeklyHours(raw: unknown): Facts['hours'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const hours: NonNullable<Facts['hours']> = {};
  let any = false;
  WEEKDAY_CODES.forEach((code, i) => {
    const v = typeof o[code] === 'string' ? (o[code] as string).trim().toLowerCase() : '';
    if (!v) return;
    const day = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
    const parsed = parseOpeningHours(`${code} ${v === 'closed' ? 'off' : v}`)?.[day];
    if (!parsed) return;
    hours[day] = parsed;
    any = true;
  });
  return any ? hours : null;
}

/** The reader's `closedDates`: real dates inside the visit window, sorted, no repeats. */
export function readClosedDates(raw: unknown, window: { startDate: string; endDate: string } | null): string[] {
  if (!Array.isArray(raw) || !window) return [];
  return [...new Set(raw.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && d >= window.startDate && d <= window.endDate))].sort();
}

/**
 * Read the model's answer into a fact sheet. OSM facts win for opening hours
 * and the website; the model's links are kept only when they are official and
 * appear in the search results (no invented URLs). Anything left null is
 * listed in `unknown`.
 */
export function readFacts(input: {
  raw: unknown;
  results: Array<{ title: string; url: string }>;
  osm: { openingHoursText: string | null; website: string | null; wikidata: string | null };
  previous: Facts | null;
  depth: 'brief' | 'deep';
  checkedAt: string;
  /** The trip's dates: closures the reader finds are kept only inside them. */
  trip?: { startDate: string; endDate: string } | null;
}): Facts {
  const r = (input.raw && typeof input.raw === 'object' ? input.raw : {}) as Record<string, unknown>;
  const seen = new Set(input.results.map((x) => x.url));
  const seenHosts = new Set(
    input.results.flatMap((x) => {
      try {
        return [new URL(x.url).hostname];
      } catch {
        return [];
      }
    }),
  );
  const grounded = (u: unknown): string | null => {
    const url = officialOnly(u);
    if (!url) return null;
    try {
      return seen.has(url) || seenHosts.has(new URL(url).hostname) || url === input.osm.website ? url : null;
    } catch {
      return null;
    }
  };
  const prev = input.previous;
  const num = (v: unknown, lo: number, hi: number) => {
    const n = Number(v);
    return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null;
  };

  const sourceUrls = Array.isArray(r.sourceUrls) ? r.sourceUrls.filter((u): u is string => typeof u === 'string' && seen.has(u)) : [];
  const sources = (sourceUrls.length ? sourceUrls : input.results.slice(0, 3).map((x) => x.url))
    .map((url) => ({ url, title: input.results.find((x) => x.url === url)?.title ?? null }));
  if (input.osm.website || input.osm.wikidata || input.osm.openingHoursText) {
    sources.push({ url: 'https://www.openstreetmap.org/copyright', title: 'OpenStreetMap contributors' });
  }
  // Keep earlier sources (a deep scan adds to a brief one), without repeats.
  const allSources = [...(prev?.sources ?? []), ...sources].filter((s, i, a) => a.findIndex((t) => t.url === s.url) === i).slice(0, 12);

  const visitMin = num(r.typicalVisitMin, 10, 600);
  const openingHoursText = input.osm.openingHoursText ?? prev?.openingHoursText ?? null;
  // OSM's text wins for hours: the reader's weekly hours are used only when
  // there is no parseable OSM text (`hours` would otherwise shadow it).
  const hours = parseOpeningHours(openingHoursText) ? null : (readWeeklyHours(r.weeklyHours) ?? prev?.hours ?? null);
  // A closure found once is kept: wrongly closed costs a re-plan, wrongly open a wasted trip.
  const closedDates = [...new Set([...(prev?.closedDates ?? []), ...readClosedDates(r.closedDates, input.trip ?? null)])].sort();
  const facts: Facts = {
    openingHoursText,
    hours,
    closedDates,
    bookingRequired: typeof r.bookingRequired === 'boolean' ? r.bookingRequired : (prev?.bookingRequired ?? null),
    bookAheadDays: num(r.bookAheadDays, 0, 365) ?? prev?.bookAheadDays ?? null,
    bookingUrl: grounded(r.bookingUrl) ?? prev?.bookingUrl ?? null,
    officialUrl: officialOnly(input.osm.website) ?? grounded(r.officialUrl) ?? prev?.officialUrl ?? null,
    priceText: str(r.priceText, 160) ?? prev?.priceText ?? null,
    typicalVisitSec: visitMin !== null ? visitMin * 60 : (prev?.typicalVisitSec ?? null),
    summary: str(r.summary, 400) ?? prev?.summary ?? null,
    sources: allSources,
    checkedAt: input.checkedAt,
    depth: input.depth,
    unknown: [],
  };
  const closed = str(r.closedDays, 160);
  if (closed && !facts.summary?.includes(closed)) facts.summary = `${facts.summary ? `${facts.summary} ` : ''}Closed: ${closed}.`;
  facts.unknown = FACT_FIELDS.filter(([k]) => facts[k] === null && !(k === 'openingHoursText' && facts.hours)).map(([, label]) => label);
  return facts;
}

// ── OpenStreetMap ──────────────────────────────────────────────────────────

export interface OsmPlace {
  name: string;
  location: LatLng;
  osmId: string | null;
  address: string | null;
  openingHoursText: string | null;
  website: string | null;
  wikidata: string | null;
}

/** One Nominatim `jsonv2` row with `extratags=1` into our shape. */
export function placeFromNominatim(row: unknown): OsmPlace | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const tags = (r.extratags && typeof r.extratags === 'object' ? r.extratags : {}) as Record<string, unknown>;
  const display = str(r.display_name, 300);
  const name = str(r.name, 160) ?? display?.split(',')[0]?.trim() ?? null;
  if (!name) return null;
  const type = str(r.osm_type, 20);
  const id = r.osm_id != null ? String(r.osm_id) : null;
  return {
    name,
    location: { lat, lng },
    osmId: type && id ? `${type}/${id}` : null,
    address: display,
    openingHoursText: str(tags.opening_hours, 300),
    website: str(tags.website, 300) ?? str(tags['contact:website'], 300) ?? str(tags.url, 300),
    wikidata: str(tags.wikidata, 40),
  };
}

/**
 * How far from the trip a place found by name may be. A name search that
 * misses near the trip falls back to the whole world and takes the first
 * hit — a namesake on another continent is not the place. Shared with the
 * agent's `locate`.
 */
export const PLACE_REACH_M = 100_000;

/**
 * True when `at` is within reach of at least one of the trip's anchors (its
 * stays, or the points a search was made around). Nothing to compare with
 * (a trip with no places yet) is not a reason to refuse.
 */
export function withinReach(at: LatLng, anchors: Array<LatLng | null | undefined>, reachM = PLACE_REACH_M): boolean {
  const known = anchors.filter((a): a is LatLng => !!a && Number.isFinite(a.lat) && Number.isFinite(a.lng));
  return !known.length || known.some((a) => haversineM(a, at) <= reachM);
}

/** Overpass QL for notable places within `radiusM` of a point. */
export function overpassNearbyQuery(at: LatLng, radiusM = 1200): string {
  const around = `(around:${Math.round(radiusM)},${at.lat.toFixed(6)},${at.lng.toFixed(6)})`;
  return `[out:json][timeout:20];(
nwr["tourism"~"^(attraction|museum|gallery|viewpoint)$"]["name"]["wikidata"]${around};
nwr["historic"~"^(monument|castle|ruins|archaeological_site)$"]["name"]["wikidata"]${around};
);out center tags 40;`;
}

export interface Suggestion {
  title: string;
  place: { name: string; location: LatLng; osmId: string; address: string | null };
  openingHoursText: string | null;
  website: string | null;
  wikidata: string | null;
  kind: string;
}

/**
 * Up to `limit` nearby extras from an Overpass answer: named, with a wikidata
 * id (a cheap notability filter), not already a wish (by name or OSM id), and
 * ordered nearest first to the wishes' centre, ties by name.
 */
export function suggestionsFromOverpass(
  answer: unknown,
  existing: Array<Pick<Wish, 'title' | 'place'>>,
  centre: LatLng,
  limit = 5,
): Suggestion[] {
  const elements = (answer as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const names = new Set(existing.flatMap((w) => [w.title, w.place?.name ?? '']).map((n) => n.trim().toLowerCase()).filter(Boolean));
  const ids = new Set(existing.map((w) => w.place?.osmId).filter(Boolean));
  const out: Array<Suggestion & { d: number }> = [];
  for (const raw of elements) {
    const e = raw as { type?: string; id?: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> };
    const tags = e.tags ?? {};
    const name = tags['name:en'] ?? tags.name;
    const lat = Number(e.lat ?? e.center?.lat);
    const lng = Number(e.lon ?? e.center?.lon);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || !e.type || e.id == null) continue;
    const osmId = `${e.type}/${e.id}`;
    if (ids.has(osmId) || names.has(name.trim().toLowerCase())) continue;
    if (out.some((s) => s.title.toLowerCase() === name.toLowerCase())) continue;
    const d = (lat - centre.lat) ** 2 + ((lng - centre.lng) * Math.cos((centre.lat * Math.PI) / 180)) ** 2;
    out.push({
      title: name,
      place: { name, location: { lat, lng }, osmId, address: null },
      openingHoursText: tags.opening_hours ?? null,
      website: officialOnly(tags.website ?? tags['contact:website'] ?? null),
      wikidata: tags.wikidata ?? null,
      kind: tags.tourism ?? tags.historic ?? 'place',
      d,
    });
  }
  out.sort((a, b) => a.d - b.d || a.title.localeCompare(b.title));
  return out.slice(0, limit).map(({ d: _d, ...s }) => s);
}

// ── Free text → wishes ─────────────────────────────────────────────────────

export const WISHES_SYSTEM = [
  'You turn a traveller\'s free text about a trip into a list of things they want to do.',
  'Answer ONLY with JSON: {"wishes": [{"title": string, "priority": "must"|"nice", "durationMin": number|null,',
  ' "partOfDay": "morning"|"afternoon"|"evening"|"any", "note": string|null}]}',
  'One wish per distinct place or activity, titled with the place\'s usual name ("Colosseum", "Trastevere',
  'dinner"). "must" only when the text says it is essential; otherwise "nice". durationMin only when the text',
  'gives one. At most 25 wishes. Do not add places the text does not mention.',
].join('\n');

export interface DraftWish {
  title: string;
  priority: Priority;
  durationSec: number | null;
  partOfDay: PartOfDay;
  note: string | null;
}

export function readDraftWishes(raw: unknown): DraftWish[] {
  const list = Array.isArray(raw) ? raw : (raw as { wishes?: unknown } | null)?.wishes;
  if (!Array.isArray(list)) return [];
  const out: DraftWish[] = [];
  for (const item of list.slice(0, 25)) {
    if (!item || typeof item !== 'object') continue;
    const w = item as Record<string, unknown>;
    const title = str(w.title, 160);
    if (!title || out.some((o) => o.title.toLowerCase() === title.toLowerCase())) continue;
    const mins = Number(w.durationMin);
    out.push({
      title,
      priority: w.priority === 'must' ? 'must' : 'nice',
      durationSec: Number.isFinite(mins) && mins >= 5 && mins <= 720 ? Math.round(mins) * 60 : null,
      partOfDay: (['morning', 'afternoon', 'evening'] as const).includes(w.partOfDay as 'morning') ? (w.partOfDay as PartOfDay) : 'any',
      note: str(w.note, 300),
    });
  }
  return out;
}

/**
 * The searches to try for a place name, best first: as given (with the
 * destination appended when it has no comma), without airport/station codes,
 * the address part after a business name ("Hotel X, Via Y 6, Rome" → "Via Y
 * 6, Rome"), then the name alone. Nominatim matches literally, so a hotel it
 * does not know is still placed by its street.
 */
export function placeQueries(query: string, destination: string | null): string[] {
  const q = query.trim().replace(/\s+/g, ' ');
  const dest = destination && destination !== 'New trip' ? destination : null;
  const out: string[] = [];
  const add = (x: string) => {
    const t = x.trim().replace(/^,|,$/g, '').trim();
    if (t.length >= 3 && !out.includes(t)) out.push(t);
  };
  add(/,/.test(q) || !dest ? q : `${q}, ${dest}`);
  const noCode = q.replace(/\b[A-Z]{3}\b/g, '').replace(/\s+/g, ' ').trim();
  add(noCode);
  const parts = q.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) add(parts.slice(1).join(', '));
  add(parts[0].replace(/\b[A-Z]{3}\b/g, '').trim());
  return out.slice(0, 4);
}
