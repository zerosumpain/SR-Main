// src/lib/trips/undo.ts
//
// v8: undo and restore, the pure half. Every plan version stores the facts it
// was solved from (./decisions.store.server `TripConstraints`: the trip's
// fields, stays, wishes, bookings, journeys). Undo puts a version's facts
// back: this works out what to write — rows to re-insert (keeping their ids,
// so proposals, bookings and the pack still point at them), rows added since
// to delete, rows edited since to rewrite, and the trip's own fields — and
// says it in a line for "What changed". The writes are
// ./undo.store.server; the re-solve (a NEW version: history is never
// rewritten) is ./undo.server.

import { dateRangeLabel } from './brief';
import type { TripConstraints } from './decisions.store.server';
import type { Booking, Stay, TransportSegment, Wish } from './model';

export interface RowChanges<T> {
  insert: T[];
  update: T[];
  remove: string[];
}

export interface RestoreActions {
  /** The trip fields that differ, set back to the snapshot's; null when none do. */
  trip: Partial<TripConstraints['trip']> | null;
  stays: RowChanges<Stay>;
  wishes: RowChanges<Wish>;
  bookings: RowChanges<Booking>;
  transport: RowChanges<TransportSegment>;
}

/**
 * Stable JSON: keys sorted, absent and null alike — so a row read back from
 * the snapshot's JSON and the same row read from its table compare equal.
 */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined && o[k] !== null)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

/** The fields of a wish the snapshot keeps (not the guide: big, and regenerated). */
const wishFacts = ({ guide: _g, ...w }: Wish) => w;

function rows<T extends { id: string }>(now: T[], then: T[], same: (a: T, b: T) => boolean): RowChanges<T> {
  const current = new Map(now.map((r) => [r.id, r]));
  const wanted = new Map(then.map((r) => [r.id, r]));
  return {
    insert: then.filter((r) => !current.has(r.id)),
    update: then.filter((r) => current.has(r.id) && !same(current.get(r.id)!, r)),
    remove: now.filter((r) => !wanted.has(r.id)).map((r) => r.id),
  };
}

/** What to write to turn the trip as it stands (`current`) back into `snapshot`. */
export function restoreActions(current: TripConstraints, snapshot: TripConstraints): RestoreActions {
  const tripFields: Partial<TripConstraints['trip']> = {};
  for (const k of Object.keys(snapshot.trip) as Array<keyof TripConstraints['trip']>) {
    const want = k === 'dayLoads' ? (snapshot.trip.dayLoads ?? {}) : snapshot.trip[k];
    const have = k === 'dayLoads' ? (current.trip.dayLoads ?? {}) : current.trip[k];
    if (canonical(want) !== canonical(have)) (tripFields as Record<string, unknown>)[k] = want;
  }
  const eq = (a: unknown, b: unknown) => canonical(a) === canonical(b);
  return {
    trip: Object.keys(tripFields).length ? tripFields : null,
    stays: rows(current.stays, snapshot.stays, eq),
    wishes: rows(current.wishes, snapshot.wishes, (a, b) => eq(wishFacts(a), wishFacts(b))),
    bookings: rows(current.bookings, snapshot.bookings, eq),
    transport: rows(current.transport ?? [], snapshot.transport ?? [], eq),
  };
}

export function isEmptyRestore(a: RestoreActions): boolean {
  const none = (r: RowChanges<unknown>) => !r.insert.length && !r.update.length && !r.remove.length;
  return !a.trip && none(a.stays) && none(a.wishes) && none(a.bookings) && none(a.transport);
}

const list = (xs: string[]) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, 2).join(', ')} and ${xs.length - 2} more`);

/**
 * The line that leads the new version's "What changed": "Undone: back to
 * version 12 — Palazzo Altemps taken off; Capitoline Museums back."
 */
export function undoLine(toVersion: number, a: RestoreActions, current: TripConstraints): string {
  const title = (id: string) => current.wishes.find((w) => w.id === id)?.title ?? 'a stop';
  const stay = (id: string) => current.stays.find((s) => s.id === id)?.name ?? 'a stay';
  const parts: string[] = [];
  if (a.wishes.remove.length) parts.push(`${list(a.wishes.remove.map(title))} taken off`);
  if (a.wishes.insert.length) parts.push(`${list(a.wishes.insert.map((w) => w.title))} back`);
  if (a.wishes.update.length) parts.push(`${list(a.wishes.update.map((w) => w.title))} as ${a.wishes.update.length === 1 ? 'it was' : 'they were'}`);
  if (a.stays.remove.length) parts.push(`${list(a.stays.remove.map(stay))} taken off`);
  if (a.stays.insert.length || a.stays.update.length) parts.push(`${list([...a.stays.insert, ...a.stays.update].map((s) => s.name))} as before`);
  if (a.trip?.startDate || a.trip?.endDate) parts.push(`dates back to ${dateRangeLabel(a.trip.startDate ?? current.trip.startDate, a.trip.endDate ?? current.trip.endDate)}`);
  if (a.trip?.destination) parts.push(`back to ${a.trip.destination.split(',')[0]}`);
  if (a.trip?.pace) parts.push(`${a.trip.pace} pace again`);
  if (a.trip?.dayLoads) parts.push('day loads as they were');
  if (a.transport.insert.length || a.transport.update.length || a.transport.remove.length) parts.push('journeys as they were');
  if (a.bookings.insert.length || a.bookings.update.length || a.bookings.remove.length) parts.push('bookings as they were');
  return `Undone: back to version ${toVersion}${parts.length ? ` — ${parts.join('; ')}` : ''}.`;
}
