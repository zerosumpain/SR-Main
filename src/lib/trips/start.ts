// src/lib/trips/start.ts
//
// v8: the guided start, the pure half. Instead of a free-text box and
// "Making the trip… 37 s", a trip starts from a few tapped answers — where,
// when, who (from the family roster), the pace, what is already booked (from
// the owner's notes) and anything typed — and a staged job does the rest
// where the person can watch it: set the trip up, research it, draft ways to
// do it, ask a few quick questions (./start.server). PURE.

import { dayLabel } from './changes';
import type { NoteFact, TripStart } from './decisions';
import { isLocalDate, MAX_TRIP_DAYS } from './intake';
import type { TravellerProfile, TripOp, Wish } from './model';
import { PACK_STAGES } from './pack';
import { datesBetween } from './solver/calendar';
import type { StageDecl } from './jobs.server';

export const START_STAGES: StageDecl[] = [
  { key: 'brief', label: 'Setting up the trip' },
  ...PACK_STAGES,
  { key: 'shapes', label: 'Drafting ways to do it' },
  { key: 'questions', label: 'A few quick questions' },
];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);

/** `{ start: TripStart }` from a create request; a sentence on what is wrong otherwise. */
export function parseTripStart(raw: unknown): { ok: true; value: TripStart } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'Send the start as an object.' };
  const destination = text(raw.destination, 120);
  if (!destination) return { ok: false, error: 'Where are you going?' };
  if (!isLocalDate(raw.startDate) || !isLocalDate(raw.endDate)) return { ok: false, error: 'Give the first and last day as dates.' };
  if (raw.endDate < raw.startDate) return { ok: false, error: 'The last day is before the first.' };
  if (datesBetween(raw.startDate, raw.endDate).length > MAX_TRIP_DAYS) return { ok: false, error: `A trip can be at most ${MAX_TRIP_DAYS} days.` };
  const travellers = (Array.isArray(raw.travellers) ? raw.travellers : [])
    .filter(isObj)
    .map((t) => {
      const age = Number(t.age);
      return { name: text(t.name, 60), age: t.age !== null && t.age !== undefined && Number.isInteger(age) && age >= 0 && age <= 120 ? age : null, personId: text(t.personId, 80) };
    })
    .filter((t): t is { name: string; age: number | null; personId: string | null } => !!t.name)
    .slice(0, 12);
  const pace = raw.pace === 'relaxed' || raw.pace === 'packed' ? raw.pace : 'normal';
  const confirmNotes = (Array.isArray(raw.confirmNotes) ? raw.confirmNotes : []).filter((x): x is string => typeof x === 'string' && /^note:[a-z]+:[a-z0-9]+$/.test(x)).slice(0, 20);
  return { ok: true, value: { destination, startDate: raw.startDate, endDate: raw.endDate, travellers, pace, confirmNotes, text: text(raw.text, 2000) } };
}

/**
 * The people going, as the profile's travellers: a roster id given (or a
 * roster name matched) keeps the family member's id. Names and ages only.
 */
export function startTravellers(start: Pick<TripStart, 'travellers'>, roster: Array<{ id: string; name: string }>): TravellerProfile['travellers'] {
  return start.travellers.map((t) => {
    const known = (t.personId ? roster.find((r) => r.id === t.personId) : undefined) ?? roster.find((r) => r.name.toLowerCase() === t.name.toLowerCase());
    return { name: t.name, relation: known ? 'family' : null, notes: [], age: t.age ?? null, personId: known?.id ?? null };
  });
}

/** "Rome, 26–30 Oct, 4 travellers". */
export function startDetail(start: Pick<TripStart, 'destination' | 'startDate' | 'endDate' | 'travellers'>): string {
  const a = dayLabel(start.startDate).split(' ');
  const b = dayLabel(start.endDate).split(' ');
  const when = start.startDate === start.endDate ? `${a[1]} ${a[2]}` : a[2] === b[2] ? `${a[1]}–${b[1]} ${b[2]}` : `${a[1]} ${a[2]} – ${b[1]} ${b[2]}`;
  const n = start.travellers.length;
  return `${start.destination.split(',')[0]}, ${when}${n ? `, ${n} ${n === 1 ? 'traveller' : 'travellers'}` : ''}`;
}

/**
 * Confirmed notes' ops in two passes: everything but bookings first, then
 * the bookings — each tied to the wish of the same title the first pass
 * made, since a note's booking cannot know that wish's id in advance.
 */
export function noteOpsInTwo(notes: NoteFact[]): { first: TripOp[]; bookings: TripOp[] } {
  const ops = notes.flatMap((n) => n.ops);
  return { first: ops.filter((o) => o.op !== 'addBooking'), bookings: ops.filter((o) => o.op === 'addBooking') };
}

export function linkBookings(bookings: TripOp[], wishes: Array<Pick<Wish, 'id' | 'title'>>): TripOp[] {
  return bookings.map((o) => {
    if (o.op !== 'addBooking' || o.booking.wishId) return o;
    const w = wishes.find((x) => x.title.toLowerCase() === o.booking.title.toLowerCase());
    return w ? ({ ...o, booking: { ...o.booking, wishId: w.id } } as TripOp) : o;
  });
}
