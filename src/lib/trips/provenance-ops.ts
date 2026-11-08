// src/lib/trips/provenance-ops.ts
//
// v8: which brief facts a set of applied ops touched, as `trip.provenance`
// keys ('dates', 'pace', `stay:<id>`, `wish:<id>`…), so an answered
// question, an assumed default or a confirmed note can say where each fact
// came from. New rows are found by comparing the state before and after
// (ops carry titles and names, not the ids the store gave them). PURE.

import type { Booking, Stay, TransportSegment, TripOp, Wish } from './model';

export interface StateLike {
  stays: Array<Pick<Stay, 'id' | 'name'>>;
  wishes: Array<Pick<Wish, 'id' | 'title'>>;
  bookings: Array<Pick<Booking, 'id' | 'title'>>;
  transport?: Array<Pick<TransportSegment, 'id'> & Partial<Pick<TransportSegment, 'number' | 'departDate' | 'departMin'>>>;
}

const TRIP_KEYS: Record<string, string> = {
  startDate: 'dates',
  endDate: 'dates',
  destination: 'destination',
  timeZone: 'destination',
  pace: 'pace',
  modes: 'modes',
};

/** The provenance keys these ops set, in order, without repeats. */
export function provenanceKeys(ops: TripOp[], before: StateLike, after: StateLike): string[] {
  const out = new Set<string>();
  const fresh = <T extends { id: string }>(a: T[], b: T[] | undefined) => a.filter((x) => !(b ?? []).some((y) => y.id === x.id));
  const newStays = fresh(after.stays, before.stays);
  const newWishes = fresh(after.wishes, before.wishes);
  const newBookings = fresh(after.bookings, before.bookings);
  const newTransport = fresh(after.transport ?? [], before.transport);
  for (const op of ops) {
    switch (op.op) {
      case 'setTrip':
        for (const k of Object.keys(op.fields ?? {})) if (TRIP_KEYS[k]) out.add(TRIP_KEYS[k]);
        break;
      case 'addStay': {
        const s = newStays.find((x) => x.name === op.name) ?? newStays[0];
        if (s) out.add(`stay:${s.id}`);
        break;
      }
      case 'updateStay':
        out.add(`stay:${op.id}`);
        break;
      case 'addWish': {
        const w = newWishes.find((x) => x.title.toLowerCase() === op.wish.title.toLowerCase());
        if (w) out.add(`wish:${w.id}`);
        break;
      }
      case 'updateWish':
        out.add(`wish:${op.id}`);
        break;
      case 'addBooking': {
        const b = newBookings.find((x) => x.title === op.booking.title) ?? newBookings[0];
        if (b) out.add(`booking:${b.id}`);
        break;
      }
      case 'updateBooking':
        out.add(`booking:${op.id}`);
        break;
      case 'addTransport': {
        const seg = op.segment;
        const same = newTransport.filter((t) => t.departDate === undefined || (t.departDate === seg?.departDate && (t.number ?? null) === (seg?.number ?? null)));
        for (const t of same.length ? same : newTransport) out.add(`transport:${t.id}`);
        break;
      }
      case 'updateTransport':
        out.add(`transport:${op.id}`);
        break;
      case 'updateProfile':
        if (op.profile?.travellers) out.add('travellers');
        break;
      default:
        break;
    }
  }
  return [...out];
}
