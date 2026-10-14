// src/lib/trips/solver/trip.ts
//
// replanTrip: up to three whole-trip options from "now" when the phone sees
// the person going off the plan (spec v2, "Off the plan"). Server-side; the
// phone only does `pullForwardDay` offline (see below).
//
//   carry-on      today = replanDay's best option, later days unchanged
//   resolve-rest  today from now/position + every later day, re-solved with
//                 done/skipped/visited wishes removed; musts that no longer
//                 fit today move to a later day; a missed booked slot loses
//                 its booking and moves like any must
//   pull-forward  a later-day wish within PULL_FORWARD_WALK_SEC of where the
//                 person is, done now; the day it left is re-fitted; nices
//                 squeezed out of today move to a later day if one has room
//                 (out-of-order: the later stop of today they reached, now)
//   stay-here     unplanned stop: stay until max(now + 30, since + 60) min,
//                 then the rest of today, nices dropped or moved to fit
//
// Locked/booked stops never move: every option holds them at their planned
// arrive/wait/depart (or drops a missed slot, per replanDay's rule). Options
// are ranked by a plan score (travel + wait + overrun + warnings + a penalty
// per dropped or moved wish); identical options are offered once.

import type {
  Booking,
  LatLng,
  LocalDate,
  Observation,
  PlannedDay,
  PlannedLeg,
  PlannedStop,
  TripReplanOption,
  Wish,
} from '../model';
import { cmp, dayLabel, fmtMin } from './calendar';
import { estimateLeg } from './estimate';
import { windowsOn } from './hours';
import { dayFrame, pinnedDate, wishItem, type DayFrame, type Item } from './items';
import { freshSpec, holdItem, solveFrames, solveTrip, type FrameSpec } from './plan';
import { MISSED_SLOT_GRACE_MIN, replanDay, settle, situation, type Situation } from './replan';
import {
  COST,
  byLowestValue,
  droppable,
  fitDay,
  toPlannedDay,
  withMeals,
  type FitResult,
  type SimStart,
  type Simulation,
} from './timing';
import { legFromPosition } from './matrix';
import type { ReplanInput } from './types';

/** A later-day wish this close on foot (seconds) can be pulled into now. */
export const PULL_FORWARD_WALK_SEC = 15 * 60;
/** Stay-here: at least this long in total at the unplanned stop, and this much more from now. */
export const STAY_HERE_TOTAL_MIN = 60;
export const STAY_HERE_MORE_MIN = 30;
const MOVE_PENALTY = 30;
/**
 * What the phone saw makes some options likelier to be what the person
 * wants: a bonus (score minutes) for those, so they lead when close.
 */
const PREFERENCE: Record<string, Partial<Record<TripReplanOption['kind'], number>>> = {
  'unplanned-stop': { 'pull-forward': 120, 'stay-here': 60 },
  'out-of-order': { 'pull-forward': 120 },
  'off-route': { 'pull-forward': 60 },
  behind: { 'resolve-rest': 30 },
};
const WARNING_PENALTY = 20;

export type TripReplanInput = ReplanInput & {
  observation: Observation | null;
  /**
   * The current plan's days (any dates; today's is `day`). Optional: when
   * absent the later days are taken from `solveTrip` on the same input.
   */
  plannedDays?: PlannedDay[];
};

const KIND_RANK: Record<TripReplanOption['kind'], number> = {
  'pull-forward': 0,
  'stay-here': 1,
  'carry-on': 2,
  'resolve-rest': 3,
};

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function wishIdsOf(day: PlannedDay): string[] {
  return day.stops.filter((s) => s.kind === 'wish' && s.wishId).map((s) => s.wishId as string);
}

function heldOf(day: PlannedDay | undefined): Map<string, PlannedStop> {
  const out = new Map<string, PlannedStop>();
  for (const s of day?.stops ?? []) if (s.locked && s.wishId) out.set(s.wishId, s);
  return out;
}

/** Plain score of a planned day, comparable across options. */
function dayScore(day: PlannedDay, dayEndMin: number): number {
  const travel = day.legs.reduce((t, l) => t + Math.ceil(l.durationSec / 60), 0);
  const wait = day.stops.reduce((t, s) => t + s.waitSec / 60, 0);
  const end = day.stops.length ? day.stops[day.stops.length - 1].arriveMin : 0;
  const warnings = day.warnings.length + day.stops.reduce((t, s) => t + s.warnings.length, 0);
  return travel + wait + Math.max(0, end - dayEndMin) * COST.overrunPerMin + warnings * WARNING_PENALTY;
}

/**
 * Pull-forward candidates the phone can compute offline: later-day wishes
 * (not locked or pinned, open today) within PULL_FORWARD_WALK_SEC on foot of
 * `position`, nearest first.
 */
export function pullForwardCandidates(
  input: Pick<ReplanInput, 'wishes' | 'bookings'>,
  today: LocalDate,
  laterDays: PlannedDay[],
  position: LatLng,
): Array<{ wishId: string; from: LocalDate; walkSec: number }> {
  const byId = new Map(input.wishes.map((w) => [w.id, w]));
  const out: Array<{ wishId: string; from: LocalDate; walkSec: number; sortHint: number }> = [];
  for (const day of laterDays) {
    if (day.date <= today) continue;
    for (const s of day.stops) {
      const wish = s.wishId ? byId.get(s.wishId) : undefined;
      if (!wish || !wish.place || s.locked || wish.locked || pinnedDate(wish, input.bookings)) continue;
      const w = windowsOn(wish.facts, today);
      if (w !== null && w.length === 0) continue;
      const walkSec = estimateLeg(position, wish.place.location, 'walk').seconds;
      if (walkSec > PULL_FORWARD_WALK_SEC) continue;
      out.push({ wishId: wish.id, from: day.date, walkSec, sortHint: wish.sortHint });
    }
  }
  return out
    .sort((a, b) => a.walkSec - b.walkSec || a.sortHint - b.sortHint || cmp(a.wishId, b.wishId))
    .map(({ wishId, from, walkSec }) => ({ wishId, from, walkSec }));
}

/**
 * Today with `wishIds` done first, from now: the same pieces as replanDay
 * (missed-slot rule, held locked stops, settle). What the phone ports for an
 * offline pull-forward; the day the wish left is re-fitted by the server.
 */
export function pullForwardDay(
  input: ReplanInput,
  wishIds: string[],
  /** Today's wishes to leave out (moved to a later day to make room). */
  without: string[] = [],
): { day: PlannedDay; dropped: string[]; gone: Item[]; sim: Simulation; sit: Situation } {
  const sit = situation(input);
  const byId = new Map(input.wishes.map((w) => [w.id, w]));
  const already = sit.items.filter((i) => wishIds.includes(i.wishId ?? ''));
  const pulled = wishIds
    .filter((id) => !already.some((i) => i.wishId === id))
    .map((id) => byId.get(id))
    .filter((w): w is Wish => w !== undefined)
    .map((w) => wishItem(w, sit.frame.date, input.bookings, sit.ctx.rules));
  const rest = sit.items.filter(
    (i) => !already.includes(i) && i.kind !== 'meal' && !without.includes(i.wishId ?? ''),
  );
  const meals = sit.items.filter((i) => i.kind === 'meal');
  // The pulled stops go first; meals are re-slotted at their cheapest gap.
  const placed = withMeals(sit.ctx, sit.frame, sit.start, [...already, ...pulled, ...rest], meals).seq;
  const { sim, gone } = settle(sit.ctx, sit.frame, sit.start, placed);
  const day = toPlannedDay(sit.frame, sim);
  day.warnings = [...sit.missedWarnings, ...day.warnings];
  return { day, dropped: [...sit.missedIds, ...gone.map((g) => g.wishId ?? g.id)], gone, sim, sit };
}

export function replanTrip(input: TripReplanInput): TripReplanOption[] {
  const today = input.day.date;
  const sit = situation(input);
  const { ctx } = sit;
  const byId = new Map(input.wishes.map((w) => [w.id, w]));

  // The current plan around today.
  const planDays = input.plannedDays ?? solveTrip(input).days;
  const laterOld = planDays.filter((d) => d.date > today).sort((a, b) => cmp(a.date, b.date));
  const earlier = new Set(planDays.filter((d) => d.date < today).flatMap(wishIdsOf));
  const oldDate = new Map<string, LocalDate>();
  for (const d of [input.day, ...laterOld]) for (const id of wishIdsOf(d)) oldDate.set(id, d.date);
  const laterFrame = (date: LocalDate): DayFrame =>
    dayFrame(
      ctx.rules,
      ctx.dayLoads,
      date,
      input.stays.find((s) => s.id === laterOld.find((d) => d.date === date)?.stayId) ?? null,
    );
  const itemsOfDay = (day: PlannedDay, held: Map<string, PlannedStop>): Item[] =>
    wishIdsOf(day)
      .map((id) => byId.get(id))
      .filter((w): w is Wish => w !== undefined)
      .map((w) => holdItem(wishItem(w, day.date, input.bookings, ctx.rules), held.get(w.id)));

  // Where they are: what the phone saw, else its position. Never guessed
  // from the plan — pull-forward and stay-here need a real place.
  const position: LatLng | null = input.observation?.place?.location ?? input.position ?? null;

  const options: Array<TripReplanOption & { score: number }> = [];
  const add = (o: TripReplanOption) => {
    let score = 0;
    for (const d of o.days) score += dayScore(d, ctx.rules.dayEndMin);
    for (const id of o.dropped)
      score += byId.get(id)?.priority === 'must' ? COST.mustWarning : COST.droppedNice;
    score += o.moved.length * MOVE_PENALTY;
    score -= PREFERENCE[input.observation?.kind ?? 'none']?.[o.kind] ?? 0;
    options.push({ ...o, score });
  };

  /** Move squeezed-out nices onto later days that still fit them; returns the changed days. */
  const rehome = (
    gone: Item[],
    base: Map<LocalDate, { items: Item[]; day: PlannedDay; fit: FitResult | null }>,
  ) => {
    const moved: TripReplanOption['moved'] = [];
    const stillGone: string[] = [];
    for (const g of [...gone].sort((a, b) => a.sortHint - b.sortHint || cmp(a.id, b.id))) {
      const wish = g.wishId ? byId.get(g.wishId) : undefined;
      let placed = false;
      if (wish) {
        for (const [date, entry] of [...base.entries()].sort((a, b) => cmp(a[0], b[0]))) {
          const w = windowsOn(wish.facts, date);
          if (w !== null && w.length === 0) continue;
          const frame = laterFrame(date);
          if (frame.load === 'light') continue; // never pile onto a light day
          const before = entry.fit ?? fitDay(ctx, frame, entry.items);
          const list = [...entry.items, wishItem(wish, date, input.bookings, ctx.rules)];
          const trial = fitDay(ctx, frame, list);
          if (
            trial.dropped.length === 0 &&
            trial.sim.overrunMin === 0 &&
            trial.sim.issues.length <= before.sim.issues.length
          ) {
            base.set(date, { items: list, day: trial.day, fit: trial });
            moved.push({ wishId: wish.id, from: today, to: date });
            placed = true;
            break;
          }
        }
      }
      if (!placed) stillGone.push(g.wishId ?? g.id);
    }
    return { moved, stillGone };
  };
  const laterBase = () =>
    new Map(
      laterOld.map((d) => [
        d.date,
        { items: itemsOfDay(d, heldOf(d)), day: d, fit: null as FitResult | null },
      ]),
    );

  // 1. Carry on: today's best day option, later days as they are.
  const best = replanDay(input)[0];
  if (best) {
    add({
      id: 'carry-on',
      kind: 'carry-on',
      label: `Carry on with today: ${best.label.charAt(0).toLowerCase()}${best.label.slice(1)}`,
      days: [best.day, ...laterOld],
      dropped: best.dropped,
      moved: [],
      explanation: `Keeps the other days as they are and re-times the rest of today from now${
        best.dropped.length
          ? `, without ${joinNames(best.dropped.map((id) => byId.get(id)?.title ?? id))}`
          : ''
      }.`,
    });
  }

  // 2. Resolve the rest of the trip from now.
  {
    const gone = new Set<string>([
      ...earlier,
      ...input.doneStopIds,
      ...sit.prefix.filter((s) => s.wishId).map((s) => s.wishId as string),
    ]);
    const pool = input.wishes.filter((w) => !gone.has(w.id));
    const missedWish = new Set(sit.missedIds);
    const bookings: Booking[] = input.bookings.filter((b) => !(b.wishId && missedWish.has(b.wishId)));
    const doneMeals = new Set([
      ...sit.prefix.filter((s) => s.kind === 'meal').map((s) => s.id),
      ...input.doneStopIds.filter((id) => id.startsWith('meal:')),
    ]);
    for (const kind of ['lunch', 'dinner'] as const) {
      const w = kind === 'lunch' ? ctx.rules.lunch : ctx.rules.dinner;
      if (w && w.toMin - Math.round(w.durationSec / 60) < sit.leave) doneMeals.add(`meal:${today}:${kind}`);
    }
    const todaySpec: FrameSpec = {
      frame: { ...sit.frame, dayStartMin: sit.leave },
      start: sit.start,
      skipMeals: doneMeals,
      held: new Map(
        sit.items
          .filter((i) => i.locked && i.wishId)
          .map((i) => [i.wishId as string, sit.pending.find((p) => p.id === i.id) as PlannedStop]),
      ),
    };
    const specs = [todaySpec, ...laterOld.map((d) => freshSpec(laterFrame(d.date), heldOf(d)))];
    const solved = solveFrames(ctx, specs, pool, bookings, { shedMustsFromFirst: true });
    const days = solved.days.map((d, i) =>
      i === 0 ? { ...d, warnings: [...sit.missedWarnings, ...d.warnings] } : d,
    );
    const newDate = new Map<string, LocalDate>();
    for (const d of days) for (const id of wishIdsOf(d)) newDate.set(id, d.date);
    const moved: TripReplanOption['moved'] = [];
    for (const [id, to] of newDate)
      if (oldDate.get(id) !== to) moved.push({ wishId: id, from: oldDate.get(id) ?? null, to });
    const dropped = [...oldDate.keys()].filter((id) => !gone.has(id) && !newDate.has(id));
    const sentences = ['Re-plans the rest of today from where you are, and the days after.'];
    if (sit.missed.length) {
      sentences.push(
        `You missed the ${joinNames(sit.missed.map((m) => `${fmtMin(m.fixedStartMin as number)} ${m.title}`))} slot, so it needs a new booking.`,
      );
    }
    for (const m of moved)
      sentences.push(`${byId.get(m.wishId)?.title ?? m.wishId} moves to ${dayLabel(m.to)}.`);
    if (dropped.length) sentences.push(`Drops ${joinNames(dropped.map((id) => byId.get(id)?.title ?? id))}.`);
    add({
      id: 'resolve-rest',
      kind: 'resolve-rest',
      label: moved.length ? 'Re-plan the rest of the trip' : 'Re-plan the rest of today',
      days,
      dropped,
      moved: moved.sort((a, b) => cmp(a.wishId, b.wishId)),
      explanation: sentences.join(' '),
    });
  }

  // 3. Pull forward.
  const obs = input.observation;
  if (obs?.kind === 'out-of-order' && obs.stopId && sit.items.some((i) => i.id === obs.stopId && !i.locked)) {
    const target = sit.items.find((i) => i.id === obs.stopId) as Item;
    const { day, dropped, gone } = pullForwardDay(
      { ...input, position: obs.place?.location ?? input.position },
      [target.wishId ?? target.id],
    );
    const base = laterBase();
    const { moved, stillGone } = rehome(gone, base);
    add({
      id: `pull-forward:${target.id}`,
      kind: 'pull-forward',
      label: `Do ${target.title} now, then carry on`,
      days: [day, ...[...base.values()].map((e) => e.day)],
      dropped: [...dropped.filter((id) => !gone.some((g) => (g.wishId ?? g.id) === id)), ...stillGone],
      moved,
      explanation: `You're already at ${target.title}, so do it now and carry on with the rest of today after it.${
        moved.length
          ? ` ${joinNames(moved.map((m) => `${byId.get(m.wishId)?.title ?? m.wishId} moves to ${dayLabel(m.to)}`))}.`
          : ''
      }`,
    });
  } else if (
    position &&
    obs &&
    (obs.kind === 'unplanned-stop' || obs.kind === 'off-route' || obs.kind === 'idle')
  ) {
    const candidate = pullForwardCandidates(input, today, laterOld, position)[0];
    if (candidate) {
      const wish = byId.get(candidate.wishId) as Wish;
      const here = { ...input, position: sit.at < 0 ? position : input.position };
      let pulledDay = pullForwardDay(here, [wish.id]);
      const pulledKept = !pulledDay.gone.some((g) => g.wishId === wish.id);
      const base = laterBase();
      const left = pulledKept ? base.get(candidate.from) : undefined;
      if (left) {
        const items = left.items.filter((i) => i.wishId !== wish.id);
        const fit = fitDay(ctx, laterFrame(candidate.from), items);
        base.set(candidate.from, { items, day: fit.day, fit });
      }
      // Still running late today: move the lowest-value nices to a later day
      // with room (often the day the pulled wish left) rather than overrun.
      const madeRoom: TripReplanOption['moved'] = [];
      const without: string[] = [];
      for (let guard = 0; guard < 5 && pulledKept && pulledDay.sim.overrunMin > 0; guard++) {
        const sim = pulledDay.sim;
        const nice = sit.items
          .filter(
            (i) => droppable(i) && !without.includes(i.wishId ?? '') && sim.stops.some((x) => x.id === i.id),
          )
          .sort(byLowestValue)[0];
        if (!nice) break;
        const trialBase = new Map(base);
        const r = rehome([nice], trialBase);
        if (!r.moved.length) break;
        without.push(nice.wishId as string);
        madeRoom.push(...r.moved);
        for (const [k, v] of trialBase) base.set(k, v);
        pulledDay = pullForwardDay(here, [wish.id], without);
      }
      const { day, dropped } = pulledDay;
      const gone = pulledDay.gone.filter((g) => g.wishId !== wish.id);
      const rehomed = rehome(gone, base);
      const moved = [...madeRoom, ...rehomed.moved];
      const stillGone = rehomed.stillGone;
      const walkMin = Math.max(1, Math.round(candidate.walkSec / 60));
      if (pulledKept)
        add({
          id: `pull-forward:${wish.id}`,
          kind: 'pull-forward',
          label: `Do ${wish.title} now (planned for ${dayLabel(candidate.from)})`,
          days: [day, ...[...base.values()].map((e) => e.day)],
          dropped: [
            ...dropped.filter((id) => !gone.some((g) => (g.wishId ?? g.id) === id) && id !== wish.id),
            ...stillGone,
          ],
          moved: [{ wishId: wish.id, from: candidate.from, to: today }, ...moved],
          explanation: `${wish.title} is about ${walkMin} min on foot from you, so do it now instead of on ${dayLabel(
            candidate.from,
          )}; that day is re-planned without it.${
            moved.length
              ? ` To make room, ${joinNames(moved.map((m) => `${byId.get(m.wishId)?.title ?? m.wishId} moves to ${dayLabel(m.to)}`))}.`
              : ''
          }`,
        });
    }
  }

  // 4. Stay here (an unplanned stop).
  if (obs?.kind === 'unplanned-stop' && position) {
    const dwellEnd = Math.max(input.nowMin + STAY_HERE_MORE_MIN, obs.sinceMin + STAY_HERE_TOTAL_MIN);
    const name = obs.place?.name ?? 'where you are';
    const last = sit.prefix[sit.prefix.length - 1];
    const here: PlannedStop = {
      id: `here:${today}:${obs.sinceMin}`,
      kind: 'wish',
      wishId: null,
      title: obs.place?.name ?? 'Where you are',
      location: { ...position },
      arriveMin: Math.max(obs.sinceMin, last ? last.departMin : obs.sinceMin),
      departMin: dwellEnd,
      waitSec: 0,
      locked: false,
      bookingId: null,
      warnings: [],
    };
    const legs: PlannedLeg[] = [...sit.start.prefixLegs];
    if (last) {
      const e = last.location ? estimateLeg(last.location, position, 'walk') : { seconds: 0, metres: 0 };
      legs.push({
        fromStopId: last.id,
        toStopId: here.id,
        mode: 'walk',
        durationSec: e.seconds,
        distanceM: e.metres,
        estimated: true,
        line: null,
      });
    }
    const start: SimStart = {
      prefixStops: [...sit.prefix, here],
      prefixLegs: legs,
      fromPoint: null,
      fromStopId: here.id,
      departMin: dwellEnd,
      fromPosition: position,
    };
    // Missed-slot rule again, from the later leave.
    const reach = (i: Item) =>
      dwellEnd + (i.point ? Math.ceil(legFromPosition(ctx, position, i.point).durationSec / 60) : 0);
    const missedNow = sit.items.filter(
      (i) => i.locked && i.fixedStartMin !== null && reach(i) > i.fixedStartMin + MISSED_SLOT_GRACE_MIN,
    );
    const items = sit.items.filter((i) => !missedNow.includes(i));
    const { sim, gone } = settle(ctx, sit.frame, start, items);
    const day = toPlannedDay(sit.frame, sim);
    const missedAll = [...sit.missed, ...missedNow];
    day.warnings = [
      ...missedAll.map((m) => `Missed your ${fmtMin(m.fixedStartMin as number)} ${m.title} slot`),
      ...day.warnings,
    ];
    const base = laterBase();
    const { moved, stillGone } = rehome(gone, base);
    const droppedNames = stillGone.map((id) => byId.get(id)?.title ?? id);
    add({
      id: 'stay-here',
      kind: 'stay-here',
      label: `Stay at ${name} until ${fmtMin(dwellEnd)}`,
      days: [day, ...[...base.values()].map((e) => e.day)],
      dropped: [...missedAll.map((m) => m.wishId ?? m.id), ...stillGone],
      moved,
      explanation: `Stay at ${name} until ${fmtMin(dwellEnd)} and push the rest of today back${
        droppedNames.length ? `, dropping ${joinNames(droppedNames)}` : ''
      }${moved.length ? `; ${joinNames(moved.map((m) => byId.get(m.wishId)?.title ?? m.wishId))} moves to ${joinNames([...new Set(moved.map((m) => dayLabel(m.to)))])}` : ''}.`,
    });
  }

  options.sort((a, b) => a.score - b.score || KIND_RANK[a.kind] - KIND_RANK[b.kind] || cmp(a.id, b.id));
  const seen = new Set<string>();
  const out: TripReplanOption[] = [];
  for (const o of options) {
    const key = o.days
      .map((d) => d.stops.map((s) => `${s.id}@${s.arriveMin}-${s.departMin}`).join('|'))
      .join('/');
    if (seen.has(key)) continue;
    seen.add(key);
    const { score: _score, ...option } = o;
    out.push(option);
    if (out.length === 3) break;
  }
  return out;
}
