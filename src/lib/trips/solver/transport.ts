// src/lib/trips/solver/transport.ts
//
// v3: getting there and back. A transport segment frames the day it lands on
// or leaves from:
//
//   arrival day   lands at arriveMin (+ delayMin) → exitMin → transfer to the
//                 stay → "Drop bags at <stay>" (before check-in) or "Check in
//                 at <stay>" (15 min) → the day's sights. Check-in itself is
//                 not needed before the evening.
//   departure day leaves the stay at depart − checkInLeadMin − transfer, after
//                 "Collect bags at <stay>" (15 min); a "Check out of <stay>"
//                 stop (15 min) follows the morning start when the stay has a
//                 check-out time.
//
// Transfers use the matrix with `transport:<id>:to` (arrival) and
// `transport:<id>:from` (departure) as points, else an estimate from the
// coordinates by the pace's mode rule. The transport stops themselves have
// kind 'transport' and ids `transport:<id>:arrive` / `transport:<id>:depart`.

import {
  TRANSPORT_LEADS,
  type LocalDate,
  type PlannedLeg,
  type PlannedStop,
  type Stay,
  type TransportSegment,
} from '../model';
import { fmtMin } from './calendar';
import { estimateLeg } from './estimate';
import { chooseLeg, stayPoint, type LegChoice, type SolverContext } from './matrix';

/** Minutes for dropping bags / checking in / out / collecting bags at the stay. */
export const STAY_HANDLING_MIN = 15;

export const transportPoint = (seg: Pick<TransportSegment, 'id'>, end: 'from' | 'to'): string =>
  `transport:${seg.id}:${end}`;

export interface ArrivalFrame {
  segmentId: string;
  stop: PlannedStop;
  leg: PlannedLeg;
  /** "Drop bags at …" or "Check in at …" (kind 'stay'). */
  stayStop: PlannedStop;
}

export interface DepartureFrame {
  segmentId: string;
  /** Leave the stay for the station/airport at this minute. */
  leaveMin: number;
  leg: LegChoice;
  stop: PlannedStop;
  /** Morning "Check out of …" stop, when the stay has a check-out time. */
  checkOut: boolean;
}

/** A transfer between two points: the matrix when it has both, else an estimate by the mode rule. */
export function transferLeg(ctx: SolverContext, from: string, to: string): LegChoice {
  if (ctx.index.has(from) && ctx.index.has(to)) return chooseLeg(ctx, from, to);
  const a = ctx.locations.get(from);
  const b = ctx.locations.get(to);
  if (!a || !b) return { mode: 'walk', durationSec: 0, distanceM: null, estimated: true };
  const walk = estimateLeg(a, b, 'walk');
  if (walk.seconds <= ctx.rules.walkLimitSec) {
    return { mode: 'walk', durationSec: walk.seconds, distanceM: walk.metres, estimated: true };
  }
  let best: LegChoice | null = null;
  for (const mode of ctx.modes) {
    const e = estimateLeg(a, b, mode);
    if (!best || e.seconds < best.durationSec)
      best = { mode, durationSec: e.seconds, distanceM: e.metres, estimated: true };
  }
  return best as LegChoice;
}

function label(seg: TransportSegment): string {
  const kind = { flight: 'Flight', train: 'Train', coach: 'Coach', ferry: 'Ferry', car: 'Drive' }[seg.kind];
  return seg.number ? `${kind} ${seg.number}` : kind;
}

const usable = (s: TransportSegment) => s.status !== 'cancelled';

/** The segment that lands on this date (first by time, then id). */
export function arrivalOn(ctx: SolverContext, date: LocalDate): TransportSegment | null {
  return (
    ctx.transport
      .filter((s) => usable(s) && s.direction !== 'return' && s.arriveDate === date)
      .sort((a, b) => a.arriveMin - b.arriveMin || (a.id < b.id ? -1 : 1))[0] ?? null
  );
}

/** The segment that leaves on this date (first by time, then id). */
export function departureOn(ctx: SolverContext, date: LocalDate): TransportSegment | null {
  return (
    ctx.transport
      .filter((s) => usable(s) && s.direction !== 'outbound' && s.departDate === date)
      .sort((a, b) => a.departMin - b.departMin || (a.id < b.id ? -1 : 1))[0] ?? null
  );
}

export function arrivalFrame(
  ctx: SolverContext,
  seg: TransportSegment,
  stay: Stay,
  date: LocalDate,
): ArrivalFrame {
  const lands = seg.arriveMin + (seg.delayMin ?? 0);
  const out = lands + TRANSPORT_LEADS[seg.kind].exitMin;
  const stopId = `transport:${seg.id}:arrive`;
  const stop: PlannedStop = {
    id: stopId,
    kind: 'transport',
    wishId: null,
    title: `${label(seg)} lands at ${seg.to.name}${seg.delayMin ? ` (${seg.delayMin} min late)` : ''}`,
    location: seg.to.location ? { ...seg.to.location } : null,
    arriveMin: lands,
    departMin: out,
    waitSec: 0,
    locked: false,
    bookingId: null,
    warnings: [],
  };
  const c = transferLeg(ctx, transportPoint(seg, 'to'), stayPoint(stay.id));
  const atStay = out + Math.ceil(c.durationSec / 60);
  const early = stay.checkInMin === null || atStay < stay.checkInMin;
  const stayStop: PlannedStop = {
    id: `stay:${date}:${early ? 'bags' : 'checkin'}`,
    kind: 'stay',
    wishId: null,
    title: early ? `Drop bags at ${stay.name}` : `Check in at ${stay.name}`,
    location: { ...stay.location },
    arriveMin: atStay,
    departMin: atStay + STAY_HANDLING_MIN,
    waitSec: 0,
    locked: false,
    bookingId: null,
    warnings:
      early && stay.checkInMin !== null
        ? [`Check-in from ${fmtMin(stay.checkInMin)} — any time this evening`]
        : [],
  };
  const leg: PlannedLeg = {
    fromStopId: stopId,
    toStopId: stayStop.id,
    mode: c.mode,
    durationSec: c.durationSec,
    distanceM: c.distanceM,
    estimated: c.estimated,
    line: null,
  };
  return { segmentId: seg.id, stop, leg, stayStop };
}

export function departureFrame(ctx: SolverContext, seg: TransportSegment, stay: Stay): DepartureFrame {
  const departs = seg.departMin + (seg.delayMin ?? 0);
  const atTerminal = departs - TRANSPORT_LEADS[seg.kind].checkInLeadMin;
  const c = transferLeg(ctx, stayPoint(stay.id), transportPoint(seg, 'from'));
  const leaveMin = atTerminal - Math.ceil(c.durationSec / 60);
  const stop: PlannedStop = {
    id: `transport:${seg.id}:depart`,
    kind: 'transport',
    wishId: null,
    title: `${label(seg)} from ${seg.from.name} at ${fmtMin(departs)}`,
    location: seg.from.location ? { ...seg.from.location } : null,
    arriveMin: atTerminal,
    departMin: departs,
    waitSec: 0,
    locked: false,
    bookingId: null,
    warnings: [],
  };
  return { segmentId: seg.id, leaveMin, leg: c, stop, checkOut: stay.checkOutMin !== null };
}
