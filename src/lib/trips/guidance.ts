// src/lib/trips/guidance.ts
//
// The pure half of guidance (v2): how to do each leg, what to know at each
// stop, and the city guide they lean on. Routed data becomes the facts —
// openrouteservice or Transitous walking steps, Transitous lines, stops and
// departures — and a model may only add words (a summary, tips, a cost
// phrase). It never adds a link: links come from the trip guide (taxis, built
// from one web search), a wish's researched facts, or nowhere.
//
// D1 still holds: nothing here carries a Mapbox-derived figure. Durations come
// from the stored plan (openrouteservice, Transitous or the estimate).

import type { Facts, GuideLink, LatLng, LegGuidance, LocalDate, PlannedDay, PlannedLeg, SolvedPlan, StopGuide, TravelMode, Trip, TripGuide, Wish } from './model';
import { officialOnly } from './research';
import { pairKey } from './routing';

/** Cache key for one leg's guidance: the same two places, mode and date reuse it. */
export function legKey(date: LocalDate, mode: TravelMode, from: LatLng, to: LatLng): string {
  return `${date}|${mode}|${pairKey(from, to)}`;
}

export type GuidanceCache = Record<string, LegGuidance>;

/** The plan with each leg's cached guidance attached (null where none yet). */
export function decoratePlan(plan: SolvedPlan, cache: GuidanceCache): SolvedPlan {
  return {
    ...plan,
    days: plan.days.map((day) => {
      const at = new Map(day.stops.map((s) => [s.id, s.location]));
      return {
        ...day,
        legs: day.legs.map((leg) => {
          const a = at.get(leg.fromStopId);
          const b = at.get(leg.toStopId);
          return { ...leg, guidance: a && b ? (cache[legKey(day.date, leg.mode, a, b)] ?? null) : null };
        }),
      };
    }),
  };
}

/** Legs of the given days that have no cached guidance yet. */
export function legsLacking(plan: SolvedPlan, dates: LocalDate[], cache: GuidanceCache): Array<{ day: PlannedDay; leg: PlannedLeg; index: number; key: string; from: LatLng; to: LatLng }> {
  const out: Array<{ day: PlannedDay; leg: PlannedLeg; index: number; key: string; from: LatLng; to: LatLng }> = [];
  for (const day of plan.days) {
    if (!dates.includes(day.date)) continue;
    const at = new Map(day.stops.map((s) => [s.id, s.location]));
    day.legs.forEach((leg, index) => {
      const from = at.get(leg.fromStopId);
      const to = at.get(leg.toStopId);
      if (!from || !to || (from.lat === to.lat && from.lng === to.lng)) return;
      const key = legKey(day.date, leg.mode, from, to);
      if (!cache[key]) out.push({ day, leg, index, key, from, to });
    });
  }
  return out;
}

/** Every day of the plan, the next two first: the order a full guidance run takes. */
export function guidanceOrder(plan: SolvedPlan, today: LocalDate): LocalDate[] {
  const first = guidanceDates(plan, today);
  return [...first, ...plan.days.map((d) => d.date).filter((d) => !first.includes(d))];
}

/** The two days guidance is made for after a solve: today and tomorrow when under way, else the first two. */
export function guidanceDates(plan: SolvedPlan, today: LocalDate): LocalDate[] {
  const dates = plan.days.map((d) => d.date);
  const from = dates.findIndex((d) => d >= today);
  return from < 0 ? [] : dates.slice(from, from + 2);
}

// ── When guidance is due ───────────────────────────────────────────────────

/** A city guide older than this is refreshed — but only as the trip comes near. */
export const TRIP_GUIDE_MAX_AGE_DAYS = 30;
export const TRIP_GUIDE_REFRESH_WITHIN_DAYS = 10;
const DAY_MS = 86_400_000;

/**
 * Whether a wish needs its stop guide (re)made: it has none, or its facts were
 * checked after the guide was written (new hours, a closure, a booking rule).
 * An unreadable time is no reason to spend a model call.
 */
export function stopGuideNeeded(wish: Pick<Wish, 'guide' | 'facts'>): boolean {
  if (!wish.guide) return true;
  const checked = Date.parse(wish.facts?.checkedAt ?? '');
  const made = Date.parse(wish.guide.generatedAt);
  return Number.isFinite(checked) && Number.isFinite(made) && checked > made;
}

/**
 * Whether the city guide needs making: none yet, or older than 30 days while
 * the trip starts within 10 days (and is not over). A far-off trip keeps its
 * guide until then; a refresh closer to the time catches changed fares.
 */
export function tripGuideNeeded(trip: Pick<Trip, 'startDate' | 'endDate'> & { guide?: TripGuide | null }, today: LocalDate, now: Date = new Date()): boolean {
  if (!trip.guide) return true;
  const made = Date.parse(trip.guide.generatedAt);
  if (!Number.isFinite(made) || now.getTime() - made <= TRIP_GUIDE_MAX_AGE_DAYS * DAY_MS) return false;
  if (today > trip.endDate) return false;
  return (Date.parse(`${trip.startDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS <= TRIP_GUIDE_REFRESH_WITHIN_DAYS;
}

/**
 * The days from today on that still lack leg guidance or a stop guide, in
 * date order — what a bundle read should start a background run for. Past
 * days are left alone.
 */
export function guidanceDue(plan: SolvedPlan, cache: GuidanceCache, wishes: Array<Pick<Wish, 'id' | 'guide' | 'facts'>>, today: LocalDate): LocalDate[] {
  const byId = new Map(wishes.map((w) => [w.id, w]));
  const upcoming = plan.days.filter((d) => d.date >= today);
  const lacking = new Set(legsLacking(plan, upcoming.map((d) => d.date), cache).map((x) => x.day.date));
  const needsStopGuide = (d: PlannedDay) =>
    d.stops.some((s) => {
      const w = s.wishId ? byId.get(s.wishId) : undefined;
      return !!w && stopGuideNeeded(w);
    });
  return upcoming.filter((d) => lacking.has(d.date) || needsStopGuide(d)).map((d) => d.date);
}

// ── Walking steps ──────────────────────────────────────────────────────────

const DIRECTION: Record<string, string> = {
  LEFT: 'Turn left',
  RIGHT: 'Turn right',
  SLIGHTLY_LEFT: 'Bear left',
  SLIGHTLY_RIGHT: 'Bear right',
  HARD_LEFT: 'Turn sharp left',
  HARD_RIGHT: 'Turn sharp right',
  UTURN_LEFT: 'Turn back',
  UTURN_RIGHT: 'Turn back',
  CIRCLE_CLOCKWISE: 'Take the roundabout',
  CIRCLE_COUNTERCLOCKWISE: 'Take the roundabout',
  ELEVATOR: 'Take the lift',
};

const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`);

/**
 * Transitous (MOTIS) walking steps → a few readable directions: consecutive
 * pieces of the same street merge, unnamed slivers fold into the next named
 * stretch, at most 12 lines.
 */
export function stepsFromMotis(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const merged: Array<{ turn: string | null; street: string; distance: number }> = [];
  for (const s of raw as Array<{ relativeDirection?: string; streetName?: string; distance?: number }>) {
    const street = (s.streetName ?? '').trim();
    const turn = s.relativeDirection ? (DIRECTION[s.relativeDirection] ?? null) : null;
    const d = Number.isFinite(s.distance) ? Number(s.distance) : 0;
    const last = merged.at(-1);
    if (last && (street === last.street || !street) && !turn) last.distance += d;
    else merged.push({ turn, street, distance: d });
  }
  return merged
    .filter((m) => m.street || m.turn || m.distance >= 50)
    .slice(0, 12)
    .map((m, i) => {
      const verb = m.turn ?? (i === 0 ? 'Head off' : 'Continue');
      return m.street ? `${verb} ${m.turn ? 'onto' : 'along'} ${m.street} (${metres(m.distance)})` : `${verb} (${metres(m.distance)})`;
    });
}

/** openrouteservice `segments[].steps[]` → directions (it already writes them in words). */
export function stepsFromOrs(segments: unknown): string[] {
  if (!Array.isArray(segments)) return [];
  const out: string[] = [];
  for (const seg of segments as Array<{ steps?: Array<{ instruction?: string; distance?: number }> }>) {
    for (const st of seg.steps ?? []) {
      if (!st.instruction) continue;
      out.push(st.distance && st.distance > 0 ? `${st.instruction} (${metres(st.distance)})` : st.instruction);
    }
  }
  return out.slice(0, 15);
}

// ── Transit ────────────────────────────────────────────────────────────────

const VEHICLE: Record<string, NonNullable<LegGuidance['transit']>[number]['vehicle']> = {
  BUS: 'bus',
  COACH: 'bus',
  TRAM: 'tram',
  SUBWAY: 'metro',
  METRO: 'metro',
  RAIL: 'train',
  REGIONAL_RAIL: 'train',
  REGIONAL_FAST_RAIL: 'train',
  HIGHSPEED_RAIL: 'train',
  LONG_DISTANCE: 'train',
  NIGHT_RAIL: 'train',
  SUBURBAN: 'train',
  FERRY: 'ferry',
};

interface MotisLeg {
  mode?: string;
  routeShortName?: string;
  routeLongName?: string;
  displayName?: string;
  headsign?: string;
  startTime?: string;
  from?: { name?: string };
  to?: { name?: string };
  intermediateStops?: unknown[];
  steps?: unknown;
}

/** UTC instant → local minutes in a zone. */
export function localMinutes(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso));
  return Number(parts.find((p) => p.type === 'hour')?.value) * 60 + Number(parts.find((p) => p.type === 'minute')?.value);
}

/**
 * Transitous itineraries for one leg → the lines to take (from the first
 * itinerary) and the next departures of its first ride (one per itinerary).
 */
export function transitFromMotis(itineraries: unknown, timeZone: string): { transit: NonNullable<LegGuidance['transit']>; walkSteps: string[] } | null {
  if (!Array.isArray(itineraries) || !itineraries.length) return null;
  const legsOf = (it: unknown) => ((it as { legs?: MotisLeg[] })?.legs ?? []).filter((l) => l && typeof l === 'object');
  const rides = legsOf(itineraries[0]).filter((l) => l.mode && l.mode !== 'WALK');
  if (!rides.length) return null;
  const firstLine = (rides[0].routeShortName || rides[0].displayName || '').trim();
  const departures = itineraries
    .map((it) => legsOf(it).find((l) => l.mode && l.mode !== 'WALK'))
    .filter((l): l is MotisLeg => !!l && (l.routeShortName || l.displayName || '').trim() === firstLine && !!l.startTime)
    .map((l) => localMinutes(l.startTime!, timeZone))
    .filter((m, i, a) => a.indexOf(m) === i)
    .sort((a, b) => a - b)
    .slice(0, 4);
  const transit = rides.map((l, i) => ({
    line: (l.routeShortName || l.displayName || l.routeLongName || l.mode || 'Service').trim() + (l.headsign ? ` towards ${l.headsign}` : ''),
    vehicle: VEHICLE[l.mode ?? ''] ?? 'other',
    fromStop: l.from?.name ?? 'the stop',
    toStop: l.to?.name ?? 'the stop',
    stops: Array.isArray(l.intermediateStops) ? l.intermediateStops.length + 1 : null,
    departuresMin: i === 0 ? departures : [],
  }));
  const firstWalk = legsOf(itineraries[0]).find((l) => l.mode === 'WALK');
  return { transit, walkSteps: stepsFromMotis(firstWalk?.steps) };
}

// ── Router-only guidance (no model) ────────────────────────────────────────

const VERB: Record<TravelMode, string> = { walk: 'walk', cycle: 'cycle', drive: 'drive', transit: 'by public transport', taxi: 'taxi' };

export function routerGuidance(input: {
  leg: PlannedLeg;
  toTitle: string;
  steps: string[];
  transit: LegGuidance['transit'];
  tripGuide: TripGuide | null;
  now: string;
}): LegGuidance {
  const { leg, toTitle } = input;
  const min = Math.max(1, Math.round(leg.durationSec / 60));
  const about = leg.estimated ? 'about ' : '';
  let summary: string;
  if (leg.mode === 'transit' && input.transit?.length) {
    const t = input.transit[0];
    summary = `${t.vehicle === 'other' ? '' : `${t.vehicle[0].toUpperCase()}${t.vehicle.slice(1)} `}${t.line} from ${t.fromStop}${t.stops ? `, ${t.stops} stop${t.stops === 1 ? '' : 's'}` : ''}, to ${toTitle}`;
  } else if (leg.mode === 'walk' || leg.mode === 'cycle') {
    summary = `${about}${min} min ${VERB[leg.mode]} to ${toTitle}`;
  } else if (leg.mode === 'taxi') {
    summary = `Taxi to ${toTitle}, ${about}${min} min including the wait`;
  } else {
    summary = `${about}${min} min ${VERB[leg.mode]} to ${toTitle}`;
  }
  return {
    summary,
    steps: input.steps,
    transit: leg.mode === 'transit' ? (input.transit ?? null) : null,
    booking: leg.mode === 'taxi' ? (input.tripGuide?.taxi ?? { how: 'Ask at a taxi rank or your hotel to call one; no booking details are known for this city yet.', links: [], phone: null }) : null,
    tips: leg.mode === 'transit' && input.tripGuide?.transitTickets ? [input.tripGuide.transitTickets] : [],
    costText: null,
    source: 'router',
    generatedAt: input.now,
  };
}

// ── Model-written words, links never ───────────────────────────────────────

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);
const texts = (v: unknown, max: number, n: number): string[] =>
  (Array.isArray(v) ? v : []).map((x) => text(x, max)).filter((x): x is string => !!x).slice(0, n);

export const LEG_GUIDE_SYSTEM = `You write the travel directions card for each leg of one day of a trip, for someone standing at the start of the leg with their phone. You are given each leg's routed facts (mode, minutes, walking steps, the transit lines/stops/departures, taxi know-how). Keep the facts exactly as given: never change a line, stop, time or minutes, and never add a link, phone number or price you were not given.
For each leg write: "summary" (one line, e.g. "12 min walk via Via del Corso", "Bus 64 from Largo Argentina, 4 stops"), up to 3 "tips" (practical: which exit, buy a ticket before boarding, cross at the lights), and "costText" only if given a price, else null. British English, no emoji.
Answer ONLY with JSON: {"legs":[{"i": number,"summary": string,"tips": string[],"costText": string|null}]}`;

/** Merge a model's words into router guidance. Links, steps and lines stay the router's. */
export function readLegWords(raw: unknown, base: LegGuidance[]): LegGuidance[] {
  const legs = (raw as { legs?: unknown } | null)?.legs;
  if (!Array.isArray(legs)) return base;
  return base.map((g, i) => {
    const w = legs.find((l) => (l as { i?: unknown })?.i === i) as Record<string, unknown> | undefined;
    if (!w) return g;
    const summary = text(w.summary, 160);
    const tips = texts(w.tips, 200, 3);
    return {
      ...g,
      summary: summary ?? g.summary,
      tips: [...g.tips, ...tips.filter((t) => !g.tips.includes(t))].slice(0, 4),
      costText: g.costText,
      source: summary || tips.length ? 'mixed' : g.source,
    };
  });
}

export const STOP_GUIDE_SYSTEM = `You write the "when you get there" card for one place on a trip, from the researched facts given. One-sentence "summary", then up to 5 short practical "tips": how entry works, tickets (timed entry? show on phone?), dress code if a place of worship, the best entrance or quietest time, what not to miss, how long people usually spend. Only what the facts support or what is widely known and stable about this place; if unsure, leave it out. Never write a link, price or opening time that is not in the facts. British English, no emoji.
Answer ONLY with JSON: {"summary": string, "tips": string[], "links": [{"label": string, "url": string}]} — links ONLY copied from the facts given.`;

export function stopGuidePrompt(title: string, placeName: string | null, destination: string, facts: Facts | null): string {
  if (!facts) return `Place: ${title}${placeName ? ` (${placeName})` : ''}, ${destination}. No researched facts.`;
  return [
    `Place: ${title}${placeName ? ` (${placeName})` : ''}, ${destination}.`,
    facts.summary ? `Summary: ${facts.summary}` : '',
    facts.openingHoursText ? `Opening hours: ${facts.openingHoursText}` : '',
    facts.bookingRequired !== null ? `Booking required: ${facts.bookingRequired ? 'yes' : 'no'}${facts.bookAheadDays !== null ? `, about ${facts.bookAheadDays} days ahead` : ''}` : '',
    facts.priceText ? `Price: ${facts.priceText}` : '',
    facts.typicalVisitSec ? `Typical visit: ${Math.round(facts.typicalVisitSec / 60)} min` : '',
    facts.officialUrl ? `Official site: ${facts.officialUrl}` : '',
    facts.bookingUrl ? `Official tickets: ${facts.bookingUrl}` : '',
    facts.unknown.length ? `Unknown: ${facts.unknown.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Links a guide may carry: only ones already in the facts (and never a reseller). */
function allowedLinks(raw: unknown, allowed: Set<string>): GuideLink[] {
  if (!Array.isArray(raw)) return [];
  const out: GuideLink[] = [];
  for (const l of raw as Array<{ label?: unknown; url?: unknown }>) {
    const url = officialOnly(l?.url);
    const label = text(l?.label, 60);
    if (url && label && allowed.has(url) && !out.some((o) => o.url === url)) out.push({ label, url });
  }
  return out.slice(0, 4);
}

export const STOP_GUIDES_SYSTEM = `You write the "when you get there" card for each place one day of a trip visits, from the researched facts given for each. Per place: a one-sentence "summary", then up to 5 short practical "tips": how entry works, tickets (timed entry? show on phone?), dress code if a place of worship, the best entrance or quietest time, what not to miss, how long people usually spend. Only what the facts support or what is widely known and stable about the place; if unsure, leave it out. Never write a link, price or opening time that is not in that place's facts. British English, no emoji.
Answer ONLY with JSON: {"places": [{"i": number, "summary": string, "tips": string[], "links": [{"label": string, "url": string}]}]} — links ONLY copied from that place's facts.`;

/** One day's places in one call: the batched form of the stop guide (v2.1, latency). */
export function readStopGuides(raw: unknown, facts: Array<Facts | null>, now: string): Array<StopGuide | null> {
  const places = (raw as { places?: unknown } | null)?.places;
  return facts.map((f, i) => {
    const p = Array.isArray(places) ? places.find((x) => (x as { i?: unknown })?.i === i) : null;
    return p ? readStopGuide(p, f, now) : null;
  });
}

export function readStopGuide(raw: unknown, facts: Facts | null, now: string): StopGuide | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const summary = text(r.summary, 300);
  if (!summary) return null;
  const allowed = new Set([facts?.officialUrl, facts?.bookingUrl, ...(facts?.sources ?? []).map((s) => s.url)].filter((u): u is string => !!u));
  const links = allowedLinks(r.links, allowed);
  // The official links are always offered, whatever the model chose.
  for (const [label, url] of [['Official site', facts?.officialUrl], ['Official tickets', facts?.bookingUrl]] as const) {
    if (url && !links.some((l) => l.url === url)) links.push({ label, url });
  }
  return { summary, tips: texts(r.tips, 220, 5), links, generatedAt: now };
}

export const TRIP_GUIDE_SYSTEM = `You write a short "getting around" guide for a city, for a visitor, from the web search results given (and widely known, stable facts). Fields: "gettingAround" (2–3 sentences: walking, the main public transport, how tickets work), "taxi" ({"how": how to get a licensed taxi — ranks, hailing rules, apps that genuinely operate there, the official taxi number; "links": [{"label","url"}] ONLY copied from the search results; "phone": the official taxi number ONLY if it appears in the search results, else null}) or null, "transitTickets" (one sentence: what ticket to buy, where, validating) or null, and up to 5 "tips". Never invent a URL, phone number or price; if unsure, say so in words and give no link. British English, no emoji.
Answer ONLY with JSON: {"gettingAround": string, "taxi": {...}|null, "transitTickets": string|null, "tips": string[]}`;

/**
 * Read a city guide. Links must be from the search results (or `tel:` of a
 * number that appears in them); the phone number must appear in the results.
 */
export function readTripGuide(raw: unknown, results: Array<{ url: string; content: string }>, now: string): TripGuide | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const gettingAround = text(r.gettingAround, 600);
  if (!gettingAround) return null;
  const corpus = results.map((x) => x.content).join('\n');
  const digits = (s: string) => s.replace(/[^\d+]/g, '');
  const inResults = (phone: string) => digits(phone).length >= 5 && digits(corpus).includes(digits(phone).replace(/^\+/, ''));
  const urls = new Set(results.map((x) => x.url));
  const t = (r.taxi && typeof r.taxi === 'object' ? r.taxi : null) as Record<string, unknown> | null;
  let taxi: TripGuide['taxi'] = null;
  if (t) {
    const how = text(t.how, 500);
    const phoneRaw = text(t.phone, 40);
    const phone = phoneRaw && inResults(phoneRaw) ? phoneRaw : null;
    const links = allowedLinks(t.links, urls);
    if (phone) links.push({ label: `Call ${phone}`, url: `tel:${digits(phone)}` });
    if (how) taxi = { how, links, phone };
  }
  return { gettingAround, taxi, transitTickets: text(r.transitTickets, 300), tips: texts(r.tips, 220, 5), generatedAt: now };
}
