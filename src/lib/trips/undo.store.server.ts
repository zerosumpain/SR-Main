// src/lib/trips/undo.store.server.ts
//
// v8: the writes undo makes (./undo `RestoreActions`) in ONE transaction, so
// a half-restored trip is never solved or seen: the trip's fields, then rows
// removed (bookings before the wishes they name), re-inserted with their old
// ids, and rewritten. And the version list the "restore" sheet reads, with
// whether each version can be restored (it has a snapshot — versions from
// before v8 do not).

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { trip, tripBooking, tripPlan, tripStay, tripTransport, tripWish } from '$lib/db/schema';
import type { PlanSource, Stay, TransportSegment, Wish, Booking } from './model';
import type { RestoreActions } from './undo';

const stayRow = (tripId: string, s: Stay) => ({
  id: s.id,
  tripId,
  name: s.name,
  address: s.address,
  lat: s.location.lat,
  lng: s.location.lng,
  fromDate: s.fromDate,
  toDate: s.toDate,
  checkInMin: s.checkInMin,
  checkOutMin: s.checkOutMin,
});

const wishRow = (tripId: string, w: Wish) => ({
  id: w.id,
  tripId,
  title: w.title,
  place: (w.place ?? null) as Record<string, unknown> | null,
  priority: w.priority,
  durationSec: w.durationSec,
  partOfDay: w.partOfDay,
  fixedDate: w.fixedDate,
  fixedStartMin: w.fixedStartMin,
  locked: w.locked,
  suggested: w.suggested,
  skipped: w.skipped,
  facts: (w.facts ?? null) as Record<string, unknown> | null,
  note: w.note,
  sortHint: w.sortHint,
  replacesMeal: w.replacesMeal ?? null,
});

const bookingRow = (tripId: string, b: Booking) => ({
  id: b.id,
  tripId,
  wishId: b.wishId,
  title: b.title,
  date: b.date,
  startMin: b.startMin,
  endMin: b.endMin,
  reference: b.reference,
  url: b.url,
  documentId: b.documentId,
  status: b.status,
});

const transportRow = (tripId: string, t: TransportSegment) => ({
  id: t.id,
  tripId,
  kind: t.kind,
  direction: t.direction,
  carrier: t.carrier,
  number: t.number,
  fromPlace: t.from as unknown as Record<string, unknown>,
  toPlace: t.to as unknown as Record<string, unknown>,
  departDate: t.departDate,
  departMin: t.departMin,
  arriveDate: t.arriveDate,
  arriveMin: t.arriveMin,
  confidence: t.confidence,
  status: t.status,
  delayMin: t.delayMin,
  bookingRef: t.bookingRef,
  sources: t.sources ?? [],
  checkedAt: t.checkedAt ? new Date(t.checkedAt) : null,
});

/** Put a snapshot's facts back, all or nothing. */
export async function restoreConstraints(tripId: string, a: RestoreActions): Promise<void> {
  await db.transaction(async (tx) => {
    // One writer at a time per trip, as appending a version is.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trip_restore:${tripId}`}))`);
    if (a.trip) await tx.update(trip).set({ ...a.trip, updatedAt: new Date() }).where(eq(trip.id, tripId));

    if (a.bookings.remove.length) await tx.delete(tripBooking).where(and(eq(tripBooking.tripId, tripId), inArray(tripBooking.id, a.bookings.remove)));
    if (a.wishes.remove.length) await tx.delete(tripWish).where(and(eq(tripWish.tripId, tripId), inArray(tripWish.id, a.wishes.remove)));
    if (a.stays.remove.length) await tx.delete(tripStay).where(and(eq(tripStay.tripId, tripId), inArray(tripStay.id, a.stays.remove)));
    if (a.transport.remove.length) await tx.delete(tripTransport).where(and(eq(tripTransport.tripId, tripId), inArray(tripTransport.id, a.transport.remove)));

    if (a.stays.insert.length) await tx.insert(tripStay).values(a.stays.insert.map((s) => stayRow(tripId, s)));
    if (a.wishes.insert.length) await tx.insert(tripWish).values(a.wishes.insert.map((w) => wishRow(tripId, w)));
    if (a.bookings.insert.length) await tx.insert(tripBooking).values(a.bookings.insert.map((b) => bookingRow(tripId, b)));
    if (a.transport.insert.length) await tx.insert(tripTransport).values(a.transport.insert.map((t) => transportRow(tripId, t)));

    for (const s of a.stays.update) {
      const { id: _id, tripId: _t, ...set } = stayRow(tripId, s);
      await tx.update(tripStay).set(set).where(and(eq(tripStay.tripId, tripId), eq(tripStay.id, s.id)));
    }
    for (const w of a.wishes.update) {
      const { id: _id, tripId: _t, ...set } = wishRow(tripId, w);
      await tx.update(tripWish).set({ ...set, updatedAt: new Date() }).where(and(eq(tripWish.tripId, tripId), eq(tripWish.id, w.id)));
    }
    for (const b of a.bookings.update) {
      const { id: _id, tripId: _t, ...set } = bookingRow(tripId, b);
      await tx.update(tripBooking).set({ ...set, updatedAt: new Date() }).where(and(eq(tripBooking.tripId, tripId), eq(tripBooking.id, b.id)));
    }
    for (const t of a.transport.update) {
      const { id: _id, tripId: _t, ...set } = transportRow(tripId, t);
      await tx.update(tripTransport).set({ ...set, updatedAt: new Date() }).where(and(eq(tripTransport.tripId, tripId), eq(tripTransport.id, t.id)));
    }
  });
}

export interface VersionRow {
  version: number;
  source: PlanSource;
  createdAt: string;
  changes: string[];
  /** It has a snapshot of the facts it was solved from, so it can be restored. */
  restorable: boolean;
}

/** The newest `limit` versions, newest first, with whether each can be restored. */
export async function listVersions(tripId: string, limit = 30): Promise<VersionRow[]> {
  const rows = await db
    .select({
      version: tripPlan.version,
      source: tripPlan.source,
      createdAt: tripPlan.createdAt,
      changes: tripPlan.changes,
      restorable: sql<boolean>`${tripPlan.constraints} is not null`,
    })
    .from(tripPlan)
    .where(eq(tripPlan.tripId, tripId))
    .orderBy(desc(tripPlan.version))
    .limit(limit);
  return rows.map((r) => ({ version: r.version, source: r.source as PlanSource, createdAt: r.createdAt.toISOString(), changes: r.changes ?? [], restorable: r.restorable === true }));
}
