// src/lib/trips/chat-view.ts
//
// What jkai's trip tools (`./chat-tools`) show of a trip: compact, day by day,
// with links back to the trip page. PURE, so the shapes are tested without a
// database. The trip page and the phone stay the places decisions are made.

import type { Booking, PlannedDay, SolvedPlan, Stay, TransportSegment, TripMessage } from './model';

export const tripHref = (id: string) => `/trips/${encodeURIComponent(id)}`;
export const tripDeepLink = (id: string) => `sr://trips/${encodeURIComponent(id)}`;

/** "09:05" for minutes after local midnight. */
export function clock(min: number): string {
  if (!Number.isFinite(min)) return '?';
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export interface DayView {
  day: number;
  date: string;
  stops: Array<{ at: string; until: string; title: string; kind: string; locked?: true; warnings?: string[] }>;
  warnings: string[];
}

/** One planned day as lines a reply can quote. */
export function dayView(d: PlannedDay, index: number): DayView {
  return {
    day: index + 1,
    date: d.date,
    stops: d.stops
      .filter((s) => s.kind !== 'stay')
      .map((s) => ({
        at: clock(s.arriveMin),
        until: clock(s.departMin),
        title: s.title.slice(0, 160),
        kind: s.kind,
        ...(s.locked ? { locked: true as const } : {}),
        ...(s.warnings?.length ? { warnings: s.warnings.slice(0, 3) } : {}),
      })),
    warnings: d.warnings.slice(0, 5),
  };
}

/**
 * Which day `day` names: a 1-based day number ("day 2"), a local date
 * (YYYY-MM-DD), or 'today'/'tomorrow' against `today`. Null when it names none.
 */
export function pickDay(plan: SolvedPlan, day: unknown, today: string): number | null {
  if (day === undefined || day === null || day === '') return null;
  const n = typeof day === 'number' ? day : /^\d{1,2}$/.test(String(day).trim()) ? Number(String(day).trim()) : NaN;
  if (Number.isInteger(n)) return n >= 1 && n <= plan.days.length ? n - 1 : -1;
  const s = String(day).trim().toLowerCase();
  const date = s === 'today' ? today : s === 'tomorrow' ? nextDate(today) : s;
  const i = plan.days.findIndex((d) => d.date === date);
  return i;
}

function nextDate(day: string): string {
  const t = Date.parse(`${day}T12:00:00Z`);
  return Number.isFinite(t) ? new Date(t + 86_400_000).toISOString().slice(0, 10) : day;
}

/** Every day, compact — the "plan" part. */
export function planView(plan: SolvedPlan): { days: DayView[]; dropped: SolvedPlan['dropped']; warnings: string[] } {
  return { days: plan.days.map(dayView), dropped: plan.dropped.slice(0, 10), warnings: plan.warnings.slice(0, 5) };
}

export function bookingView(b: Booking) {
  return {
    title: b.title,
    status: b.status,
    ...(b.date ? { date: b.date } : {}),
    ...(b.startMin != null ? { at: clock(b.startMin) } : {}),
    ...(b.reference ? { reference: b.reference } : {}),
    ...(b.url ? { url: b.url } : {}),
  };
}

export function transportView(t: TransportSegment) {
  return {
    kind: t.kind,
    direction: t.direction,
    ...(t.carrier ? { carrier: t.carrier } : {}),
    ...(t.number ? { number: t.number } : {}),
    from: t.from.name,
    to: t.to.name,
    depart: `${t.departDate} ${clock(t.departMin)}`,
    arrive: `${t.arriveDate} ${clock(t.arriveMin)}`,
  };
}

export function stayView(s: Stay) {
  return { name: s.name, ...(s.address ? { address: s.address } : {}), from: s.fromDate, to: s.toDate };
}

/** A conversation message, clipped; the planner's words are the planner's. */
export function messageView(m: TripMessage) {
  return {
    role: m.role === 'assistant' ? 'planner' : m.role,
    text: m.text.length > 1200 ? `${m.text.slice(0, 1199)}…` : m.text,
    surface: m.surface,
    at: m.createdAt,
    ...(m.planVersion ? { planVersion: m.planVersion } : {}),
  };
}
