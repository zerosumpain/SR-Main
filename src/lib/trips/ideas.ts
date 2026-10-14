// src/lib/trips/ideas.ts
//
// "Ask for an idea" for an open slot (the pure half). The planner is given
// the GAP, not just the date: the stop before it and the stop after it (the
// stay at the start or end of the day when there is none), the minutes
// between them, whether it is a meal slot, the day's whole itinerary and
// what is planned or dropped on other days. Every idea it returns is then
// VERIFIED with the solver — added to a copy of the trip, pinned to that day,
// re-solved without saving — and kept only if it lands in the slot it was
// meant for; anything it would push out is named. I/O is in ./ideas.server.

import { estimateLeg, solveTrip } from '$lib/trips/solver';
import { dayLabel } from './changes';
import {
  DAY_STAGE_LABEL,
  type DayStage,
  type LatLng,
  type PartOfDay,
  type PlannedDay,
  type PlannedStop,
  type SolvedPlan,
  type TravelMatrix,
  type TravelMode,
  type Wish,
  type WishDraft,
} from './model';
import { groupDay, stagedStops } from './stages';

export type MealRole = 'breakfast' | 'lunch' | 'dinner' | null;

export interface GapEnd {
  stopId: string;
  title: string;
  location: LatLng | null;
  /** Leave the previous stop at (before) / arrive at the next stop by (after). */
  min: number;
}

export interface Gap {
  date: string;
  stage: DayStage;
  before: GapEnd;
  after: GapEnd;
  /** Minutes between leaving `before` and arriving at `after`. */
  freeMin: number;
  /** A meal slot: the idea becomes that meal (replacesMeal). */
  meal: MealRole;
  /** The meal stop the idea would replace, when there is one. */
  replacesStopId: string | null;
}

const STAGE_MEAL: Record<DayStage, MealRole> = { morning: null, lunch: 'lunch', afternoon: null, evening: 'dinner' };

/** Free-time stays mid-day ("Free time at the hotel") and, in a meal slot, the meal itself are open. */
function isOpen(stop: PlannedStop, index: number, day: PlannedDay, meal: MealRole): boolean {
  if (stop.kind === 'stay') return index > 0 && index < day.stops.length - 1;
  return !!meal && stop.kind === 'meal' && stop.id.endsWith(`:${meal}`);
}

/**
 * The open slot to fill. With `afterStopId`/`beforeStopId`, the gap between
 * those two stops; otherwise the largest gap touching the stage: from the
 * last fixed stop before (or inside) the stage to the next one. Null when the
 * day is not in the plan.
 */
export function computeGap(plan: SolvedPlan, date: string, stage: DayStage, between?: { afterStopId?: string | null; beforeStopId?: string | null }): Gap | null {
  const day = plan.days.find((d) => d.date === date);
  if (!day || !day.stops.length) return null;
  const stops = stagedStops(day);
  const groups = groupDay(day);
  const stageOfId = new Map(groups.flatMap((g) => g.items.map((i) => [i.stop.id, g.stage] as const)));
  let meal = STAGE_MEAL[stage];
  if (stage === 'morning' && stops.some((s) => s.kind === 'meal' && s.id.endsWith(':breakfast') && stageOfId.get(s.id) === 'morning')) {
    // An empty morning starting with breakfast at the stay: the idea may be a café breakfast.
    const wishInMorning = stops.some((s) => s.kind === 'wish' && stageOfId.get(s.id) === 'morning');
    if (!wishInMorning) meal = 'breakfast';
  }
  const fixed = stops.map((s, i) => ({ s, i })).filter(({ s, i }) => !isOpen(s, i, day, meal));
  const end = (s: PlannedStop, which: 'before' | 'after'): GapEnd => ({ stopId: s.id, title: s.title, location: s.location, min: which === 'before' ? s.departMin : s.arriveMin });

  let a: PlannedStop | undefined;
  let b: PlannedStop | undefined;
  if (between?.afterStopId || between?.beforeStopId) {
    a = stops.find((s) => s.id === between.afterStopId) ?? stops[0];
    b = stops.find((s) => s.id === between.beforeStopId) ?? stops[stops.length - 1];
  } else {
    // Candidate gaps: consecutive fixed stops where either side is in the stage,
    // or which straddle it; take the longest.
    let best = -1;
    for (let k = 0; k + 1 < fixed.length; k++) {
      const x = fixed[k].s;
      const y = fixed[k + 1].s;
      const touches =
        stageOfId.get(x.id) === stage ||
        stageOfId.get(y.id) === stage ||
        stops.slice(fixed[k].i + 1, fixed[k + 1].i).some((s) => stageOfId.get(s.id) === stage) ||
        (rank(stageOfId.get(x.id)) < rank(stage) && rank(stageOfId.get(y.id)) > rank(stage));
      const gapMin = y.arriveMin - x.departMin;
      if (touches && gapMin > best) {
        best = gapMin;
        a = x;
        b = y;
      }
    }
  }
  if (!a || !b) return null;
  const replaces = meal ? (stops.find((s) => s.kind === 'meal' && s.id.endsWith(`:${meal}`) && s.arriveMin >= a!.departMin && s.departMin <= b!.arriveMin)?.id ?? null) : null;
  return { date, stage, before: end(a, 'before'), after: end(b, 'after'), freeMin: Math.max(0, b.arriveMin - a.departMin), meal, replacesStopId: replaces };
}

const STAGE_RANK: Record<DayStage, number> = { morning: 0, lunch: 1, afternoon: 2, evening: 3 };
const rank = (s: DayStage | undefined) => (s ? STAGE_RANK[s] : -1);

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;

/** The day's itinerary in one line per stop, for the prompt. */
export function itineraryText(day: PlannedDay): string {
  return stagedStops(day)
    .map((s) => `${hhmm(s.arriveMin)}–${hhmm(s.departMin)} ${s.title}${s.kind === 'stay' ? ' (stay)' : s.kind === 'meal' ? ' (meal)' : ''} [${s.stage ?? ''}]`)
    .join('\n');
}

export const IDEAS_SYSTEM = `You find ideas for ONE open slot in a trip's day. You are given the slot: the stop before it (where they will be leaving from, and when) and the stop after it (where they must be, and by when), the minutes in between, whether it is a meal slot, the whole day, what is already planned or dropped on other days, and what you know about the travellers.

Find up to 3 ideas that genuinely FIT this slot:
- near the line between the stop before and the stop after (not across the city), and open at that time on that day;
- with travel IN (from the stop before) plus the visit plus travel OUT (to the stop after) fitting inside the free minutes — check with travel_time for the likely ones, and say the numbers;
- a place to eat when it is a meal slot (honour dietary needs in the profile);
- not something already planned on another day, and not something they dropped.
Use your tools sparingly (find_place, travel_time, opening_hours, web_search). Never invent links, prices or opening times.

Answer ONLY with JSON:
{"ideas":[{"title": string,"placeQuery": a precise place to look up ("Sant'Ignazio, Rome"),"durationMin": number,"why": one line,"fit": one line with the travel and spare minutes ("12 min walk from the Pantheon, 45 min there, 15 min on to Trevi — leaves 10 min spare")}],"note": string|null}
"note" says plainly when nothing fits ("Nothing fits a 25-minute gap with the walk back — shorten something?").`;

export function ideasPrompt(input: {
  gap: Gap;
  day: PlannedDay;
  destination: string;
  otherDays: Array<{ date: string; titles: string[] }>;
  dropped: string[];
  profileText: string;
  guideText: string | null;
  transportText: string | null;
}): string {
  const g = input.gap;
  return [
    `Trip to ${input.destination}. The slot: ${dayLabel(g.date)} (${g.date}), ${DAY_STAGE_LABEL[g.stage]}.`,
    `Leaving: ${g.before.title} at ${hhmm(g.before.min)}${g.before.location ? ` (${g.before.location.lat.toFixed(5)}, ${g.before.location.lng.toFixed(5)})` : ''}.`,
    `Next: ${g.after.title} by ${hhmm(g.after.min)}${g.after.location ? ` (${g.after.location.lat.toFixed(5)}, ${g.after.location.lng.toFixed(5)})` : ''}.`,
    `Free: ${g.freeMin} minutes in total, including travel in and out.`,
    g.meal ? `This is a ${g.meal.toUpperCase()} slot: the idea replaces the planned ${g.meal}, so suggest places to eat.` : 'Not a meal slot.',
    '',
    'The whole day:',
    itineraryText(input.day),
    '',
    `Other days: ${input.otherDays.map((d) => `${dayLabel(d.date)}: ${d.titles.join(', ') || 'free'}`).join(' | ') || 'none'}`,
    `Dropped from the plan: ${input.dropped.join(', ') || 'nothing'}`,
    input.transportText ? `Getting there and back: ${input.transportText}` : '',
    input.guideText ? `City know-how: ${input.guideText}` : '',
    '',
    input.profileText,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export interface IdeaDraft {
  title: string;
  placeQuery: string;
  durationMin: number;
  why: string;
  fit: string;
}

const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, n) : null);

export function readIdeas(raw: unknown): { ideas: IdeaDraft[]; note: string | null } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ideas: IdeaDraft[] = [];
  for (const x of Array.isArray(r.ideas) ? r.ideas : []) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const title = str(o.title, 120);
    if (!title || ideas.some((i) => i.title.toLowerCase() === title.toLowerCase())) continue;
    const d = Number(o.durationMin);
    ideas.push({
      title,
      placeQuery: str(o.placeQuery, 200) ?? title,
      // An answer outside 10 min–6 h is clamped, not replaced: a long idea must stay long to be judged fairly.
      durationMin: Number.isFinite(d) && d > 0 ? Math.min(360, Math.max(10, Math.round(d))) : 45,
      why: str(o.why, 240) ?? '',
      fit: str(o.fit, 240) ?? '',
    });
    if (ideas.length >= 3) break;
  }
  return { ideas, note: str(r.note, 300) };
}

/** The wish an idea becomes for its slot: pinned to the day, in the stage (or as the meal). */
export function ideaDraft(idea: IdeaDraft, gap: Gap): WishDraft {
  const part: Record<DayStage, PartOfDay> = { morning: 'morning', lunch: 'any', afternoon: 'afternoon', evening: 'evening' };
  return {
    title: idea.title,
    placeQuery: idea.placeQuery,
    priority: 'nice',
    durationMin: idea.durationMin,
    partOfDay: gap.meal ? 'any' : part[gap.stage],
    fixedDate: gap.date,
    fixedStartMin: null,
    note: idea.why ? `Idea for ${dayLabel(gap.date)} ${DAY_STAGE_LABEL[gap.stage].toLowerCase()}: ${idea.why}` : null,
    replacesMeal: gap.meal,
  };
}

/** Add a point to a matrix with estimated times to and from every other point (all modes present). */
export function withPoint(matrix: TravelMatrix, id: string, at: LatLng, locations: Map<string, LatLng>): TravelMatrix {
  const points = [...matrix.points, id];
  const seconds: TravelMatrix['seconds'] = {};
  const metres: TravelMatrix['metres'] = {};
  for (const mode of Object.keys(matrix.seconds) as TravelMode[]) {
    const m = mode === 'taxi' ? 'drive' : mode;
    const leg = (p: string, into: boolean) => {
      const loc = locations.get(p);
      if (!loc) return { seconds: null as number | null, metres: null as number | null };
      const e = into ? estimateLeg(loc, at, m) : estimateLeg(at, loc, m);
      return { seconds: e.seconds, metres: e.metres };
    };
    seconds[mode] = [...(matrix.seconds[mode] ?? []).map((row, i) => [...row, leg(matrix.points[i], true).seconds]), [...matrix.points.map((p) => leg(p, false).seconds), 0]];
    if (matrix.metres[mode]) metres[mode] = [...matrix.metres[mode]!.map((row, i) => [...row, leg(matrix.points[i], true).metres]), [...matrix.points.map((p) => leg(p, false).metres), 0]];
  }
  return { points, seconds, metres, estimated: { ...matrix.estimated } };
}

export interface Verdict {
  fits: boolean;
  /** Where the solver put it, when it planned it on that day. */
  arriveMin: number | null;
  departMin: number | null;
  landedStage: DayStage | null;
  legInMin: number | null;
  legOutMin: number | null;
  legInMode: TravelMode | null;
  legOutMode: TravelMode | null;
  /** Wishes it would push out of the plan (titles). */
  pushesOut: string[];
  /** Wishes the re-solve would move to another day to make room (said, not disqualifying). */
  moves: Array<{ title: string; from: string; to: string }>;
  reason: string | null;
}

type SolverInput = Parameters<typeof solveTrip>[0];

/**
 * Dry-run an idea: add it to a copy of the trip pinned to the gap's day, solve
 * without saving, and compare with the same trip solved without it. It fits
 * when the solver plans it that day IN THE INTENDED STAGE and nothing else is
 * dropped; otherwise the verdict says why, naming what it would push out.
 */
export function verifyIdea(input: SolverInput, wish: Wish, gap: Gap, baseline: SolvedPlan = solveTrip(input)): Verdict {
  const locations = new Map<string, LatLng>();
  for (const s of input.stays) locations.set(`stay:${s.id}`, s.location);
  for (const w of input.wishes) if (w.place) locations.set(w.id, w.place.location);
  for (const t of input.transport ?? []) {
    if (t.from.location) locations.set(`transport:${t.id}:from`, t.from.location);
    if (t.to.location) locations.set(`transport:${t.id}:to`, t.to.location);
  }
  const matrix = wish.place ? withPoint(input.matrix, wish.id, wish.place.location, locations) : input.matrix;
  const plan = solveTrip({ ...input, wishes: [...input.wishes, wish], matrix });
  const titles = new Map(input.wishes.map((w) => [w.id, w.title]));
  const was = new Set(baseline.dropped.map((d) => d.wishId));
  const pushesOut = plan.dropped.filter((d) => d.wishId !== wish.id && !was.has(d.wishId)).map((d) => titles.get(d.wishId) ?? d.wishId);
  const dayOf = (p: SolvedPlan) => new Map(p.days.flatMap((d) => d.stops.filter((x) => x.wishId).map((x) => [x.wishId as string, d.date] as const)));
  const before = dayOf(baseline);
  const moves = [...dayOf(plan)]
    .filter(([id, date]) => id !== wish.id && before.has(id) && before.get(id) !== date)
    .map(([id, date]) => ({ title: titles.get(id) ?? id, from: before.get(id)!, to: date }));
  const day = plan.days.find((d) => d.date === gap.date);
  const at = day ? day.stops.findIndex((s) => s.wishId === wish.id) : -1;
  const empty: Verdict = { fits: false, arriveMin: null, departMin: null, landedStage: null, legInMin: null, legOutMin: null, legInMode: null, legOutMode: null, pushesOut, moves, reason: null };
  if (!day || at < 0) {
    const why = plan.dropped.find((d) => d.wishId === wish.id)?.reason;
    return { ...empty, reason: why ? `The planner could not fit it: ${why}` : `It would not land on ${dayLabel(gap.date)}.` };
  }
  const stop = stagedStops(day)[at];
  const legIn = at > 0 ? day.legs[at - 1] : null;
  const legOut = day.legs[at] ?? null;
  const verdict: Verdict = {
    fits: false,
    arriveMin: stop.arriveMin,
    departMin: stop.departMin,
    landedStage: stop.stage ?? null,
    legInMin: legIn ? Math.round(legIn.durationSec / 60) : null,
    legOutMin: legOut ? Math.round(legOut.durationSec / 60) : null,
    legInMode: legIn?.mode ?? null,
    legOutMode: legOut?.mode ?? null,
    pushesOut,
    moves,
    reason: null,
  };
  if (stop.stage && stop.stage !== gap.stage) return { ...verdict, reason: `It would land in the ${DAY_STAGE_LABEL[stop.stage].toLowerCase()} instead.` };
  if (pushesOut.length) return { ...verdict, reason: `It would push out ${pushesOut.join(', ')}.` };
  return { ...verdict, fits: true };
}
