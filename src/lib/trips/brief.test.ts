import { describe, expect, it } from 'vitest';
import { briefPatchOps, buildBrief, dateRangeLabel, readBriefPatch, stayArea, transportLabel, transportOrigin, travellersLabel, type BriefInput } from './brief';
import { phoneBrief } from './decisions.bundle.server';
import type { Provenance } from './decisions';
import type { Booking, Stay, TransportSegment, Trip, Wish } from './model';

const TRIP: Trip = {
  id: 't1', ownerEmail: 'o@example.test', title: 'Rome', destination: 'Rome, Italy', timeZone: 'Europe/Rome',
  startDate: '2026-10-26', endDate: '2026-10-30', pace: 'normal', modes: ['walk'], status: 'planned', notes: null,
};
const STAY: Stay = {
  id: 'st1', name: 'Flat near Piazza Navona', address: '69, Via del Governo Vecchio, Parione, Municipio Roma I, Rome, Roma Capitale, Lazio, 00186, Italy',
  location: { lat: 41.8986, lng: 12.4699 }, fromDate: '2026-10-26', toDate: '2026-10-30', checkInMin: null, checkOutMin: null,
};
const FLIGHT: TransportSegment = {
  id: 'tr1', kind: 'flight', direction: 'outbound', carrier: 'Jet2', number: 'LS1235',
  from: { name: 'Newcastle Airport', code: 'NCL', location: null, timeZone: 'Europe/London' },
  to: { name: 'Fiumicino', code: 'FCO', location: null, timeZone: 'Europe/Rome' },
  departDate: '2026-10-26', departMin: 455, arriveDate: '2026-10-26', arriveMin: 690, confidence: 'stated', status: null, delayMin: null, bookingRef: null, sources: [], checkedAt: null,
};
const wish = (id: string, title: string, extra: Partial<Wish> = {}): Wish => ({
  id, title, place: null, priority: 'nice', durationSec: null, partOfDay: 'any', fixedDate: null, fixedStartMin: null, locked: false, suggested: false, skipped: false, facts: null, note: null, sortHint: 0, ...extra,
});
const booking = (id: string, status: Booking['status']): Booking => ({ id, wishId: 'w1', title: 'Vatican Museums', date: '2026-10-28', startMin: 495, endMin: null, reference: 'VAT-9', url: null, documentId: null, status });

const input = (over: Partial<BriefInput> = {}): BriefInput => ({
  trip: TRIP, stays: [STAY], wishes: [], bookings: [], transport: [FLIGHT], provenance: {}, missing: [],
  profile: {
    travellers: [{ name: 'John', relation: 'owner', notes: [] }, { name: 'Sam', relation: 'son', notes: [], age: 9 }, { name: 'Alex', relation: null, notes: [] }, { name: 'Robin', relation: null, notes: [] }],
    preferences: [{ text: 'Likes a long lunch', source: 'memory', ref: 'memory:4' }],
    constraints: [{ text: 'Sam is vegetarian', source: 'conversation', ref: null }],
    history: [], gatheredAt: 'x',
  },
  ...over,
});

const item = (b: ReturnType<typeof buildBrief>, key: string) => b.items.find((i) => i.key === key);

describe('buildBrief', () => {
  it('builds the chips the fixture shows, in order', () => {
    const b = buildBrief(input());
    expect(b.items.map((i) => [i.key, i.label, i.origin])).toEqual([
      ['destination', 'Rome', 'you'],
      ['dates', '26–30 Oct', 'you'],
      ['travellers', 'John, Sam + 2', 'notes'],
      ['pace', 'Normal pace', 'you'],
      ['stay:st1', 'Stay: Parione', 'you'],
      ['transport:tr1', 'NCL 07:35 → FCO', 'you'],
      ['constraint:0', 'Sam is vegetarian', 'you'],
      ['preference:0', 'Likes a long lunch', 'notes'],
    ]);
    expect(item(b, 'dates')?.detail).toBe('Mon 26 Oct – Fri 30 Oct, 5 days');
    expect(item(b, 'travellers')?.detail).toBe('John, Sam (9), Alex, Robin');
    expect(item(b, 'stay:st1')?.detail).toBe('Flat near Piazza Navona, 4 nights');
    expect(item(b, 'transport:tr1')).toMatchObject({ detail: 'LS1235 · Mon 26 Oct, lands 11:30', editable: false });
    expect(item(b, 'preference:0')?.ref).toBe('memory:4');
    expect(b.assumed).toBe(0);
  });

  it('labels each fact from its provenance, with the note', () => {
    const provenance: Provenance = {
      'stay:st1': { source: 'notes', note: 'Airbnb booking in your notes', ref: 'memory:812', at: 'x' },
      dates: { source: 'assumed', note: 'Assumed: placeholder dates', ref: null, at: 'x' },
    };
    const b = buildBrief(input({ provenance }));
    expect(item(b, 'stay:st1')).toMatchObject({ origin: 'notes', note: 'Airbnb booking in your notes', ref: 'memory:812' });
    expect(item(b, 'dates')?.origin).toBe('assumed');
    expect(b.assumed).toBe(1);
  });

  it('reads a journey’s confidence when nothing was recorded, but never makes old stays and bookings look assumed', () => {
    const b = buildBrief(
      input({
        transport: [
          { ...FLIGHT, id: 'a', confidence: 'estimated' },
          { ...FLIGHT, id: 'b', confidence: 'researched', sources: [{ url: 'https://example.test/ls1235', title: 'LS1235' }] },
          { ...FLIGHT, id: 'c', confidence: 'live' },
        ],
        bookings: [booking('bk1', 'booked'), booking('bk2', 'to-book')],
      }),
    );
    expect(['transport:a', 'transport:b', 'transport:c'].map((k) => item(b, k)?.origin)).toEqual(['assumed', 'found', 'found']);
    expect(item(b, 'transport:b')?.ref).toBe('https://example.test/ls1235');
    expect(item(b, 'booking:bk1')).toMatchObject({ label: 'Booked: Vatican Museums', detail: 'Wed 28 Oct 08:15 · ref VAT-9', origin: 'you' });
    expect(item(b, 'booking:bk2')).toBeUndefined();
    expect(item(b, 'stay:st1')?.origin).toBe('you');
  });

  it('shows must-dos, modes when not walk-only, and only real assumptions', () => {
    const b = buildBrief(
      input({
        trip: { ...TRIP, modes: ['walk', 'transit', 'taxi'] },
        wishes: [wish('w1', 'Vatican Museums', { priority: 'must', fixedDate: '2026-10-28', fixedStartMin: 495 }), wish('w2', 'Gelato'), wish('w3', 'Borghese', { priority: 'must', skipped: true })],
        provenance: {
          'meal-times': { source: 'assumed', note: 'Dinner around 19:30', ref: null, at: 'x' },
          'stay:gone': { source: 'assumed', note: null, ref: null, at: 'x' },
          'wish:w1': { source: 'you', note: null, ref: null, at: 'x' },
        },
      }),
    );
    expect(item(b, 'modes')?.label).toBe('Walking, public transport and taxis');
    expect(b.items.filter((i) => i.kind === 'must').map((i) => [i.label, i.detail])).toEqual([['Vatican Museums', 'Wed 28 Oct 08:15']]);
    expect(b.items.filter((i) => i.kind === 'assumption')).toEqual([
      { key: 'meal-times', kind: 'assumption', label: 'Dinner around 19:30', detail: null, origin: 'assumed', note: 'Dinner around 19:30', ref: null, editable: true },
    ]);
  });

  it('never stops for a missing fact: no stay, no travellers, a placeholder trip are assumed', () => {
    const b = buildBrief(input({ trip: { ...TRIP, destination: 'New trip' }, stays: [], transport: [], profile: null, missing: ['where they are staying'] }));
    expect(item(b, 'destination')).toMatchObject({ label: 'Where: not set yet', origin: 'assumed' });
    expect(item(b, 'dates')?.origin).toBe('assumed');
    expect(item(b, 'travellers')).toMatchObject({ label: 'Who: not known yet', origin: 'assumed' });
    expect(item(b, 'stay')).toMatchObject({ label: 'Stay: not known yet', origin: 'assumed', editable: true });
    expect(b.missing).toEqual(['where they are staying']);
    expect(b.assumed).toBe(4);
  });

  it('uses the trip’s own notes for who when the profile has no travellers', () => {
    const b = buildBrief(input({ profile: null, trip: { ...TRIP, notes: 'Two adults and a nine-year-old' } }));
    expect(item(b, 'travellers')).toMatchObject({ label: 'Two adults and a nine-year-old', origin: 'you' });
  });

  it('the phone brief drops memory items and the notes’ text', () => {
    const b = phoneBrief(buildBrief(input({ provenance: { 'stay:st1': { source: 'notes', note: 'Airbnb booking in your notes', ref: 'memory:812', at: 'x' } } })));
    expect(b.items.some((i) => i.kind === 'preference' || i.kind === 'constraint')).toBe(false);
    expect(item(b, 'stay:st1')).toMatchObject({ label: 'Stay: Parione', origin: 'notes', note: null, ref: null });
    expect(JSON.stringify(b)).not.toContain('memory:');
  });
});

describe('formatters', () => {
  it('dates without a time-zone round trip', () => {
    expect(dateRangeLabel('2026-10-26', '2026-10-30')).toBe('26–30 Oct');
    expect(dateRangeLabel('2026-10-30', '2026-11-02')).toBe('30 Oct – 2 Nov');
    expect(dateRangeLabel('2026-12-30', '2027-01-02')).toBe('30 Dec 2026 – 2 Jan 2027');
    expect(dateRangeLabel('2026-10-15', '2026-10-15')).toBe('15 Oct');
  });

  it('a stay’s area from its address, or nothing when only the city is left', () => {
    expect(stayArea(STAY, 'Rome, Italy')).toBe('Parione');
    expect(stayArea({ name: 'Hotel Raphael', address: 'Hotel Raphael, 2, Largo Febo, Parione, Municipio Roma I, Rome, Italy' }, 'Rome')).toBe('Parione');
    expect(stayArea({ name: 'Flat', address: 'Via del Governo Vecchio 69, Rome' }, 'Rome, Italy')).toBeNull();
    expect(stayArea({ name: 'Flat', address: '12, Grey Street, Newcastle upon Tyne, Tyne and Wear, England, NE1 6EE, United Kingdom' }, 'Newcastle')).toBeNull();
    expect(stayArea({ name: 'Flat', address: '3, Osborne Road, Jesmond, Newcastle upon Tyne, England' }, 'Newcastle')).toBe('Jesmond');
    expect(stayArea({ name: 'Flat', address: null }, 'Rome')).toBeNull();
  });

  it('travellers and journeys', () => {
    expect(travellersLabel([{ name: 'John', relation: null, notes: [] }])).toEqual({ label: 'John', detail: 'John' });
    expect(travellersLabel([])).toBeNull();
    expect(transportLabel({ ...FLIGHT, from: { ...FLIGHT.from, code: null, name: 'Darlington station' } })).toBe('Darlington 07:35 → FCO');
    expect(transportOrigin({ confidence: 'stated' })).toBe('you');
  });
});

describe('direct edits', () => {
  const ctx = { trip: TRIP, stays: [STAY], wishes: [wish('w1', 'Vatican', { priority: 'must' })], transport: [FLIGHT], profile: input().profile, provenance: { 'meal-times': { source: 'assumed' as const, note: 'Dinner around 19:30', ref: null, at: 'x' } } };

  it('reads a patch leniently and says what is wrong', () => {
    expect(readBriefPatch({ field: 'pace', pace: 'packed' })).toEqual({ ok: true, patch: { field: 'pace', pace: 'packed' } });
    expect(readBriefPatch({ field: 'modes', modes: ['transit', 'rocket'] })).toEqual({ ok: true, patch: { field: 'modes', modes: ['walk', 'transit'] } });
    expect(readBriefPatch({ field: 'dates', startDate: 'soon' })).toMatchObject({ ok: false });
    expect(readBriefPatch({ field: 'stay', name: 'Flat', placeQuery: 'Via X', fromDate: '2026-10-27', toDate: '2026-10-27' })).toMatchObject({ ok: false });
    expect(readBriefPatch({ field: 'travellers', travellers: [{ name: 'Sam', age: 9 }, { age: 4 }] })).toEqual({ ok: true, patch: { field: 'travellers', travellers: [{ name: 'Sam', age: 9, personId: null }] } });
    expect(readBriefPatch(null)).toMatchObject({ ok: false });
  });

  it('turns each edit into ops', () => {
    expect(briefPatchOps({ field: 'dates', startDate: '2026-10-27', endDate: '2026-10-31' }, ctx)).toMatchObject({ ok: true, ops: [{ op: 'setTrip', fields: { startDate: '2026-10-27', endDate: '2026-10-31' } }] });
    expect(briefPatchOps({ field: 'stay', id: null, name: 'Hotel', placeQuery: 'Hotel Raphael, Rome', fromDate: '2026-10-26', toDate: '2026-10-28' }, ctx)).toMatchObject({ ok: true, ops: [{ op: 'addStay', name: 'Hotel' }] });
    expect(briefPatchOps({ field: 'stay', id: 'st1', name: 'Flat near Piazza Navona', placeQuery: 'Flat near Piazza Navona', fromDate: '2026-10-26', toDate: '2026-10-29' }, ctx)).toMatchObject({
      ok: true, ops: [{ op: 'updateStay', id: 'st1', fields: { fromDate: '2026-10-26', toDate: '2026-10-29' } }],
    });
    const who = briefPatchOps({ field: 'travellers', travellers: [{ name: 'Sam', age: null, personId: null }] }, ctx);
    expect(who).toMatchObject({ ok: true, ops: [{ op: 'updateProfile', profile: { travellers: [{ name: 'Sam', relation: 'son', age: 9 }] } }] });
    expect(briefPatchOps({ field: 'remove', key: 'wish:w1' }, ctx)).toMatchObject({ ok: true, ops: [{ op: 'updateWish', id: 'w1', fields: { priority: 'nice' } }] });
    expect(briefPatchOps({ field: 'remove', key: 'stay:nope' }, ctx)).toEqual({ ok: false, error: 'No such stay.' });
  });

  it('confirm and removing an assumption only rewrite provenance', () => {
    expect(briefPatchOps({ field: 'confirm', key: 'meal-times' }, ctx)).toEqual({ ok: true, ops: [], provenance: { 'meal-times': { source: 'you', note: null, ref: null } } });
    expect(briefPatchOps({ field: 'remove', key: 'meal-times' }, ctx)).toEqual({ ok: true, ops: [], provenance: { 'meal-times': null } });
    expect(briefPatchOps({ field: 'confirm', key: 'preference:0' }, ctx)).toMatchObject({ ok: false });
  });
});

describe('the shared wire fixture', () => {
  it('the builder makes the brief chips the phone’s fixture shows', async () => {
    const fixture = (await import('./fixtures/decisions-wire.json')).default;
    const b = buildBrief(
      input({
        trip: { ...TRIP, startDate: '2026-10-26', endDate: '2026-10-30' },
        stays: [{ ...STAY, id: '7b0c5d0e-4c55-4a77-9e0a-1d2f3a4b5c6d' }],
        transport: [{ ...FLIGHT, id: '5f0e1b2a-0000-4000-8000-000000000001', number: null, arriveMin: 690 }],
        profile: { ...input().profile!, preferences: [], constraints: [] },
        provenance: { 'stay:7b0c5d0e-4c55-4a77-9e0a-1d2f3a4b5c6d': { source: 'notes', note: 'Airbnb booking in your notes', ref: 'memory:812', at: 'x' } },
      }),
    );
    const want = fixture.decisions.brief.items.filter((i) => i.kind !== 'assumption');
    expect(b.items.map((i) => [i.key, i.kind, i.label, i.origin, i.editable])).toEqual(want.map((i) => [i.key, i.kind, i.label, i.origin, i.editable]));
    expect(b.items.find((i) => i.kind === 'stay')).toMatchObject({ detail: 'Flat near Piazza Navona, 4 nights', note: 'Airbnb booking in your notes', ref: 'memory:812' });
    expect(b.items.find((i) => i.kind === 'transport')?.detail).toBe('Mon 26 Oct, lands 11:30');
  });
});
