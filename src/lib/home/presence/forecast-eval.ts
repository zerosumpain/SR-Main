// src/lib/home/presence/forecast-eval.ts
//
// How good the forecast is, measured. Replays a stretch of real trips day by
// day: at each checkpoint the forecast is rebuilt from ONLY the trips that had
// finished by then, asked what it expects, and scored against what the family
// then actually did. PURE — the nightly scorecard and the by-hand backtest run
// the same code, so a change to `forecast.ts` is judged by the numbers here
// before it ships.
//
// Where someone is at a checkpoint is read off the trips themselves (the end
// of their last trip, or the trip they are on), not off the raw trail. That
// is a simplification — a wander that never became a trip is invisible — and
// it is the same for every version of the forecast being compared.

import { learnedTravel, localClock, nextMoves, routinesOf, watchItems, type ForecastCorrection } from './forecast';
import { percentile, predictArrival, routesOf, type InsightPerson, type InsightPlace, type LiveState, type Trip } from './insights';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Checkpoints run from 06:00 to 21:30 local, every half hour. */
export const CHECKPOINT_STEP_MINS = 30;
const FIRST_CHECKPOINT_MIN = 6 * 60;
const LAST_CHECKPOINT_MIN = 21 * 60 + 30;
/** A next move is judged on what it said at least this long before it was due. */
export const NEXT_LEAD_MINS = 30;
/** A next move is right when they went there and left within this of the time it gave. */
export const NEXT_TOLERANCE_MINS = 45;
/** Someone whose last trip ended longer ago than this is somewhere unknown. */
const PLACE_STALE_MS = 18 * HOUR;
/** Live arrival is asked at these fractions of each trip's own time. */
export const ETA_FRACTIONS = [0.25, 0.5, 0.75] as const;

export interface PersonScore {
  subject: string;
  predictions: number;
  hits: number;
  eligible: number;
  foreseen: number;
}

export interface Scorecard {
  generatedAt: string;
  /** Local dates scored, inclusive. */
  from: string;
  to: string;
  days: number;
  learnDays: number;
  /** "Usually leaves for X at T": how often it came true, and how many journeys it saw coming. */
  next: {
    predictions: number;
    hits: number;
    precision: number | null;
    /** Trips that left a known place after a stay of at least the lead time. */
    eligible: number;
    foreseen: number;
    recall: number | null;
    byPerson: PersonScore[];
  };
  /** Learned journey times against the trips that followed. */
  duration: {
    trips: number;
    estimated: number;
    /** Mean and median of |actual − estimate| minutes. */
    mae: number | null;
    medianError: number | null;
    /** Share of trips inside the p10–p90 band; 0.8 is honest. */
    band: number | null;
    /** Share of trips at or under p80 — what a leave-by time is set against; 0.8 is honest. */
    p80: number | null;
  };
  /** Live arrival estimates part-way through each trip. */
  eta: {
    checks: number;
    offered: number;
    rightPlace: number;
    wrongPlace: number;
    mae: number | null;
    /** Share of right-place estimates whose window held the real arrival. */
    window: number | null;
  };
  /** "Hasn't left": whether they then went late, or not at all. */
  overdue: { fired: number; late: number; skipped: number };
}

export interface EvalInput {
  trips: Trip[];
  places: InsightPlace[];
  people: InsightPerson[];
  homeIds: Set<string>;
  /** Local dates to score, inclusive (YYYY-MM-DD). */
  from: string;
  to: string;
  /** How much history the forecast learns from at each checkpoint; the page uses 28. */
  learnDays?: number;
  corrections?: readonly ForecastCorrection[];
}

const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : null);
const mean = (v: number[]) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null);
const median = (v: number[]) => (v.length ? Math.round(percentile(v, 0.5) * 10) / 10 : null);

/** The instants of a local date's checkpoints. Walks UTC half-hours, so a clock change costs nothing. */
export function checkpointsOf(date: string): number[] {
  const out: number[] = [];
  const noon = Date.parse(`${date}T12:00:00Z`);
  for (let t = noon - 14 * HOUR; t <= noon + 14 * HOUR; t += CHECKPOINT_STEP_MINS * MINUTE) {
    const c = localClock(t);
    if (c.date === date && c.minute >= FIRST_CHECKPOINT_MIN && c.minute <= LAST_CHECKPOINT_MIN && c.minute % CHECKPOINT_STEP_MINS === 0) out.push(t);
  }
  return out;
}

/** Local dates from `from` to `to`, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Where everyone is at `now`, read off the trips. PURE. */
export function liveFromTrips(trips: Trip[], people: InsightPerson[], now: number): LiveState[] {
  return people.map((p) => {
    const mine = trips.filter((t) => t.subject === p.subject && t.start <= now);
    const on = mine.find((t) => t.end > now);
    if (on) return { subject: p.subject, placeId: null, since: null, lastSeen: new Date(now).toISOString(), moving: { fromId: on.from, departedAt: new Date(on.start).toISOString() } };
    const last = mine.reduce<Trip | null>((a, t) => (!a || t.end > a.end ? t : a), null);
    if (!last || now - last.end > PLACE_STALE_MS) return { subject: p.subject, placeId: null, since: null, lastSeen: null, moving: null };
    return { subject: p.subject, placeId: last.to, since: new Date(last.end).toISOString(), lastSeen: new Date(now).toISOString(), moving: null };
  });
}

/** Score the forecast over a stretch of real trips. PURE. */
export function scoreForecast(input: EvalInput, generatedAt = new Date()): Scorecard {
  const { places, people, homeIds } = input;
  const learnDays = input.learnDays ?? 28;
  const corrections = input.corrections ?? [];
  const trips = [...input.trips].sort((a, b) => a.start - b.start);
  const names = new Map(people.map((p) => [p.subject, p.displayName]));
  const dates = datesBetween(input.from, input.to);

  const known = (now: number) => trips.filter((t) => t.end <= now && t.start >= now - learnDays * DAY);
  const firstFrom = (subject: string, fromId: string, after: number) =>
    trips.find((t) => t.subject === subject && t.from === fromId && t.start >= after) ?? null;

  const byPerson = new Map<string, PersonScore>(people.map((p) => [p.subject, { subject: p.subject, predictions: 0, hits: 0, eligible: 0, foreseen: 0 }]));
  let predictions = 0, hits = 0, eligible = 0, foreseen = 0;
  const durErrors: number[] = [];
  let durTrips = 0, durEstimated = 0, inBand = 0, underP80 = 0;
  let etaChecks = 0, etaOffered = 0, etaRight = 0, etaWrong = 0, etaInWindow = 0;
  const etaErrors: number[] = [];
  let overdueFired = 0, overdueLate = 0, overdueSkipped = 0;

  for (const date of dates) {
    // ── Next moves: the last word before it was due ───────────────────────
    const said = new Map<string, { subject: string; fromId: string; toId: string; leaveAt: number; at: number }>();
    const overdue = new Map<string, { subject: string; fromId: string; toId: string; at: number }>();
    for (const at of checkpointsOf(date)) {
      const history = known(at);
      const routes = routesOf(history, places, people);
      const routines = routinesOf(routes, new Date(at), learnDays);
      const live = liveFromTrips(trips, people, at);
      for (const m of nextMoves(routines, live, [], new Date(at), corrections)) {
        if (m.kind !== 'routine' || !m.routineId) continue;
        const r = routines.find((x) => x.id === m.routineId)!;
        const leaveAt = Date.parse(m.leaveAt);
        if (leaveAt - at < NEXT_LEAD_MINS * MINUTE) continue;
        said.set(`${m.subject}|${m.routineId}`, { subject: m.subject, fromId: r.fromId, toId: r.toId, leaveAt, at });
      }
      for (const w of watchItems({ routines, routes, live, arrivals: [], names, homeIds, now: new Date(at), corrections })) {
        if (w.kind !== 'overdue' || overdue.has(w.key)) continue;
        const r = routines.find((x) => w.key === `overdue:${x.id}:${date}`);
        if (r) overdue.set(w.key, { subject: r.subject, fromId: r.fromId, toId: r.toId, at });
      }
    }
    const hitTrips = new Set<Trip>();
    for (const s of said.values()) {
      predictions++;
      byPerson.get(s.subject)!.predictions++;
      const went = firstFrom(s.subject, s.fromId, s.at);
      if (went && went.to === s.toId && Math.abs(went.start - s.leaveAt) <= NEXT_TOLERANCE_MINS * MINUTE) {
        hits++;
        byPerson.get(s.subject)!.hits++;
        hitTrips.add(went);
      }
    }
    for (const o of overdue.values()) {
      overdueFired++;
      const later = trips.find((t) => t.subject === o.subject && t.from === o.fromId && t.to === o.toId && t.start >= o.at && localClock(t.start).date === date);
      if (later) overdueLate++;
      else overdueSkipped++;
    }

    // ── Each trip of the day: was it foreseen, how long did we say ────────
    for (const trip of trips) {
      if (localClock(trip.start).date !== date) continue;
      const before = trips.filter((t) => t.subject === trip.subject && t.end <= trip.start).at(-1);
      if (before && before.to === trip.from && trip.start - before.end >= NEXT_LEAD_MINS * MINUTE) {
        eligible++;
        byPerson.get(trip.subject)!.eligible++;
        if (hitTrips.has(trip)) { foreseen++; byPerson.get(trip.subject)!.foreseen++; }
      }

      const history = known(trip.start);
      const routes = routesOf(history, places, people);
      durTrips++;
      const est = learnedTravel(routes, trip.from, trip.to, trip.subject);
      // A trip far past what was expected is a missed arrival, not a journey time.
      if (est && trip.minutes <= est.median * 3) {
        durEstimated++;
        durErrors.push(Math.abs(trip.minutes - est.median));
        if (trip.minutes >= est.low && trip.minutes <= est.high) inBand++;
        if (trip.minutes <= est.p80) underP80++;
      }

      // ── Live arrival part-way through ──────────────────────────────────
      if (trip.path.length < 6 || trip.minutes < 6) continue;
      const person = people.find((p) => p.subject === trip.subject);
      if (!person) continue;
      for (const f of ETA_FRACTIONS) {
        const cut = trip.start + (trip.end - trip.start) * f;
        const active = trip.path.filter((p) => +p.ts <= cut);
        if (active.length < 3) continue;
        etaChecks++;
        const now = new Date(+active.at(-1)!.ts + 30_000);
        const a = predictArrival(active, history, places, person, now);
        if (!a) continue;
        etaOffered++;
        if (a.toId !== trip.to) { etaWrong++; continue; }
        etaRight++;
        etaErrors.push(Math.abs(Date.parse(a.eta) - trip.end) / MINUTE);
        if (Date.parse(a.earliest) <= trip.end && trip.end <= Date.parse(a.latest)) etaInWindow++;
      }
    }
  }

  return {
    generatedAt: generatedAt.toISOString(),
    from: input.from,
    to: input.to,
    days: dates.length,
    learnDays,
    next: { predictions, hits, precision: ratio(hits, predictions), eligible, foreseen, recall: ratio(foreseen, eligible), byPerson: [...byPerson.values()] },
    duration: { trips: durTrips, estimated: durEstimated, mae: mean(durErrors), medianError: median(durErrors), band: ratio(inBand, durEstimated), p80: ratio(underP80, durEstimated) },
    eta: { checks: etaChecks, offered: etaOffered, rightPlace: etaRight, wrongPlace: etaWrong, mae: mean(etaErrors), window: ratio(etaInWindow, etaRight) },
    overdue: { fired: overdueFired, late: overdueLate, skipped: overdueSkipped },
  };
}
