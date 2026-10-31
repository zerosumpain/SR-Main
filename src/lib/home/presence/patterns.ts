// src/lib/home/presence/patterns.ts
//
// Movement patterns: the long view of how each person in the household moves.
// Where they go and what kind of place it is, when in the day they are where,
// who they are with, how long they travel for what they stay, and what their
// step count does on the days they go somewhere. PURE — the trail, places and
// daily steps come in; one report goes out (`patterns.server.ts` builds it
// nightly and keeps it).
//
// Everything is read off the same trips the forecast learns from
// (`tripsFrom`): a visit is the time between arriving somewhere on one trip
// and leaving it on the next. A gap in the trail breaks the chain, so what is
// not observed is not counted — coverage is reported beside every figure.

import { metresBetween } from './cluster';
import { localClock } from './forecast';
import {
  analysisFixes, bridgeSleeps, continuous, located, normaliseReadings, percentile, placeTitle, tripsFrom, usableFix,
  type Fix, type InsightFix, type InsightPerson, type InsightPlace, type Trip,
} from './insights';
import { circularMedianMinute, hhmm } from './stats';
import { MIN_DWELL_MINS, VISIT_MAX_GAP_MINS } from './types';

const MINUTE = 60_000;
const DAY = 86_400_000;
/** The co-presence and time-of-day grid. Ten minutes: finer only adds noise to a 2-minute trail. */
const BIN_MS = 10 * MINUTE;
/** A visit longer than this between two trips is a trail that lost them, not a stay. */
const MAX_VISIT_MS = 20 * 60 * MINUTE;
const MAX_HOME_VISIT_MS = 4 * DAY;
/** Two people on the "same" journey: left and arrived within this of each other, same ends. */
const SHARED_TRIP_SLACK_MS = 12 * MINUTE;
/** Further than this from home, an unnamed place is filed as far afield, not unnamed. */
const FAR_KM = 80;
/** Days a category needs on each side before a steps difference is shown. */
const MIN_STEP_DAYS = 4;
/** "New" is a first visit inside this, with at least as much history before it. */
const NEW_MS = 28 * DAY;

export interface PatternPlace extends InsightPlace {
  suggestedKind?: string | null;
  firstSeenAt?: Date | string | null;
  /** What a web lookup says is there (`place-types.server`): its category, a short type, and its name. */
  lookup?: PlaceType | null;
}

export interface PlaceType {
  category: Category;
  /** "Discount supermarket", "Theme park", "Hospital". */
  type: string;
  /** The business at an unnamed address, when the lookup was sure of it. */
  name: string | null;
}

export const CATEGORIES = [
  { id: 'home', label: 'Home' },
  { id: 'family', label: 'Family & friends' },
  { id: 'homes', label: 'Other houses' },
  { id: 'school', label: 'School' },
  { id: 'work', label: 'Work' },
  { id: 'shops', label: 'Shops & retail' },
  { id: 'food', label: 'Food & drink' },
  { id: 'outdoors', label: 'Parks & outdoors' },
  { id: 'daysout', label: 'Attractions & days out' },
  { id: 'leisure', label: 'Leisure & entertainment' },
  { id: 'sport', label: 'Sport & fitness' },
  { id: 'health', label: 'Health & care' },
  { id: 'services', label: 'Services & errands' },
  { id: 'community', label: 'Community & worship' },
  { id: 'stay', label: 'Hotels & stays' },
  { id: 'transport', label: 'Stations & travel' },
  { id: 'far', label: 'Far afield' },
  { id: 'other', label: 'Other named' },
  { id: 'unnamed', label: 'Unnamed stops' },
] as const;
export type Category = (typeof CATEGORIES)[number]['id'];
export const categoryLabel = (c: Category) => CATEGORIES.find((x) => x.id === c)!.label;
const PHRASES: Partial<Record<Category, string>> = {
  family: 'on days at family or friends', homes: "on days at someone else's house", school: 'on school days', work: 'on days at work',
  shops: 'on days in the shops', food: 'on days out to eat', outdoors: 'on days with a park or a walk', daysout: 'on days out',
  leisure: 'on days at the cinema, bowling and the like', sport: 'on days with sport', health: 'on days at the doctor, dentist or hospital',
  services: 'on days running errands', community: 'on days at church or a community place', stay: 'on days at a hotel',
  transport: 'on days through a station', far: 'on days far from home', other: 'on days at their other named places',
};
export const categoryPhrase = (c: Category) => PHRASES[c] ?? `on days at ${categoryLabel(c).toLowerCase()}`;

/** The page's colour groups: the site's four chart hues, home and travel as ink. */
export const GROUPS = [
  { id: 'home', label: 'Home', slots: ['home'] },
  { id: 'duty', label: 'School & work', slots: ['school', 'work'] },
  { id: 'family', label: 'Family & friends', slots: ['family', 'homes'] },
  { id: 'far', label: 'Far afield', slots: ['far'] },
  { id: 'about', label: 'Out & about', slots: ['shops', 'food', 'outdoors', 'daysout', 'leisure', 'sport', 'health', 'services', 'community', 'stay', 'transport', 'other', 'unnamed', 'unplaced'] },
  { id: 'travel', label: 'Travelling', slots: ['travel'] },
] as const;
export type Group = (typeof GROUPS)[number]['id'];
export const groupOf = (slot: string): Group => GROUPS.find((g) => (g.slots as readonly string[]).includes(slot))?.id ?? 'about';

/** The categories a web lookup may answer with; the rest are the owner's or the trail's to say. */
export const LOOKUP_CATEGORIES = ['shops', 'food', 'daysout', 'leisure', 'outdoors', 'sport', 'health', 'services', 'community', 'stay',
  'transport', 'school', 'work', 'homes', 'other'] as const satisfies readonly Category[];

// Words in a name that say what a place is, when its kind does not. Checked in
// order: "Stanhope Park" is outdoors, "Dalton Park" shopping — the retail list
// is checked first for the names that are known to be shops.
const WORDS: Array<[Category, RegExp]> = [
  ['shops', /\b(aldi|lidl|tesco|asda|sainsbury|morrisons|co-?op|m&s|marks|home ?bargains|b&m|primark|retail|outlet|dalton park|town|city cent(re|er)|high street|market|mall|jewell?er|samuel)\b/i],
  ['food', /\b(caf[eé]|coffee|costa|starbucks|greggs|pub|inn|arms|restaurant|pizza|kitchen|bar|bistro|tea ?room|mcdonald|kfc|nando)\b/i],
  ['transport', /\b(station|airport|bus|interchange|terminal|metro|port|ferry)\b/i],
  ['health', /\b(hospital|surgery|medical|clinic|dentist|dental|pharmacy|chemist|optician|health cent(re|er)|gp)\b/i],
  ['stay', /\b(hotel|hostel|lodge|b&b|holiday park|campsite|caravan)\b/i],
  ['sport', /\b(gym|leisure cent(re|er)|pool|swim|football|rugby|cricket|tennis|golf|ski(ing)?|climb|dojo|stadium|pitch|sports?)\b/i],
  ['community', /\b(church|chapel|cathedral|mosque|temple|library|community cent(re|er)|village hall|scouts?)\b/i],
  ['daysout', /\b(towers|land|zoo|aquarium|museum|gallery|castle|abbey|hall|theme|safari|farm|rapids)\b/i],
  ['leisure', /\b(cinema|bowling|theatre|theater|arena|activity|adventure|trampoline|soft play|arcade|fair|race|show|festival)\b/i],
  ['outdoors', /\b(park|green|wood|woods|forest|beach|walk|lake|moor|garden|gardens|hill|fell|river|reservoir|nature|country ?park|trail|bridge|pier|coast|bay|falls)\b/i],
  ['school', /\b(school|college|academy|university|nursery|campus)\b/i],
];

/**
 * What kind of place this is, for grouping. The owner's own kind first, then
 * what a web lookup found there, then the words in its name, then the
 * geocoder's guess; a nameless place far from home is "far afield" (a holiday,
 * a day trip) rather than lost among the unnamed stops at home.
 */
export function categoryOf(p: PatternPlace, homeId: string | null, home: { lat: number; lon: number } | null): Category {
  if (p.id === homeId) return 'home';
  if (p.kind === 'home') return 'family';
  if (p.kind === 'school') return 'school';
  if (p.kind === 'work') return 'work';
  if (p.kind === 'cafe') return 'food';
  if (p.kind === 'gym') return 'sport';
  const name = p.label || '';
  const far = home && metresBetween(home.lat, home.lon, p.lat, p.lon) / 1000 > FAR_KM;
  // A lookup's "other" says nothing; nor does any lookup of a nameless address on holiday.
  const looked = p.lookup && p.lookup.category !== 'other' && (name || !far) ? p.lookup.category : null;
  if (looked) return looked;
  for (const [cat, re] of WORDS) if (name && re.test(name)) return cat;
  if (p.kind === 'shop') return 'shops';
  if (far) return 'far';
  if (p.suggestedKind === 'cafe') return 'food';
  if (p.suggestedKind === 'shop') return 'shops';
  if (p.suggestedKind === 'school') return 'school';
  if (name) return 'other';
  for (const [cat, re] of WORDS) if (p.suggestedLabel && re.test(p.suggestedLabel)) return cat;
  return 'unnamed';
}

export interface Visit {
  subject: string; placeId: string; category: Category;
  start: number; end: number; minutes: number;
  /** The trip that arrived: its minutes and mode. */
  inMinutes: number; inMode: string; fromId: string;
  /** Minutes on foot (walking pace, away from the vehicle) between arriving and leaving. */
  onFoot: number;
  /** Local date and weekday (0 = Monday) of the arrival, minute of day it began. */
  date: string; weekday: number; arriveMin: number;
}

interface Leg { start: number; end: number; active: boolean; moving: boolean; lat: number; lon: number }

// localClock formats with Intl; the grids ask ~40k times a person. Memoised by
// minute — arrival and departure times are read to the minute.
const clockByMinute = new Map<number, ReturnType<typeof localClock>>();
function clockAt(t: number) {
  const minute = Math.floor(t / MINUTE);
  let c = clockByMinute.get(minute);
  if (!c) {
    if (clockByMinute.size > 200_000) clockByMinute.clear();
    c = localClock(minute * MINUTE); clockByMinute.set(minute, c);
  }
  return c;
}

/** The legs between continuous fixes, classified as `analysePresence` does. */
function legsOf(fixes: InsightFix[], now: Date): Leg[] {
  const legs: Leg[] = [];
  for (let i = 0; i + 1 < fixes.length; i++) {
    const a = fixes[i], b = fixes[i + 1];
    if (!usableFix(a, +now) || !usableFix(b, +now) || !continuous(a, b)) continue;
    const distance = metresBetween(a.lat, a.lon, b.lat, b.lon), mins = (+b.ts - +a.ts) / MINUTE;
    const speed = distance / mins * 0.06;
    const moving = distance > 75 || (distance > Math.max(25, (a.accuracyM ?? 25) + (b.accuracyM ?? 25)) && (b.speedKmh ?? speed) >= 1.5);
    const active = moving && speed >= 1.5 && speed < 18 && !['vehicle', 'rail'].includes(b.mode ?? '') && (b.speedKmh ?? speed) < 18;
    legs.push({ start: +a.ts, end: +b.ts, moving, active, lat: a.lat, lon: a.lon });
  }
  return legs;
}

/** Minutes of `legs` (sorted) on foot inside [from, to). */
function onFootBetween(legs: Leg[], from: number, to: number): number {
  let lo = 0, hi = legs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (legs[mid].end <= from) lo = mid + 1; else hi = mid; }
  let total = 0;
  for (let i = lo; i < legs.length && legs[i].start < to; i++) {
    const l = legs[i];
    if (l.active) total += (Math.min(to, l.end) - Math.max(from, l.start)) / MINUTE;
  }
  return total;
}

/**
 * Visits read straight off the fixes: unbroken runs inside one place, at
 * least `MIN_DWELL_MINS` long. Two runs at the same place with nowhere else
 * between them and under `VISIT_MAX_GAP_MINS` apart are one visit — a walk
 * round the park leaves its circle and comes back; the walking is the visit's
 * time on foot. Trips are NOT needed: a trail gap loses the journey in, not
 * the stay. The trip that ends at a visit's start, if one does, is its way in.
 */
export function visitsFrom(fixes: InsightFix[], trips: Trip[], legs: Leg[], places: InsightPlace[], cats: Map<string, Category>, homeId: string | null, now: Date): Visit[] {
  const runs: Array<{ placeId: string; start: number; end: number }> = [];
  let run: { placeId: string; start: number; end: number } | null = null, prev: Fix | null = null;
  for (const raw of fixes) {
    if (!usableFix(raw, +now)) { run = null; prev = null; continue; }
    const f = located(raw, places);
    if (prev && !continuous(prev, f)) run = null;
    if (f.placeId) {
      if (run && run.placeId === f.placeId) run.end = +f.ts;
      else { run = { placeId: f.placeId, start: +f.ts, end: +f.ts }; runs.push(run); }
    } else run = null;
    prev = f;
  }
  const merged: typeof runs = [];
  for (const r of runs) {
    const last = merged.at(-1);
    const cap = r.placeId === homeId ? MAX_HOME_VISIT_MS : MAX_VISIT_MS;
    if (last && last.placeId === r.placeId && r.start - last.end <= VISIT_MAX_GAP_MINS * MINUTE && r.end - last.start <= cap) last.end = r.end;
    else merged.push({ ...r });
  }
  const out: Visit[] = [];
  for (const r of merged) {
    if (r.end - r.start < MIN_DWELL_MINS * MINUTE) continue;
    const c = clockAt(r.start);
    const way = trips.find((t) => t.to === r.placeId && Math.abs(t.end - r.start) <= 15 * MINUTE);
    out.push({
      subject: fixes[0]?.subject ?? '', placeId: r.placeId, category: cats.get(r.placeId) ?? 'unnamed',
      start: r.start, end: r.end, minutes: (r.end - r.start) / MINUTE,
      inMinutes: way?.minutes ?? 0, inMode: way?.mode ?? '', fromId: way?.from ?? '',
      onFoot: onFootBetween(legs, r.start, r.end), date: c.date, weekday: c.weekday, arriveMin: c.minute,
    });
  }
  return out;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r0 = (n: number) => Math.round(n);
const med = (v: number[]) => (v.length ? percentile(v, 0.5) : 0);
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);

export type Slot = Category | 'travel' | 'unplaced';
export const SLOT_ORDER: Slot[] = ['home', 'family', 'school', 'work', 'shops', 'food', 'outdoors', 'leisure', 'sport', 'transport', 'far', 'other', 'unnamed', 'travel', 'unplaced'];

export interface PlacePattern {
  placeId: string; name: string; category: Category;
  /** What the lookup says it is: "Discount supermarket". */
  type: string | null;
  visits: number; days: number; hours: number; medianStay: number;
  medianTravelIn: number; activeShare: number; arrives: string; weekdayShare: number;
  onFootPerVisit: number; stayPerTravel: number | null;
  /** Who else is often there at the same time: name → share of this person's time there. */
  with: Array<{ subject: string; share: number }>;
  isNew: boolean;
}

export interface PersonPattern extends InsightPerson {
  observedHours: number; coverage: number;
  trips: number; travelHours: number; activeTripShare: number; medianTrip: number; distanceKm: number;
  awayHours: number; homeShare: number; homeDays: number; observedDays: number;
  places: PlacePattern[];
  categories: Array<{ category: Category; hours: number; visits: number; share: number }>;
  /** Share of observed time in each slot, by hour of day — weekday and weekend. */
  dayShape: Record<'weekday' | 'weekend', Array<Partial<Record<Slot, number>>>>;
  firstOut: { weekday: string | null; weekend: string | null };
  lastHome: { weekday: string | null; weekend: string | null };
  /** How alike their days are: the share of observed time spent in that hour's usual slot. */
  predictability: number;
  /** Typical radius of their week, km, and the furthest place reached. */
  roamKm: number; farthest: { name: string; km: number } | null;
  distinctPlaces: number; newPlaces: number; topThreeShare: number;
  aloneOutShare: number;
  steps: {
    days: number; mean: number | null;
    homeDay: number | null; outDay: number | null;
    byCategory: Array<{ category: Category; withMean: number; withoutMean: number; days: number; lift: number }>;
    /** Steps on a day against minutes out of the house on foot: slope per hour and r. */
    perOnFootHour: number | null; r: number | null;
    /** The day's steps shared out by on-foot minutes, summed per place: an estimate. */
    byPlace: Array<{ placeId: string; name: string; steps: number }>;
    week: Array<{ weekday: number; mean: number }>;
  };
  weekly: Array<{ week: string; trips: number; awayHours: number; places: number; steps: number | null }>;
}

export interface PatternsReport {
  generatedAt: string; days: number; from: string; to: string;
  people: PersonPattern[];
  together: {
    pairs: Array<{ a: string; b: string; outHours: number; homeHours: number; sharedTrips: number }>;
    groups: Array<{ subjects: string[]; hours: number; places: Array<{ name: string; hours: number }> }>;
    whole: { hours: number; places: Array<{ name: string; hours: number }> };
  };
  household: {
    categories: Array<{ category: Category; hours: number; visits: number; people: number }>;
    shared: Array<{ placeId: string; name: string; category: Category; type: string | null; people: string[]; visits: number; hours: number }>;
    departures: number[][];
  };
  findings: Array<{ subject: string | null; text: string; weight: number }>;
}

/** Pearson correlation and least-squares slope of y on x. */
function fit(xs: number[], ys: number[]): { slope: number; r: number } | null {
  const n = xs.length;
  if (n < 6) return null;
  const mx = sum(xs) / n, my = sum(ys) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  if (!sxx || !syy) return null;
  return { slope: sxy / sxx, r: sxy / Math.sqrt(sxx * syy) };
}

/** ISO-ish week key (the Monday's date) of a local date. */
function weekOf(date: string, weekday: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  return new Date(+d - weekday * DAY).toISOString().slice(0, 10);
}

const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Async only to yield between people: 90 days of five people is seconds of CPU. */
export async function analysePatterns(
  rows: InsightFix[], places: PatternPlace[], people: InsightPerson[], steps: Map<string, Map<string, number>>,
  now: Date, days: number, homeId: string | null,
): Promise<PatternsReport> {
  const from = +now - days * DAY;
  const home = places.find((p) => p.id === homeId) ?? null;
  const cats = new Map(places.map((p) => [p.id, categoryOf(p, homeId, home)]));
  const placeById = new Map(places.map((p) => [p.id, p]));
  const name = (id: string) => { const p = placeById.get(id); return (!p?.label && p?.lookup?.name) || placeTitle(p); };
  rows = normaliseReadings(rows.filter((r) => +r.ts >= from && +r.ts <= +now));

  // Per person: trips, visits, legs and the bin-by-bin state the grids and
  // co-presence are read from.
  const perPerson = new Map<string, { trips: Trip[]; visits: Visit[]; legs: Leg[]; bins: Map<number, string> }>();
  for (const person of people) {
    await breathe();
    const mine = rows.filter((f) => f.subject === person.subject);
    const { trips } = tripsFrom(mine, places, now);
    const fixes = analysisFixes(bridgeSleeps(mine, places, now), now);
    const legs = legsOf(fixes, now);
    const visits = visitsFrom(fixes, trips, legs, places, cats, homeId, now);
    // State per bin: a visit's place id, `trip`, `seen` (observed, neither), absent = unseen.
    const bins = new Map<number, string>();
    for (const l of legs) for (let b = Math.floor(l.start / BIN_MS); b * BIN_MS < l.end; b++) bins.set(b, 'seen');
    for (const t of trips) for (let b = Math.floor(t.start / BIN_MS); b * BIN_MS < t.end; b++) bins.set(b, 'trip');
    for (const v of visits) for (let b = Math.ceil(v.start / BIN_MS); (b + 1) * BIN_MS <= v.end; b++) bins.set(b, v.placeId);
    // A place-tagged fix that no visit claimed is still being there: fill the bins it sits in.
    for (const f of fixes) {
      if (!usableFix(f, +now)) continue;
      const b = Math.floor(+f.ts / BIN_MS);
      if (bins.get(b) === 'seen') { const id = located(f as Fix, places).placeId; if (id) bins.set(b, id); }
    }
    perPerson.set(person.subject, { trips, visits, legs, bins });
  }

  // ── Together ──────────────────────────────────────────────────────────────
  const pairKey = (a: string, b: string) => [a, b].sort().join('|');
  const pairs = new Map<string, { out: number; home: number; trips: number }>();
  const groups = new Map<string, { minutes: number; places: Map<string, number> }>();
  const whole = { minutes: 0, places: new Map<string, number>() };
  const withAt = new Map<string, Map<string, number>>(); // subject → "placeId|other" → minutes
  const aloneOut = new Map<string, { alone: number; out: number }>();
  const allBins = new Set<number>();
  for (const p of perPerson.values()) for (const b of p.bins.keys()) allBins.add(b);
  const binMins = BIN_MS / MINUTE;
  for (const b of allBins) {
    const at = new Map<string, string[]>();
    for (const [subject, p] of perPerson) {
      const s = p.bins.get(b);
      if (!s || s === 'seen' || s === 'trip') continue;
      const list = at.get(s) ?? []; list.push(subject); at.set(s, list);
    }
    for (const [placeId, subs] of at) {
      const isHome = placeId === homeId;
      if (!isHome) for (const s of subs) {
        const a = aloneOut.get(s) ?? { alone: 0, out: 0 };
        a.out += binMins; if (subs.length === 1) a.alone += binMins; aloneOut.set(s, a);
      }
      if (subs.length < 2) continue;
      for (let i = 0; i < subs.length; i++) for (let j = i + 1; j < subs.length; j++) {
        const k = pairKey(subs[i], subs[j]), e = pairs.get(k) ?? { out: 0, home: 0, trips: 0 };
        if (isHome) e.home += binMins; else e.out += binMins;
        pairs.set(k, e);
      }
      if (isHome) continue;
      for (const s of subs) {
        const m = withAt.get(s) ?? new Map<string, number>();
        for (const o of subs) if (o !== s) m.set(`${placeId}|${o}`, (m.get(`${placeId}|${o}`) ?? 0) + binMins);
        withAt.set(s, m);
      }
      const gk = [...subs].sort().join('|'), g = groups.get(gk) ?? { minutes: 0, places: new Map() };
      g.minutes += binMins; g.places.set(placeId, (g.places.get(placeId) ?? 0) + binMins); groups.set(gk, g);
      if (subs.length === people.length && people.length > 2) {
        whole.minutes += binMins; whole.places.set(placeId, (whole.places.get(placeId) ?? 0) + binMins);
      }
    }
  }
  // Shared journeys: same ends, left and arrived together.
  const subjects = people.map((p) => p.subject);
  for (let i = 0; i < subjects.length; i++) for (let j = i + 1; j < subjects.length; j++) {
    const a = perPerson.get(subjects[i])!.trips, b = perPerson.get(subjects[j])!.trips;
    let n = 0;
    for (const t of a) if (b.some((u) => u.from === t.from && u.to === t.to && Math.abs(u.start - t.start) <= SHARED_TRIP_SLACK_MS && Math.abs(u.end - t.end) <= SHARED_TRIP_SLACK_MS)) n++;
    if (n) { const k = pairKey(subjects[i], subjects[j]), e = pairs.get(k) ?? { out: 0, home: 0, trips: 0 }; e.trips = n; pairs.set(k, e); }
  }
  const topPlaces = (m: Map<string, number>, n = 4) => [...m].sort((x, y) => y[1] - x[1]).slice(0, n).map(([id, mins]) => ({ name: name(id), hours: r1(mins / 60) }));

  // ── People ────────────────────────────────────────────────────────────────
  const departures = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  const counted = new Set<string>();
  const peopleOut: PersonPattern[] = [];
  for (const person of people) {
    await breathe();
    const { trips, visits, legs, bins } = perPerson.get(person.subject)!;
    const observed = sum(legs.map((l) => (l.end - l.start) / MINUTE));
    for (const t of trips) {
      if (t.from !== homeId) continue;
      // People leaving together count once.
      const key = `${Math.round(t.start / SHARED_TRIP_SLACK_MS)}:${t.to}`;
      if (counted.has(key)) continue;
      counted.add(key);
      const c = clockAt(t.start); departures[c.weekday][Math.floor(c.minute / 60)]++;
    }

    // Destinations.
    const byPlace = new Map<string, Visit[]>();
    for (const v of visits) { const l = byPlace.get(v.placeId) ?? []; l.push(v); byPlace.set(v.placeId, l); }
    const seenAt = new Map<string, number>(); // minutes by place from bins, for time-at
    for (const s of bins.values()) if (s !== 'seen' && s !== 'trip') seenAt.set(s, (seenAt.get(s) ?? 0) + binMins);
    const placesOut: PlacePattern[] = [...byPlace].map(([placeId, list]) => {
      const p = placeById.get(placeId);
      const hours = sum(list.map((v) => v.minutes)) / 60;
      const ways = list.filter((v) => v.inMinutes > 0), travel = med(ways.map((v) => v.inMinutes));
      const mine = seenAt.get(placeId) ?? hours * 60;
      const others = withAt.get(person.subject) ?? new Map<string, number>();
      const withList = subjects.filter((s) => s !== person.subject)
        .map((s) => ({ subject: s, share: r1(((others.get(`${placeId}|${s}`) ?? 0) / Math.max(1, mine)) * 100) / 100 }))
        .filter((w) => w.share >= 0.15).sort((a, b) => b.share - a.share);
      const firstVisit = Math.min(...list.map((v) => v.start));
      return {
        placeId, name: name(placeId), category: cats.get(placeId) ?? 'unnamed', type: placeById.get(placeId)?.lookup?.type ?? null,
        visits: list.length, days: new Set(list.map((v) => v.date)).size, hours: r1(hours),
        medianStay: r0(med(list.map((v) => v.minutes))), medianTravelIn: r0(travel),
        activeShare: ways.length ? r1(ways.filter((v) => v.inMode === 'active').length / ways.length * 100) / 100 : 0,
        arrives: hhmm(circularMedianMinute(list.map((v) => v.arriveMin))),
        weekdayShare: r1(list.filter((v) => v.weekday < 5).length / list.length * 100) / 100,
        onFootPerVisit: r0(sum(list.map((v) => v.onFoot)) / list.length),
        stayPerTravel: travel > 0 ? r1(med(list.map((v) => v.minutes)) / travel) : null,
        with: withList, isNew: +now - from > 2 * NEW_MS && firstVisit >= +now - NEW_MS,
      };
    }).sort((a, b) => b.hours - a.hours);

    // Categories (away from home, by visits; home's share by time seen).
    const catMap = new Map<Category, { hours: number; visits: number }>();
    for (const pl of placesOut) { const c = catMap.get(pl.category) ?? { hours: 0, visits: 0 }; c.hours += pl.hours; c.visits += pl.visits; catMap.set(pl.category, c); }
    const catTotal = sum([...catMap.values()].map((c) => c.hours)) || 1;
    const categories = [...catMap].map(([category, c]) => ({ category, hours: r1(c.hours), visits: c.visits, share: r1(c.hours / catTotal * 100) / 100 }))
      .sort((a, b) => b.hours - a.hours);

    // Day shape: per hour, share of observed time in each slot.
    const shape = { weekday: Array.from({ length: 24 }, () => new Map<Slot, number>()), weekend: Array.from({ length: 24 }, () => new Map<Slot, number>()) };
    const usual = new Map<string, Map<Slot, number>>(); // weekday/weekend:hour → slot minutes, for predictability
    for (const [b, s] of bins) {
      const c = clockAt(b * BIN_MS + BIN_MS / 2);
      const slot: Slot = s === 'trip' ? 'travel' : s === 'seen' ? 'unplaced' : (cats.get(s) ?? 'unnamed');
      const type = c.weekday >= 5 ? 'weekend' : 'weekday', h = Math.floor(c.minute / 60);
      const m = shape[type][h]; m.set(slot, (m.get(slot) ?? 0) + binMins);
      const k = `${type}:${h}`, u = usual.get(k) ?? new Map<Slot, number>(); u.set(slot, (u.get(slot) ?? 0) + binMins); usual.set(k, u);
    }
    const toShares = (list: Array<Map<Slot, number>>) => list.map((m) => {
      const total = sum([...m.values()]);
      return Object.fromEntries([...m].map(([k, v]) => [k, Math.round(v / total * 1000) / 1000])) as Partial<Record<Slot, number>>;
    });
    let modal = 0, all = 0;
    for (const u of usual.values()) { const v = [...u.values()]; modal += Math.max(...v); all += sum(v); }

    // Per day: away time, trips, categories, on-foot minutes out, steps.
    const daySteps = steps.get(person.subject) ?? new Map<string, number>();
    const dayStats = new Map<string, { weekday: number; trips: number; away: number; onFoot: number; cats: Set<Category>; observed: number; places: Set<string> }>();
    const dayOf = (t: number) => {
      const c = clockAt(t);
      let d = dayStats.get(c.date);
      if (!d) { d = { weekday: c.weekday, trips: 0, away: 0, onFoot: 0, cats: new Set(), observed: 0, places: new Set() }; dayStats.set(c.date, d); }
      return d;
    };
    for (const l of legs) dayOf(l.start).observed += (l.end - l.start) / MINUTE;
    for (const t of trips) { const d = dayOf(t.start); d.trips++; if (t.mode === 'active') d.onFoot += t.minutes; }
    for (const v of visits) {
      if (v.placeId === homeId) continue;
      const d = dayOf(v.start); d.away += v.minutes; d.onFoot += v.onFoot; d.cats.add(v.category); d.places.add(v.placeId);
    }
    // A day counts once most of it was seen: 16 hours of trail.
    const fullDays = [...dayStats].filter(([, d]) => d.observed >= 16 * 60);
    const atHome = (d: { trips: number; places: Set<string> }) => d.trips === 0 && d.places.size === 0;
    const homeDays = fullDays.filter(([, d]) => atHome(d)).length;

    // First out and last home.
    const firstOut = { weekday: [] as number[], weekend: [] as number[] }, lastHome = { weekday: [] as number[], weekend: [] as number[] };
    const tripsByDay = new Map<string, Trip[]>();
    for (const t of trips) { const d = clockAt(t.start).date, l = tripsByDay.get(d) ?? []; l.push(t); tripsByDay.set(d, l); }
    for (const list of tripsByDay.values()) {
      const c = clockAt(list[0].start), type = c.weekday >= 5 ? 'weekend' : 'weekday';
      const out = list.find((t) => t.from === homeId), back = [...list].reverse().find((t) => t.to === homeId);
      if (out) firstOut[type].push(clockAt(out.start).minute);
      // Past midnight still counts as that evening: 00:30 is 24:30.
      if (back) { const m = clockAt(back.end).minute; lastHome[type].push(m < 240 ? m + 1440 : m); }
    }
    const timeOf = (v: number[]) => (v.length >= 3 ? hhmm(v.length ? percentile(v, 0.5) : 0) : null);

    // Roaming: the radius of each week's places, weighted by time there.
    const weeks = new Map<string, Visit[]>();
    for (const v of visits) { const k = weekOf(v.date, v.weekday), l = weeks.get(k) ?? []; l.push(v); weeks.set(k, l); }
    const radii: number[] = [];
    for (const list of weeks.values()) {
      const pts = list.map((v) => ({ p: placeById.get(v.placeId)!, w: v.minutes })).filter((x) => x.p);
      const w = sum(pts.map((x) => x.w));
      if (!w || pts.length < 2) continue;
      const lat = sum(pts.map((x) => x.p.lat * x.w)) / w, lon = sum(pts.map((x) => x.p.lon * x.w)) / w;
      radii.push(Math.sqrt(sum(pts.map((x) => x.w * (metresBetween(lat, lon, x.p.lat, x.p.lon) / 1000) ** 2)) / w));
    }
    let farthest: PersonPattern['farthest'] = null;
    if (home) for (const pl of placesOut) {
      const p = placeById.get(pl.placeId)!, km = metresBetween(home.lat, home.lon, p.lat, p.lon) / 1000;
      if (!farthest || km > farthest.km) farthest = { name: pl.name, km: r0(km) };
    }
    const awayPlaces = placesOut.filter((p) => p.placeId !== homeId);
    const awayHours = sum(awayPlaces.map((p) => p.hours));
    const topThree = sum(awayPlaces.slice(0, 3).map((p) => p.hours));
    const homeHours = placesOut.find((p) => p.placeId === homeId)?.hours ?? 0;

    // Steps against the days.
    const stepDays = fullDays.filter(([date]) => daySteps.has(date)).map(([date, d]) => ({ date, d, steps: daySteps.get(date)! }));
    const allStepDays = [...daySteps].filter(([date]) => {
      const t = Date.parse(`${date}T12:00:00Z`);
      return t >= from && t <= +now;
    });
    const mean = (v: number[]) => (v.length ? r0(sum(v) / v.length) : null);
    // A holiday's walking would flatter every category it shares days with:
    // other categories compare only the days at home's end of the map.
    const byCategory = CATEGORIES.map(({ id }) => {
      const pool = id === 'far' ? stepDays : stepDays.filter((x) => !x.d.cats.has('far'));
      const w = pool.filter((x) => x.d.cats.has(id)).map((x) => x.steps);
      const wo = pool.filter((x) => !x.d.cats.has(id)).map((x) => x.steps);
      if (id === 'home' || id === 'unnamed' || w.length < MIN_STEP_DAYS || wo.length < MIN_STEP_DAYS) return null;
      const withMean = sum(w) / w.length, withoutMean = sum(wo) / wo.length;
      return { category: id as Category, withMean: r0(withMean), withoutMean: r0(withoutMean), days: w.length, lift: r0(withMean - withoutMean) };
    }).filter((x): x is NonNullable<typeof x> => x != null).sort((a, b) => b.lift - a.lift);
    const f = fit(stepDays.map((x) => x.d.onFoot / 60), stepDays.map((x) => x.steps));
    // Each day's steps shared over the day's on-foot minutes: trips on foot to
    // a place, and walking about once there. An estimate, said so on the page.
    const placeSteps = new Map<string, number>();
    // Only the steps above an at-home day's are walking out.
    const base = mean(stepDays.filter((y) => atHome(y.d)).map((y) => y.steps)) ?? 0;
    for (const x of stepDays) {
      const onFoot: Array<[string, number]> = [];
      for (const v of visits) if (v.date === x.date && v.placeId !== homeId) onFoot.push([v.placeId, v.onFoot + (v.inMode === 'active' ? v.inMinutes : 0)]);
      const total = sum(onFoot.map(([, m]) => m));
      const extra = Math.max(0, x.steps - base);
      if (total > 0) for (const [id, m] of onFoot) placeSteps.set(id, (placeSteps.get(id) ?? 0) + extra * (m / total));
    }
    const week = Array.from({ length: 7 }, (_, wd) => ({ weekday: wd, mean: mean(stepDays.filter((x) => x.d.weekday === wd).map((x) => x.steps)) ?? 0 }));

    // Weekly trend.
    const weekly = new Map<string, { trips: number; away: number; places: Set<string>; steps: number[] }>();
    for (const [date, d] of dayStats) {
      const k = weekOf(date, d.weekday), w = weekly.get(k) ?? { trips: 0, away: 0, places: new Set(), steps: [] };
      w.trips += d.trips; w.away += d.away; for (const p of d.places) w.places.add(p);
      if (daySteps.has(date)) w.steps.push(daySteps.get(date)!);
      weekly.set(k, w);
    }

    const ao = aloneOut.get(person.subject);
    peopleOut.push({
      ...person,
      observedHours: r0(observed / 60), coverage: r1(observed / (days * 1440) * 100) / 100,
      trips: trips.length, travelHours: r1(sum(trips.map((t) => t.minutes)) / 60),
      activeTripShare: trips.length ? r1(trips.filter((t) => t.mode === 'active').length / trips.length * 100) / 100 : 0,
      medianTrip: r0(med(trips.map((t) => t.minutes))),
      distanceKm: r0(sum(trips.map((t) => {
        let m = 0; for (let i = 1; i < t.path.length; i++) m += metresBetween(t.path[i - 1].lat, t.path[i - 1].lon, t.path[i].lat, t.path[i].lon);
        return m / 1000;
      }))),
      awayHours: r1(awayHours), homeShare: r1(homeHours / Math.max(1, homeHours + awayHours) * 100) / 100,
      homeDays, observedDays: fullDays.length,
      places: placesOut.slice(0, 25), categories,
      dayShape: { weekday: toShares(shape.weekday), weekend: toShares(shape.weekend) },
      firstOut: { weekday: timeOf(firstOut.weekday), weekend: timeOf(firstOut.weekend) },
      lastHome: { weekday: timeOf(lastHome.weekday), weekend: timeOf(lastHome.weekend) },
      predictability: all ? r1(modal / all * 100) / 100 : 0,
      roamKm: r1(med(radii)), farthest,
      distinctPlaces: byPlace.size, newPlaces: placesOut.filter((p) => p.isNew).length,
      topThreeShare: awayHours ? r1(topThree / awayHours * 100) / 100 : 0,
      aloneOutShare: ao && ao.out ? r1(ao.alone / ao.out * 100) / 100 : 0,
      steps: {
        days: allStepDays.length, mean: mean(allStepDays.map(([, s]) => s)),
        homeDay: mean(stepDays.filter((x) => atHome(x.d)).map((x) => x.steps)),
        outDay: mean(stepDays.filter((x) => x.d.places.size > 0).map((x) => x.steps)),
        byCategory, perOnFootHour: f ? r0(f.slope) : null, r: f ? Math.round(f.r * 100) / 100 : null,
        byPlace: [...placeSteps].map(([placeId, s]) => ({ placeId, name: name(placeId), steps: r0(s) })).sort((a, b) => b.steps - a.steps).slice(0, 8),
        week,
      },
      weekly: [...weekly].sort((a, b) => a[0].localeCompare(b[0])).map(([wk, w]) => ({
        week: wk, trips: w.trips, awayHours: r1(w.away / 60), places: w.places.size, steps: mean(w.steps),
      })),
    });
  }

  // ── Household ─────────────────────────────────────────────────────────────
  const hhCats = new Map<Category, { hours: number; visits: number; people: Set<string> }>();
  const shared = new Map<string, { people: Set<string>; visits: number; hours: number }>();
  for (const p of peopleOut) for (const pl of p.places) {
    const c = hhCats.get(pl.category) ?? { hours: 0, visits: 0, people: new Set() };
    c.hours += pl.hours; c.visits += pl.visits; c.people.add(p.subject); hhCats.set(pl.category, c);
    if (pl.placeId === homeId) continue;
    const s = shared.get(pl.placeId) ?? { people: new Set(), visits: 0, hours: 0 };
    s.people.add(p.subject); s.visits += pl.visits; s.hours += pl.hours; shared.set(pl.placeId, s);
  }
  const nameOfPerson = (s: string) => people.find((p) => p.subject === s)?.displayName ?? s;
  const pairList = [...pairs].map(([k, e]) => { const [a, b] = k.split('|'); return { a, b, outHours: r1(e.out / 60), homeHours: r1(e.home / 60), sharedTrips: e.trips }; })
    .sort((x, y) => y.outHours - x.outHours);
  const report: PatternsReport = {
    generatedAt: now.toISOString(), days, from: new Date(from).toISOString(), to: now.toISOString(),
    people: peopleOut,
    together: {
      pairs: pairList,
      groups: [...groups].map(([k, g]) => ({ subjects: k.split('|'), hours: r1(g.minutes / 60), places: topPlaces(g.places) }))
        .filter((g) => g.hours >= 1).sort((a, b) => b.hours - a.hours).slice(0, 12),
      whole: { hours: r1(whole.minutes / 60), places: topPlaces(whole.places) },
    },
    household: {
      categories: [...hhCats].map(([category, c]) => ({ category, hours: r1(c.hours), visits: c.visits, people: c.people.size })).sort((a, b) => b.hours - a.hours),
      shared: [...shared].filter(([, s]) => s.people.size >= 2).map(([placeId, s]) => ({
        placeId, name: name(placeId), category: cats.get(placeId) ?? 'unnamed', type: placeById.get(placeId)?.lookup?.type ?? null, people: [...s.people], visits: s.visits, hours: r1(s.hours),
      })).sort((a, b) => b.people.length - a.people.length || b.hours - a.hours).slice(0, 12),
      departures,
    },
    findings: [],
  };
  report.findings = findingsOf(report, nameOfPerson);
  return report;
}

/**
 * The few things worth saying in words, strongest first. Each is a figure the
 * page also shows; nothing here is inferred beyond it.
 */
export function findingsOf(r: PatternsReport, nameOf: (s: string) => string): PatternsReport['findings'] {
  const out: PatternsReport['findings'] = [];
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  for (const p of r.people) {
    if (p.coverage < 0.15) { out.push({ subject: p.subject, text: `${p.displayName}'s phone was seen only ${pct(p.coverage)} of the window, so their patterns are thin.`, weight: 0.2 }); continue; }
    const lift = p.steps.byCategory[0];
    if (lift && lift.lift > 1500) out.push({ subject: p.subject, weight: Math.min(1, lift.lift / 8000),
      text: `${p.displayName} walks ${lift.lift.toLocaleString('en-GB')} more steps ${categoryPhrase(lift.category)} (${lift.withMean.toLocaleString('en-GB')} against ${lift.withoutMean.toLocaleString('en-GB')}, ${lift.days} days).` });
    if (p.steps.homeDay != null && p.steps.outDay != null && p.steps.outDay > p.steps.homeDay * 1.4)
      out.push({ subject: p.subject, weight: 0.5, text: `A day at home costs ${p.displayName} about ${(p.steps.outDay - p.steps.homeDay).toLocaleString('en-GB')} steps: ${p.steps.homeDay.toLocaleString('en-GB')} against ${p.steps.outDay.toLocaleString('en-GB')} on days out.` });
    const anchor = p.places.find((pl) => pl.category !== 'home');
    if (anchor) out.push({ subject: p.subject, weight: 0.45, text: `${p.displayName}'s anchor away from home is ${anchor.name}: ${anchor.hours} hours over ${anchor.days} days, usually arriving ${anchor.arrives}.` });
    const worst = p.places.filter((pl) => pl.visits >= 3 && pl.stayPerTravel != null && pl.category !== 'home').sort((a, b) => a.stayPerTravel! - b.stayPerTravel!)[0];
    if (worst && worst.stayPerTravel! < 1.5) out.push({ subject: p.subject, weight: 0.35, text: `${p.displayName}'s dearest trip for the time there: ${worst.medianTravelIn} minutes to ${worst.name} for a stay of about ${worst.medianStay}.` });
    if (p.aloneOutShare >= 0.6 && p.awayHours > 10) out.push({ subject: p.subject, weight: 0.3, text: `Out of the house, ${p.displayName} is mostly on their own: ${pct(p.aloneOutShare)} of their time away has nobody else from home there.` });
  }
  const seen = r.people.filter((p) => p.coverage >= 0.15);
  const byHabit = [...seen].sort((a, b) => b.predictability - a.predictability);
  if (byHabit.length >= 2 && byHabit[0].predictability - byHabit.at(-1)!.predictability >= 0.05)
    out.push({ subject: null, weight: 0.3, text: `${byHabit[0].displayName} keeps the steadiest rhythm (${pct(byHabit[0].predictability)} of their time is where they usually are at that hour); ${byHabit.at(-1)!.displayName} the loosest (${pct(byHabit.at(-1)!.predictability)}).` });
  const explorer = [...seen].sort((a, b) => b.newPlaces - a.newPlaces)[0];
  if (explorer && explorer.newPlaces >= 5) out.push({ subject: explorer.subject, weight: 0.25, text: `${explorer.displayName} is the explorer: ${explorer.newPlaces} places first visited in the last four weeks.` });
  const pair = r.together.pairs[0];
  if (pair && pair.outHours > 2) out.push({ subject: null, weight: 0.6, text: `${nameOf(pair.a)} and ${nameOf(pair.b)} spend the most time together out of the house: ${pair.outHours} hours${pair.sharedTrips ? `, and ${pair.sharedTrips} journeys made together` : ''}.` });
  if (r.together.whole.hours > 0) out.push({ subject: null, weight: 0.5, text: `The whole household was out in one place for ${r.together.whole.hours} hours${r.together.whole.places[0] ? `, most of it at ${r.together.whole.places[0].name}` : ''}.` });
  const busiest = r.household.shared[0];
  if (busiest) out.push({ subject: null, weight: 0.4, text: `${busiest.name} is the most shared place: ${busiest.people.length} people, ${busiest.visits} visits between them.` });
  return out.sort((a, b) => b.weight - a.weight);
}

/**
 * What to search for to learn what a place is: its own name with the town the
 * map put it in, or the map's address for a nameless stop. Null when there is
 * nothing to search, or when it is somebody's house the owner already named —
 * a family address never goes to a search engine.
 */
export function placeQuery(p: PatternPlace & { suggestedAddress?: string | null }, homeId: string | null): string | null {
  if (p.id === homeId || p.kind === 'home') return null;
  const address = (p.suggestedAddress || '').trim();
  if (p.label) {
    const town = address.split(',').slice(1).map((s) => s.trim()).filter(Boolean)[0];
    return town && !p.label.toLowerCase().includes(town.toLowerCase().split(' ')[0]) ? `${p.label}, ${town}` : p.label;
  }
  return address || p.suggestedLabel || null;
}

/**
 * Read the model's answer: a JSON array of `{ id, category, type, name }`.
 * Anything outside the fixed categories, or for an id it was not asked about,
 * is dropped rather than guessed.
 */
export function parsePlaceTypes(text: string, ids: string[]): Map<string, PlaceType> {
  const out = new Map<string, PlaceType>();
  const start = text.indexOf('['), end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return out;
  let rows: unknown;
  try { rows = JSON.parse(text.slice(start, end + 1)); } catch { return out; }
  if (!Array.isArray(rows)) return out;
  const asked = new Set(ids), cats = new Set<string>(LOOKUP_CATEGORIES);
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  for (const r of rows as Array<Record<string, unknown>>) {
    const id = str(r?.id, 64), category = str(r?.category, 20)?.toLowerCase();
    if (!id || !asked.has(id) || !category || !cats.has(category)) continue;
    out.set(id, { category: category as Category, type: str(r.type, 40) ?? categoryLabel(category as Category), name: str(r.name, 60) });
  }
  return out;
}
