// src/lib/trips/shapes.ts
//
// v8: trip shapes, the pure half. At the start of a trip (and on request) the
// planner offers two or three whole ways to do it — "Ancient Rome first,
// slow afternoons", "Neighbourhood days" — each a themed selection of 8–14
// places from the research pack with the days they suit. Every shape is
// solved as a whole on top of what is already fixed (stays, journeys,
// bookings, locked stops) before anyone sees it; shapes whose plans differ
// in fewer than three stops are one shape, not two. The person picks one
// (./proposals, S1); the others expire.
//
// The model only CHOOSES from the pack (ids it was given) — it never names a
// place, so every stop in a shape is a real, located place. PURE.

import { dayLabel } from './changes';
import type { LocalDate, SolvedPlan, Trip, TripOp, Wish } from './model';
import type { PackCalendarItem, PackPlace, ShapeSummary } from './decisions';
import { addPackWish } from './questions';

export const SHAPE_MIN_PLACES = 8;
export const SHAPE_MAX_PLACES = 14;
export const MAX_SHAPES = 3;
/** Shapes whose plans differ in fewer stops than this are the same shape. */
export const SHAPE_MIN_DIFFERENCE = 3;

const FOOD = new Set(['food', 'cafe', 'gelato']);

export const SHAPES_SYSTEM = `You draft two or three DIFFERENT ways to do a trip, for the traveller to choose between, using ONLY places from the research pack given (by id).
Each way has a clear idea ("Ancient Rome first, slow afternoons", "Neighbourhood days", "The big three on separate mornings") and picks 8–14 places that fit it, spread over the days, with the days they suit: keep each day's places close together, put outdoor places on dry days and indoor ones on wet days, leave room round the fixed items (they never move), and respect the pace. Make the ways genuinely different (different places or a different balance); include at least one less-visited place in each. Meals are planned separately — do not pick restaurants.
Answer ONLY with JSON: {"shapes": [{"headline": short title (≤ 50 characters, sentence case), "why": one plain sentence on who it suits, "days": [{"date": "YYYY-MM-DD", "theme": a few words, "placeIds": [ids]}]}]}
British English, plain words, no emoji.`;

export interface ShapePromptInput {
  trip: Pick<Trip, 'destination' | 'startDate' | 'endDate' | 'pace'>;
  dates: LocalDate[];
  travellers: string | null;
  preferences: string[];
  fixed: Array<{ date: LocalDate; text: string }>;
  places: PackPlace[];
  calendar: PackCalendarItem[];
}

/** The places the model may choose from: not food, not turned down. */
export function shapeCandidates(places: PackPlace[]): PackPlace[] {
  return places.filter((p) => p.status !== 'rejected' && !FOOD.has(p.kind));
}

export function shapesPrompt(i: ShapePromptInput): string {
  const lines = [
    `Trip: ${i.trip.destination}, ${i.dates.map((d) => `${dayLabel(d)} (${d})`).join(', ')}. Pace: ${i.trip.pace}.`,
    i.travellers ? `Travelling: ${i.travellers}.` : '',
    i.preferences.length ? `They like: ${i.preferences.slice(0, 8).join('; ')}.` : '',
    i.fixed.length ? `Fixed (never moves):\n${i.fixed.map((f) => `- ${dayLabel(f.date)}: ${f.text}`).join('\n')}` : 'Nothing is fixed yet.',
    i.calendar.filter((c) => c.date).length ? `On the dates:\n${i.calendar.filter((c) => c.date).map((c) => `- ${dayLabel(c.date!)}: ${c.text}`).join('\n')}` : '',
    '',
    'Research pack places:',
    ...i.places.map((p) =>
      JSON.stringify({
        id: p.id,
        name: p.name,
        kind: p.kind,
        tags: p.tags,
        minutes: p.durationMin,
        indoor: p.indoor,
        forChildren: p.kidFriendly,
        lessVisited: p.lessVisited,
        needsBooking: p.bookingRequired,
        area: p.neighbourhood,
      }),
    ),
  ];
  return lines.filter((l, n, a) => l !== '' || a[n - 1] !== '').join('\n');
}

export interface ShapeChoice {
  headline: string;
  why: string;
  /** Pack place id → the day the model put it on. */
  days: Map<string, LocalDate>;
  placeIds: string[];
  themes: Map<LocalDate, string>;
}

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);

/** The model's shapes, kept only with real pack ids, within the trip's days, 8–14 places (fewer when the pack is small). */
export function readShapes(raw: unknown, ids: Set<string>, dates: LocalDate[]): ShapeChoice[] {
  const list = (raw && typeof raw === 'object' ? (raw as { shapes?: unknown }).shapes : null) as unknown[] | null;
  if (!Array.isArray(list)) return [];
  const floor = Math.min(SHAPE_MIN_PLACES, Math.max(4, ids.size));
  const out: ShapeChoice[] = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    const headline = text(o.headline, 60);
    if (!headline) continue;
    const days = new Map<string, LocalDate>();
    const themes = new Map<LocalDate, string>();
    for (const d of Array.isArray(o.days) ? o.days : []) {
      const dd = d as Record<string, unknown>;
      const date = typeof dd.date === 'string' && dates.includes(dd.date) ? dd.date : null;
      if (date && text(dd.theme, 40)) themes.set(date, text(dd.theme, 40)!);
      for (const id of Array.isArray(dd.placeIds) ? dd.placeIds : []) {
        if (typeof id !== 'string' || !ids.has(id) || days.has(id) || days.size >= SHAPE_MAX_PLACES) continue;
        days.set(id, date ?? '');
      }
    }
    // A flat list is read too (no days given).
    for (const id of Array.isArray(o.placeIds) ? o.placeIds : []) if (typeof id === 'string' && ids.has(id) && !days.has(id) && days.size < SHAPE_MAX_PLACES) days.set(id, '');
    if (days.size < floor) continue;
    out.push({ headline, why: text(o.why, 240) ?? '', days, placeIds: [...days.keys()], themes });
    if (out.length >= MAX_SHAPES) break;
  }
  return out;
}

/** Two shapes the solver can always offer, when no model answers: the famous, and the quieter. */
export function fallbackShapes(places: PackPlace[], dates: LocalDate[]): ShapeChoice[] {
  const pool = shapeCandidates(places);
  const n = Math.min(SHAPE_MAX_PLACES, Math.max(SHAPE_MIN_PLACES, dates.length * 3));
  const pick = (list: PackPlace[]) => list.slice(0, n).map((p) => p.id);
  const famous = pick([...pool.filter((p) => !p.lessVisited), ...pool.filter((p) => p.lessVisited)]);
  const quiet = pick([...pool.filter((p) => p.lessVisited), ...pool.filter((p) => !p.lessVisited)]);
  const mk = (headline: string, why: string, ids: string[]): ShapeChoice => ({ headline, why, placeIds: ids, days: new Map(ids.map((id) => [id, ''])), themes: new Map() });
  return [
    mk('The famous sights', 'The places most people come for, spread across the days.', famous),
    mk('Quieter corners', 'Less-visited museums, gardens and views, away from the crowds.', quiet),
  ].filter((s) => s.placeIds.length >= Math.min(SHAPE_MIN_PLACES, Math.max(4, pool.length)));
}

/** The ops a shape replays: each chosen place as a wish (its place already found), pinned to its day when it has one. */
export function shapeOps(choice: ShapeChoice, places: PackPlace[], wishes: Array<Pick<Wish, 'title' | 'place' | 'skipped'>>): TripOp[] {
  const have = new Set(wishes.filter((w) => !w.skipped).flatMap((w) => [w.title.toLowerCase(), w.place?.osmId ?? '']).filter(Boolean));
  const ops: TripOp[] = [];
  for (const id of choice.placeIds) {
    const p = places.find((x) => x.id === id);
    if (!p || have.has(p.name.toLowerCase()) || (p.place.osmId && have.has(p.place.osmId))) continue;
    ops.push(addPackWish(p, choice.days.get(id) || null));
  }
  return ops;
}

/** The stops a plan has, as `title@date`, for "do two shapes really differ". */
export function shapeStops(plan: SolvedPlan): Set<string> {
  return new Set(plan.days.flatMap((d) => d.stops.filter((s) => s.kind === 'wish').map((s) => `${s.title.toLowerCase()}@${d.date}`)));
}

/** Indexes of the shapes to keep: each differs from every one kept before it in at least SHAPE_MIN_DIFFERENCE stops. */
export function distinctShapes(stops: Array<Set<string>>): number[] {
  const kept: number[] = [];
  for (const [i, s] of stops.entries()) {
    const near = kept.some((k) => {
      const other = stops[k];
      let diff = 0;
      for (const x of s) if (!other.has(x)) diff++;
      for (const x of other) if (!s.has(x)) diff++;
      return diff < SHAPE_MIN_DIFFERENCE;
    });
    if (!near) kept.push(i);
  }
  return kept;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;

/** A line per day of the solved shape ("Land 11:30 · Pantheon · Trevi Fountain"), and what it leaves out. */
export function shapeSummary(headline: string, plan: SolvedPlan, leavesOut: string[]): ShapeSummary {
  const days = plan.days.map((d) => {
    const bits = d.stops
      .filter((s) => s.kind === 'wish' || s.kind === 'transport')
      .map((s) => (s.kind === 'transport' ? `${/arrive/.test(s.id) ? 'Land' : 'Leave'} ${hhmm(s.kind === 'transport' && /arrive/.test(s.id) ? s.arriveMin : s.departMin)}` : s.title));
    const line = bits.length ? bits.join(' · ') : 'A free day';
    return { date: d.date, line: line.length > 140 ? `${line.slice(0, 139)}…` : line };
  });
  return { headline, days, leavesOut: leavesOut.slice(0, 4) };
}

/** The famous places of the pack a shape does not include (the "leaves out" line), most famous first. */
export function leftOut(choice: ShapeChoice, places: PackPlace[], dropped: string[]): string[] {
  const chosen = new Set(choice.placeIds);
  const famous = shapeCandidates(places).filter((p) => !p.lessVisited && !chosen.has(p.id) && p.status === 'candidate').map((p) => p.name);
  return [...new Set([...dropped, ...famous])].slice(0, 4);
}
