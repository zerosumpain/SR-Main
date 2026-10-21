import { describe, expect, it } from 'vitest';
import type { Trip, Wish } from './model';
import { applyOps, type OpEffects } from './ops';
import { captureCreated, createdFromExtra, pairApplied, pairDirect, provenanceFor, withoutInventedFacts } from './provenance';

const TRIP: Trip = {
  id: 't1', ownerEmail: 'o@example.test', title: 'Rome', destination: 'Rome, Italy', timeZone: 'Europe/Rome',
  startDate: '2026-10-26', endDate: '2026-10-30', pace: 'normal', modes: ['walk'], status: 'planned', notes: null,
};
const PANTHEON = { name: 'Pantheon', location: { lat: 41.8986, lng: 12.4769 }, osmId: 'way/1', address: 'Piazza della Rotonda' };

function effects(): OpEffects {
  let n = 0;
  return {
    resolvePlace: async (q) => (q.includes('nowhere') ? null : PANTHEON),
    setTrip: async () => {},
    addStay: async (f) => ({ id: `stay${++n}`, ...f }),
    updateStay: async () => {},
    removeStay: async () => {},
    addWish: async (f) => ({ id: `wish${++n}`, ...f, locked: false, suggested: false, skipped: false, facts: null, sortHint: 0 }) as Wish,
    updateWish: async () => {},
    removeWish: async () => {},
    addBooking: async (b) => ({ id: `booking${++n}`, wishId: b.wishId, title: b.title, date: null, startMin: null, endMin: null, reference: null, url: null, documentId: null, status: 'booked' }),
    updateBooking: async () => {},
    addTransport: async (s) => ({ id: `transport${++n}`, ...s }),
  };
}

const ctx = () => ({ trip: TRIP, stays: [], wishes: [], bookings: [], knownUrls: new Set<string>(), transport: [] });

describe('provenance from a planner turn', () => {
  it('records each op’s stated source, and assumes a fact set without one', async () => {
    const ops = [
      { op: 'addStay', name: 'Flat', placeQuery: 'Via del Governo Vecchio 69, Rome', fromDate: '2026-10-26', toDate: '2026-10-30', source: 'notes', sourceNote: 'Airbnb booking in your notes' },
      { op: 'addStay', name: 'Nowhere', placeQuery: 'nowhere', fromDate: '2026-10-26', toDate: '2026-10-27' },
      { op: 'setTrip', fields: { pace: 'relaxed', startDate: '2026-10-27' } },
      { op: 'addWish', wish: { title: 'Pantheon', placeQuery: 'Pantheon, Rome' } },
      { op: 'addWish', wish: { title: 'Trevi', placeQuery: 'Trevi, Rome' }, source: 'you' },
      { op: 'addTransport', segment: { kind: 'flight', direction: 'outbound', from: { name: 'Newcastle', code: 'NCL' }, to: { name: 'Fiumicino', code: 'FCO' }, departDate: '2026-10-26', departMin: 455, arriveDate: '2026-10-26', arriveMin: 690, confidence: 'stated' } },
      { op: 'addTransport', segment: { kind: 'flight', direction: 'return', from: { name: 'Fiumicino', code: 'FCO' }, to: { name: 'Newcastle', code: 'NCL' }, departDate: '2026-10-30', departMin: 640, arriveDate: '2026-10-30', arriveMin: 760, confidence: 'estimated' } },
    ];
    const cap = captureCreated(effects());
    const result = await applyOps(ops, ctx(), cap.fx);
    expect(result.rejected).toHaveLength(1);
    const pairs = pairApplied(ops, result, cap.created);
    expect(pairs.map((p) => [p.op.op, p.createdId])).toEqual([
      ['addStay', 'stay1'],
      ['setTrip', null],
      ['addWish', 'wish2'],
      ['addWish', 'wish3'],
      ['addTransport', 'transport4'],
      ['addTransport', 'transport5'],
    ]);
    expect(provenanceFor(pairs, 'planner')).toEqual({
      'stay:stay1': { source: 'notes', note: 'Airbnb booking in your notes', ref: null },
      dates: { source: 'assumed', note: null, ref: null },
      pace: { source: 'assumed', note: null, ref: null },
      // A wish the planner added without saying is left unlabelled (it reads 'you').
      'wish:wish3': { source: 'you', note: null, ref: null },
      // A journey without a source reads its own confidence.
      'transport:transport4': { source: 'you', note: null, ref: null },
      'transport:transport5': { source: 'assumed', note: null, ref: null },
    });
  });

  it('drops the entry of a removed row, and ignores an unknown source', () => {
    const pairs = pairApplied(
      [{ op: 'removeStay', id: 's1' }, { op: 'updateStay', id: 's2', fields: { placeQuery: 'Hotel X' }, source: 'gossip' }],
      { applied: [{ op: 'removeStay', id: 's1' }, { op: 'updateStay', id: 's2', fields: { placeQuery: 'Hotel X' } }], rejected: [] },
      { stays: [], wishes: [], bookings: [], transport: [] },
    );
    expect(provenanceFor(pairs, 'planner')).toEqual({ 'stay:s1': null, 'stay:s2': { source: 'assumed', note: null, ref: null } });
  });

  it('a person’s direct edit makes everything it touches “you”', () => {
    const ops = [
      { op: 'addStay' as const, name: 'Flat', placeQuery: 'Via X', fromDate: '2026-10-26', toDate: '2026-10-30', checkInMin: null, checkOutMin: null },
      { op: 'setTrip' as const, fields: { destination: 'Rome', modes: ['walk' as const, 'transit' as const] } },
      { op: 'removeWish' as const, id: 'w9' },
    ];
    const created = createdFromExtra({ stay: { id: 'st7' } });
    expect(provenanceFor(pairDirect(ops, created), 'you')).toEqual({
      'stay:st7': { source: 'you', note: null, ref: null },
      destination: { source: 'you', note: null, ref: null },
      modes: { source: 'you', note: null, ref: null },
      'wish:w9': null,
    });
  });

  it('reads created rows from a form route’s response', () => {
    expect(createdFromExtra({ wishes: [{ id: 'a' }, { id: 'b' }] }).wishes).toEqual(['a', 'b']);
    expect(createdFromExtra({ booking: { id: 'bk' } }).bookings).toEqual(['bk']);
    expect(createdFromExtra({ deleted: true })).toEqual({ stays: [], wishes: [], bookings: [], transport: [] });
  });
});

describe('withoutInventedFacts', () => {
  it('drops a stay or booking the planner marked assumed or named as a placeholder, and keeps the rest', () => {
    const ops = [
      { op: 'addStay', name: 'Alfama accommodation — approximate base', placeQuery: 'Alfama, Lisbon', source: 'assumed' },
      { op: 'addStay', name: 'Somewhere central (placeholder)', placeQuery: 'Lisbon' },
      { op: 'addBooking', booking: { title: 'Fado night' }, source: 'assumed' },
      { op: 'addStay', name: 'Airbnb, Via del Governo Vecchio', placeQuery: 'Via del Governo Vecchio 69, Rome', source: 'notes' },
      { op: 'setTrip', fields: { pace: 'relaxed' }, source: 'assumed' },
    ];
    const r = withoutInventedFacts(ops);
    expect(r.ops).toEqual([ops[3], ops[4]]);
    expect(r.dropped).toEqual(['Alfama accommodation — approximate base', 'Somewhere central (placeholder)', 'Fado night']);
  });
});
