// src/lib/trips/family.ts
//
// v5: trips open to the family (the pure half). Who may do what with a trip
// (`tripAccess`), how full each day is (`dayFullness`), the ways of doing
// every leg (`legAlternatives`), and what the phone may be told about the
// travellers — names, relations, ages, ids; never a memory. PURE.

import { modeSeconds, estimateLeg, solverRules, mealOfStop } from '$lib/trips/solver';
import { activeMealMin } from '$lib/trips/solver/rules';
import { FULL_DAY_SHARE, LIGHT_DAY_SHARE } from '$lib/trips/solver/items';
import { DAY_STAGES, type DayFullness, type DayLoad, type DayStage, type LegAlternative, type Pace, type PartOfDay, type PlannedDay, type SolvedPlan, type TravelMatrix, type TravelMode, type TravellerProfile, type TripAccess, type TripSuggestion, type WishDraft } from './model';

export interface FamilyCallerLike {
  email: string;
  parent: boolean;
}

/** Creator edits freely; a parent approves (and may edit); anyone else in the family suggests. */
export function tripAccess(creatorEmail: string, caller: FamilyCallerLike): TripAccess {
  const creator = creatorEmail.trim().toLowerCase() === caller.email.trim().toLowerCase();
  if (creator) return { canEdit: true, canApprove: caller.parent, canSuggest: true, canDelete: true, role: 'creator' };
  if (caller.parent) return { canEdit: true, canApprove: true, canSuggest: true, canDelete: false, role: 'parent' };
  return { canEdit: false, canApprove: false, canSuggest: true, canDelete: false, role: 'member' };
}

/** Bands: empty <10%, light <50%, balanced <85%, full ≤100%, overfull >100%. */
export function fullnessBand(pct: number): DayFullness['band'] {
  if (pct < 10) return 'empty';
  if (pct < 50) return 'light';
  if (pct < 85) return 'balanced';
  if (pct <= 100) return 'full';
  return 'overfull';
}

/**
 * How full a day is: active minutes (time at places that are not meals or
 * free time, plus the travel to them) against the day's capacity under the
 * pace and its load — the same capacity rule the solver plans with.
 */
export function dayFullness(day: PlannedDay, pace: Pace, load: DayLoad = 'normal', replaces: ReadonlyMap<string, 'breakfast' | 'lunch' | 'dinner'> = new Map()): DayFullness {
  const rules = solverRules(pace);
  const normal = rules.activeEndMin - rules.dayStartMin - activeMealMin(rules);
  const capacityMin = Math.max(30, load === 'light' ? Math.round(normal * LIGHT_DAY_SHARE) : load === 'full' ? Math.round(normal * FULL_DAY_SHARE) : normal);
  let activeMin = 0;
  day.stops.forEach((s, i) => {
    if (s.kind !== 'wish' || mealOfStop(s, replaces)) return;
    activeMin += Math.max(0, s.departMin - s.arriveMin - Math.round(s.waitSec / 60));
    const legIn = i > 0 ? day.legs[i - 1] : null;
    if (legIn) activeMin += Math.round(legIn.durationSec / 60);
  });
  const pct = Math.round((activeMin / capacityMin) * 100);
  return { activeMin, capacityMin, pct, band: fullnessBand(pct) };
}

export function planFullness(
  plan: SolvedPlan,
  pace: Pace,
  loads: Partial<Record<string, DayLoad>> = {},
  replaces: ReadonlyMap<string, 'breakfast' | 'lunch' | 'dinner'> = new Map(),
): Record<string, DayFullness> {
  return Object.fromEntries(plan.days.map((d) => [d.date, dayFullness(d, pace, loads[d.date] ?? 'normal', replaces)]));
}

/** The matrix point a stop stands at, when it has one. */
export function stopPoint(stopId: string, day: PlannedDay): string | null {
  const stop = day.stops.find((s) => s.id === stopId);
  if (!stop) return null;
  if (stop.kind === 'wish' && stop.wishId) return stop.wishId;
  if (stop.kind === 'stay' && day.stayId) return `stay:${day.stayId}`;
  const t = stop.kind === 'transport' ? /^transport:(.+):(arrive|depart)$/.exec(stop.id) : null;
  if (t) return `transport:${t[1]}:${t[2] === 'arrive' ? 'to' : 'from'}`;
  return null;
}

const ALT_MODES: TravelMode[] = ['walk', 'transit', 'taxi'];

/**
 * Walk, public transport and taxi for one leg: from the trip matrix when it
 * has both ends (taxi = drive + pickup, the solver's `modeSeconds`), else a
 * distance estimate between the stops' positions, marked `estimated`.
 */
export function legAlternatives(fromId: string, toId: string, day: PlannedDay, matrix: TravelMatrix | null): LegAlternative[] {
  const a = stopPoint(fromId, day);
  const b = stopPoint(toId, day);
  const i = a && matrix ? matrix.points.indexOf(a) : -1;
  const j = b && matrix ? matrix.points.indexOf(b) : -1;
  const from = day.stops.find((s) => s.id === fromId)?.location ?? null;
  const to = day.stops.find((s) => s.id === toId)?.location ?? null;
  const out: LegAlternative[] = [];
  for (const mode of ALT_MODES) {
    const routed = matrix && i >= 0 && j >= 0 ? modeSeconds(matrix, mode, i, j) : null;
    if (routed) {
      out.push({ mode, durationSec: Math.round(routed.seconds), estimated: routed.estimated });
    } else if (from && to) {
      const e = estimateLeg(from, to, mode === 'taxi' ? 'drive' : mode);
      out.push({ mode, durationSec: e.seconds + (mode === 'taxi' ? 8 * 60 : 0), estimated: true });
    }
  }
  // Same place (a zero walk): no pickup wait for a taxi you would not take.
  if (out[0]?.mode === 'walk' && out[0].durationSec === 0) return out.map((x) => ({ ...x, durationSec: 0 }));
  return out;
}

/** Every leg of the plan with its alternatives (for the phone's mode picker). */
export function withAlternatives(plan: SolvedPlan, matrix: TravelMatrix | null): SolvedPlan {
  return {
    ...plan,
    days: plan.days.map((day) => ({ ...day, legs: day.legs.map((leg) => ({ ...leg, alternatives: legAlternatives(leg.fromStopId, leg.toStopId, day, matrix) })) })),
  };
}

/** The travellers for the phone: who, relation, age, roster id. Never a note, preference or source. */
export function wireTravellers(profile: TravellerProfile | null): Array<{ name: string; relation: string | null; age: number | null; personId: string | null }> {
  return (profile?.travellers ?? []).map((t) => ({ name: t.name, relation: t.relation, age: t.age ?? null, personId: t.personId ?? null }));
}

/** The wish a suggestion becomes when approved: pinned to its day, in its stage (or as the meal). */
export function suggestionWish(s: Pick<TripSuggestion, 'date' | 'stage' | 'wish'>): WishDraft {
  const part: Record<DayStage, PartOfDay> = { morning: 'morning', lunch: 'any', afternoon: 'afternoon', evening: 'evening' };
  const meal = s.wish.replacesMeal ?? (s.stage === 'lunch' ? 'lunch' : null);
  return { ...s.wish, fixedDate: s.date, partOfDay: meal ? 'any' : part[s.stage], replacesMeal: meal, priority: s.wish.priority ?? 'nice' };
}

export const isStage = (v: unknown): v is DayStage => (DAY_STAGES as readonly unknown[]).includes(v);

