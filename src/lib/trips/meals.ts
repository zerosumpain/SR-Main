// src/lib/trips/meals.ts
//
// Real meals (red team 2026-10-15, proposal B). The solver plans lunch and
// dinner as a time with no place. This proposes, for each, up to three real
// places near where you will be at that time: open then (by their own
// OpenStreetMap hours — "hours unknown" is said, never assumed open), a
// short walk from the stop before and on to the stop after, different
// cuisines where it can, with a nudge for the family's dietary needs.
// Choosing one makes it a wish that replaces that meal (`replacesMeal`), so
// the solver routes it like any other stop.
//
// PURE: the Overpass/Nominatim calls and the cache are in ./meals.server.

import type { DayHours, Facts, LatLng, LocalDate, MealOption, PlannedDay, SolvedPlan, Wish } from './model';
import { metresBetween, metresFromLine } from './nearby-ideas';
import { windowsOn } from './solver/hours';

/** Metres per minute on foot (~4.8 km/h), as the ideas use. */
const WALK_M_PER_MIN = 80;
const DEFAULT_RADIUS_M = 700;
const MAX_WALK_MIN = 15;

export type MealKind = 'lunch' | 'dinner';

/** One meal in the plan that still has no place. */
export interface MealSlot {
  /** The meal stop's id, `meal:<date>:lunch|dinner`. */
  stopId: string;
  date: LocalDate;
  meal: MealKind;
  startMin: number;
  endMin: number;
  /** Where you will be just before (the placed stop before), else just after. */
  anchor: LatLng;
  anchorTitle: string;
  /** Where you go after, when it has a place. */
  next: { location: LatLng; title: string } | null;
}

/** The meals that need a place: every lunch and dinner stop of the plan. */
export function mealSlots(plan: SolvedPlan): MealSlot[] {
  const out: MealSlot[] = [];
  for (const day of plan.days) out.push(...daySlots(day));
  return out;
}

export function daySlots(day: PlannedDay): MealSlot[] {
  const out: MealSlot[] = [];
  day.stops.forEach((stop, i) => {
    if (stop.kind !== 'meal') return;
    const m = /^meal:[^:]+:(lunch|dinner)$/.exec(stop.id);
    if (!m) return;
    const before = [...day.stops.slice(0, i)].reverse().find((s) => s.location);
    const after = day.stops.slice(i + 1).find((s) => s.location);
    const anchor = before ?? after;
    if (!anchor?.location) return;
    out.push({
      stopId: stop.id,
      date: day.date,
      meal: m[1] as MealKind,
      startMin: stop.arriveMin,
      endMin: stop.departMin,
      anchor: anchor.location,
      anchorTitle: anchor.kind === 'stay' ? placeName(anchor.title) : anchor.title,
      next: after?.location && after !== anchor ? { location: after.location, title: after.title } : null,
    });
  });
  return out;
}

/**
 * What a cached answer was for: the place and time it was asked about,
 * rounded, so a re-plan that moves lunch a few minutes keeps its options
 * and one that moves it across town asks again.
 */
export function slotFingerprint(slot: MealSlot): string {
  const r = (n: number) => n.toFixed(3);
  // The leading version retires every cached answer when the ranking or its words change.
  return `m1|${slot.date}|${slot.meal}|${r(slot.anchor.lat)},${r(slot.anchor.lng)}|${Math.round(slot.startMin / 30)}`;
}

/** Where to look and how far: round the stop before, a short walk out. */
export function mealSearchArea(slot: MealSlot): { centre: LatLng; radiusM: number } {
  if (!slot.next) return { centre: slot.anchor, radiusM: DEFAULT_RADIUS_M };
  const apart = metresBetween(slot.anchor, slot.next.location);
  // Close together: look around both; far apart: look near where you are.
  if (apart < 1600) {
    return {
      centre: { lat: (slot.anchor.lat + slot.next.location.lat) / 2, lng: (slot.anchor.lng + slot.next.location.lng) / 2 },
      radiusM: Math.round(Math.max(DEFAULT_RADIUS_M, apart / 2 + 300)),
    };
  }
  return { centre: slot.anchor, radiusM: DEFAULT_RADIUS_M };
}

export function mealQuery(slot: MealSlot, area = mealSearchArea(slot)): string {
  const around = `(around:${area.radiusM},${area.centre.lat.toFixed(6)},${area.centre.lng.toFixed(6)})`;
  const kinds = slot.meal === 'lunch' ? 'restaurant|cafe' : 'restaurant';
  return `[out:json][timeout:15];(\nnwr["amenity"~"^(${kinds})$"]["name"]${around};\n);out center tags 120;`;
}

/** The Nominatim terms when Overpass is busy. */
export function mealTerms(slot: MealSlot): string[] {
  return slot.meal === 'lunch' ? ['restaurant', 'cafe'] : ['restaurant'];
}

const DIET_TAG: Record<string, string> = {
  vegetarian: 'diet:vegetarian',
  vegan: 'diet:vegan',
  gluten: 'diet:gluten_free',
  halal: 'diet:halal',
  kosher: 'diet:kosher',
};

/** "italian;pizza" → "Italian, pizza". */
export function cuisineWords(raw: string | undefined): string | null {
  if (!raw) return null;
  const words = raw
    .split(/[;,]/)
    .map((w) => w.trim().replace(/_/g, ' '))
    .filter(Boolean)
    .slice(0, 2);
  if (!words.length) return null;
  const text = words.join(', ');
  return text[0].toUpperCase() + text.slice(1);
}

/** The opening hours on that date, as minutes, from OSM's text. */
export function hoursOn(openingHours: string | undefined, date: LocalDate): DayHours | null {
  if (!openingHours) return null;
  const facts = { openingHoursText: openingHours, hours: null, closedDates: [] } as unknown as Facts;
  return windowsOn(facts, date);
}

/** How late a place may open into the meal and still be offered for it. */
export const OPENS_LATE_MIN = 30;

/**
 * Open long enough for the meal? It may open up to `OPENS_LATE_MIN` after the
 * meal starts (the meal waits), and must stay open `needMin` from then.
 * null = its hours are unknown.
 */
export function openFor(hours: DayHours | null, startMin: number, needMin: number): boolean | null {
  if (hours === null) return null;
  return hours.some((w) => {
    const sit = Math.max(w.openMin, startMin);
    return sit <= startMin + OPENS_LATE_MIN && w.closeMin >= sit + needMin;
  });
}

/** When it opens, if after the meal's start: the minute, else null. */
export function opensAt(hours: DayHours | null, startMin: number, needMin: number): number | null {
  const w = hours?.find((h) => Math.max(h.openMin, startMin) <= startMin + OPENS_LATE_MIN && h.closeMin >= Math.max(h.openMin, startMin) + needMin);
  return w && w.openMin > startMin ? w.openMin : null;
}

const hhmm = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export function hoursText(hours: DayHours | null): string | null {
  if (hours === null) return null;
  if (!hours.length) return 'Closed that day';
  if (hours.some((w) => w.openMin <= 0 && w.closeMin >= 1440)) return 'Open all day';
  return 'Open ' + hours.map((w) => `${hhmm(w.openMin)}–${w.closeMin >= 1440 ? 'midnight' : hhmm(w.closeMin)}`).join(', ');
}

/** "Free time at the flat" / "Drop bags at the flat" → "the flat": where you are, by name. */
export function placeName(title: string): string {
  return title.replace(/^(free time at|drop bags at|back at)\s+/i, '').trim() || title;
}

/**
 * Up to `limit` places for a meal, from Overpass-style elements: named,
 * not already in the trip, not known to be shut at that time, within a
 * short walk; ranked open-for-sure first, then by the walk (off the line to
 * the next stop), with nudges for a dietary match, a website and a cuisine
 * on record, and different cuisines preferred among the three.
 */
export function rankMealOptions(
  answer: unknown,
  slot: MealSlot,
  opts: { existing?: Array<Pick<Wish, 'title' | 'place'>>; hints?: string[]; limit?: number } = {},
): MealOption[] {
  const elements = (answer as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const limit = opts.limit ?? 3;
  const hints = opts.hints ?? [];
  const existing = opts.existing ?? [];
  const names = new Set(existing.flatMap((w) => [w.title, w.place?.name ?? '']).map((n) => n.trim().toLowerCase()).filter(Boolean));
  const ids = new Set(existing.map((w) => w.place?.osmId).filter(Boolean));
  const need = Math.min(45, Math.max(20, slot.endMin - slot.startMin));
  const scored: Array<MealOption & { score: number; cuisineKey: string }> = [];
  const seen = new Set<string>();
  for (const raw of elements) {
    const e = raw as { type?: string; id?: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> };
    const tags = e.tags ?? {};
    const name = (tags['name:en'] ?? tags.name ?? '').trim();
    const lat = Number(e.lat ?? e.center?.lat);
    const lng = Number(e.lon ?? e.center?.lon);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || !e.type || e.id == null) continue;
    const osmId = `${e.type}/${e.id}`;
    const key = name.toLowerCase();
    if (ids.has(osmId) || names.has(key) || seen.has(key)) continue;
    if (tags.disused || tags['disused:amenity'] || tags.abandoned) continue;
    seen.add(key);
    const at = { lat, lng };
    const walkInM = metresBetween(slot.anchor, at);
    const walkMin = Math.max(1, Math.round(walkInM / WALK_M_PER_MIN));
    if (walkMin > MAX_WALK_MIN) continue;
    const hours = hoursOn(tags.opening_hours, slot.date);
    const open = openFor(hours, slot.startMin, need);
    if (open === false) continue;
    const diet = hints.filter((h) => /^(yes|only)$/.test(tags[DIET_TAG[h]] ?? ''));
    const cuisine = cuisineWords(tags.cuisine);
    const off = slot.next ? metresFromLine(at, slot.anchor, slot.next.location) : walkInM;
    const score =
      off +
      (open ? 0 : 400) -
      diet.length * 200 -
      (tags.website || tags['contact:website'] ? 60 : 0) -
      (cuisine ? 40 : 0) -
      (tags.wikidata ? 80 : 0);
    const kind = tags.amenity === 'cafe' ? 'cafe' : 'restaurant';
    const address = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ') || null;
    const walkLine = `${walkMin} min walk from ${slot.anchorTitle}`;
    const late = open ? opensAt(hours, slot.startMin, need) : null;
    const openLine = open ? (late !== null ? `opens ${hhmm(late)} · ${hoursText(hours)}` : hoursText(hours)) : 'hours not on record — check before going';
    scored.push({
      id: osmId,
      name,
      kind,
      cuisine,
      place: { name, location: at, osmId, address },
      walkMin,
      walkFrom: slot.anchorTitle,
      openText: open ? hoursText(hours) : null,
      openKnown: open === true,
      website: tags.website ?? tags['contact:website'] ?? null,
      phone: tags.phone ?? tags['contact:phone'] ?? null,
      diet,
      outdoorSeating: tags.outdoor_seating === 'yes',
      wheelchair: tags.wheelchair === 'yes' ? true : tags.wheelchair === 'no' ? false : null,
      wikidata: tags.wikidata ?? null,
      why: [cuisine ?? (kind === 'cafe' ? 'Café' : 'Restaurant'), walkLine, openLine, diet.length ? `marked ${diet.join('/')}` : null]
        .filter(Boolean)
        .join(' · '),
      source: 'OpenStreetMap',
      score,
      cuisineKey: (cuisine ?? kind).toLowerCase().split(',')[0],
    });
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  // Three different cuisines where the list allows, then the next best.
  const picked: typeof scored = [];
  for (const c of scored) {
    if (picked.length >= limit) break;
    if (!picked.some((p) => p.cuisineKey === c.cuisineKey)) picked.push(c);
  }
  for (const c of scored) {
    if (picked.length >= limit) break;
    if (!picked.includes(c)) picked.push(c);
  }
  picked.sort((a, b) => a.score - b.score);
  return picked.map(({ score: _s, cuisineKey: _c, ...o }) => o);
}

/** Meal options keyed by meal stop id, onto the plan's meal stops (bundle only). */
export function withMealOptions(plan: SolvedPlan, options: Record<string, MealOption[]>): SolvedPlan {
  return {
    ...plan,
    days: plan.days.map((d) => ({
      ...d,
      stops: d.stops.map((s) => (s.kind === 'meal' && options[s.id]?.length ? { ...s, mealOptions: options[s.id] } : s)),
    })),
  };
}
