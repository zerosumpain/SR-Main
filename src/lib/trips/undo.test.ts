import { describe, expect, it } from 'vitest';
import type { TripConstraints } from './decisions.store.server';
import type { Booking, Stay, Wish } from './model';
import { isEmptyRestore, restoreActions, undoLine } from './undo';

const stay = (id: string, name: string, extra: Partial<Stay> = {}): Stay => ({ id, name, address: null, location: { lat: 41.9, lng: 12.47 }, fromDate: '2026-10-26', toDate: '2026-10-30', checkInMin: null, checkOutMin: null, ...extra });
const wish = (id: string, title: string, extra: Partial<Wish> = {}): Wish => ({
  id, title, place: null, priority: 'nice', durationSec: null, partOfDay: 'any', fixedDate: null, fixedStartMin: null, locked: false, suggested: false, skipped: false, facts: null, note: null, sortHint: 10, replacesMeal: null, ...extra,
});
const booking = (id: string, status: Booking['status']): Booking => ({ id, wishId: 'w1', title: 'Vatican', date: null, startMin: null, endMin: null, reference: null, url: null, documentId: null, status });

const snap = (over: Partial<TripConstraints> = {}): TripConstraints => ({
  trip: { title: 'Rome', destination: 'Rome, Italy', timeZone: 'Europe/Rome', startDate: '2026-10-26', endDate: '2026-10-30', pace: 'normal', modes: ['walk'], notes: null, dayLoads: {} },
  stays: [stay('s1', 'Flat')],
  wishes: [wish('w1', 'Vatican Museums'), wish('w2', 'Capitoline Museums', { fixedDate: '2026-10-27' })],
  bookings: [booking('b1', 'to-book')],
  transport: [],
  ...over,
});

describe('restoreActions', () => {
  it('nothing to do when the trip already matches (null and absent alike, guides ignored)', () => {
    const now = snap({ wishes: [wish('w1', 'Vatican Museums', { guide: { summary: 'x', tips: [], links: [], generatedAt: 'x' } }), { ...wish('w2', 'Capitoline Museums', { fixedDate: '2026-10-27' }), replacesMeal: undefined }] });
    expect(isEmptyRestore(restoreActions(now, snap()))).toBe(true);
  });

  it('puts back a swap: the removed stop returns with its id, the added one goes, the edited one is rewritten', () => {
    // After accepting "swap Capitoline for Palazzo Altemps", then editing the Vatican and booking it.
    const now = snap({
      wishes: [wish('w1', 'Vatican Museums', { locked: true }), wish('w3', 'Palazzo Altemps', { fixedDate: '2026-10-27' })],
      bookings: [booking('b1', 'booked'), booking('b2', 'to-book')],
      trip: { ...snap().trip, pace: 'relaxed', dayLoads: { '2026-10-28': 'light' } },
    });
    const a = restoreActions(now, snap());
    expect(a.wishes.insert.map((w) => w.id)).toEqual(['w2']);
    expect(a.wishes.remove).toEqual(['w3']);
    expect(a.wishes.update).toEqual([wish('w1', 'Vatican Museums')]);
    expect(a.bookings).toEqual({ insert: [], update: [booking('b1', 'to-book')], remove: ['b2'] });
    expect(a.trip).toEqual({ pace: 'normal', dayLoads: {} });
    expect(a.stays).toEqual({ insert: [], update: [], remove: [] });
    expect(undoLine(12, a, now)).toBe('Undone: back to version 12 — Palazzo Altemps taken off; Capitoline Museums back; Vatican Museums as it was; normal pace again; day loads as they were; bookings as they were.');
  });

  it('restores stays, dates and journeys', () => {
    const now = snap({ stays: [stay('s1', 'Flat', { toDate: '2026-10-29' }), stay('s2', 'Hotel')], trip: { ...snap().trip, startDate: '2026-10-27', endDate: '2026-10-31' } });
    const a = restoreActions(now, snap());
    expect(a.stays).toEqual({ insert: [], update: [stay('s1', 'Flat')], remove: ['s2'] });
    expect(a.trip).toEqual({ startDate: '2026-10-26', endDate: '2026-10-30' });
    expect(undoLine(3, a, now)).toBe('Undone: back to version 3 — Hotel taken off; Flat as before; dates back to 26–30 Oct.');
  });

  it('says plainly when only the schedule differs', () => {
    expect(undoLine(7, restoreActions(snap(), snap()), snap())).toBe('Undone: back to version 7.');
  });
});
