import { describe, expect, it } from 'vitest';
import { parseBookingPatch, parseEventsBody, parseReplanBody, parseStayInput, parseTripInput, parseWishPatch } from './intake';

describe('parseTripInput', () => {
  const ok = { destination: 'Rome, Italy', timeZone: 'Europe/Rome', startDate: '2026-10-27', endDate: '2026-10-30', modes: ['transit', 'boat'] };
  it('accepts an intake, keeps walk and drops unknown modes', () => {
    const r = parseTripInput(ok);
    expect(r).toEqual({ ok: true, value: expect.objectContaining({ title: 'Rome, Italy', pace: 'normal', modes: ['walk', 'transit'] }) });
  });
  it('refuses a bad zone, backwards dates and over-long trips', () => {
    expect(parseTripInput({ ...ok, timeZone: 'Mars/Olympus' }).ok).toBe(false);
    expect(parseTripInput({ ...ok, endDate: '2026-10-20' }).ok).toBe(false);
    expect(parseTripInput({ ...ok, endDate: '2026-12-30' }).ok).toBe(false);
    expect(parseTripInput({ ...ok, startDate: '2026-02-30' }).ok).toBe(false);
  });
});

describe('parseStayInput', () => {
  it('turns nights into a departure date', () => {
    const r = parseStayInput({ name: 'Flat', location: { lat: 41.9, lng: 12.47 }, fromDate: '2026-10-27', nights: 4, checkInMin: '15:00' }, { startDate: '2026-10-27', endDate: '2026-10-30' });
    expect(r).toMatchObject({ ok: true, value: { toDate: '2026-10-31', checkInMin: 900 } });
  });
  it('needs a position', () => {
    expect(parseStayInput({ name: 'Flat', nights: 1 }, { startDate: '2026-10-27', endDate: '2026-10-30' }).ok).toBe(false);
  });
});

describe('parseWishPatch', () => {
  it('locks a wish given a fixed time, and only accepts suggestions', () => {
    expect(parseWishPatch({ fixedStartMin: '09:30' })).toEqual({ ok: true, value: { fixedStartMin: 570, locked: true } });
    expect(parseWishPatch({ suggested: true }).ok).toBe(false);
    expect(parseWishPatch({ durationMin: 2 }).ok).toBe(false);
    expect(parseWishPatch({ durationMin: 90 })).toEqual({ ok: true, value: { durationSec: 5400 } });
  });
  it('takes a place with a valid OSM id only', () => {
    const r = parseWishPatch({ place: { name: 'Pantheon', location: { lat: 41.8986, lng: 12.4769 }, osmId: 'way/1' } });
    expect(r).toMatchObject({ ok: true, value: { place: { osmId: 'way/1' } } });
    expect(parseWishPatch({ place: { name: 'X', location: { lat: 'a' } } }).ok).toBe(false);
  });
});

describe('parseBookingPatch', () => {
  it('keeps http links only and checks the slot', () => {
    expect(parseBookingPatch({ url: 'javascript:alert(1)' }).ok).toBe(false);
    expect(parseBookingPatch({ startMin: '10:00', endMin: '09:00' }).ok).toBe(false);
    expect(parseBookingPatch({ status: 'booked', reference: ' AB12 ' })).toEqual({ ok: true, value: { status: 'booked', reference: 'AB12' } });
  });
});

describe('parseEventsBody', () => {
  const day = { date: '2026-10-27', stayId: null, stops: [], legs: [], warnings: [] };
  it('accepts the phone events', () => {
    const r = parseEventsBody({
      basePlanVersion: 3,
      events: [
        { clientId: 'e1', kind: 'arrived', stopId: 'a', at: '2026-10-27T09:00:00Z' },
        { clientId: 'e2', kind: 'option-applied', at: '2026-10-27T09:05:00Z', detail: { option: 'o1', day } },
      ],
    });
    expect(r.ok && r.value.events.map((e) => e.clientId)).toEqual(['e1', 'e2']);
  });
  it('refuses an option without its day, an unknown kind and a missing clientId', () => {
    expect(parseEventsBody({ events: [{ clientId: 'e', kind: 'option-applied', at: '2026-10-27T09:00:00Z', detail: {} }] }).ok).toBe(false);
    expect(parseEventsBody({ events: [{ clientId: 'e', kind: 'teleported', at: '2026-10-27T09:00:00Z' }] }).ok).toBe(false);
    expect(parseEventsBody({ events: [{ kind: 'arrived', at: '2026-10-27T09:00:00Z' }] }).ok).toBe(false);
  });
});

describe('parseReplanBody', () => {
  it('reads the replan request', () => {
    expect(parseReplanBody({ date: '2026-10-27', nowMin: 700, position: { lat: 41.9, lng: 12.5 }, atStopId: null, doneStopIds: ['a', 4] })).toEqual({
      ok: true,
      value: { scope: 'day', observation: null, date: '2026-10-27', nowMin: 700, position: { lat: 41.9, lng: 12.5 }, atStopId: null, doneStopIds: ['a'] },
    });
    expect(parseReplanBody({ date: 'today', nowMin: 1 }).ok).toBe(false);
  });

  it('reads a whole-trip request with what the phone noticed (v2)', () => {
    const r = parseReplanBody({
      date: '2026-10-27', nowMin: 760, scope: 'trip', doneStopIds: [],
      observation: { kind: 'unplanned-stop', place: { name: 'Bar', location: { lat: 41.9, lng: 12.47 } }, sinceMin: 740, motion: 'stationary', stopId: null },
    });
    expect(r).toMatchObject({ ok: true, value: { scope: 'trip', observation: { kind: 'unplanned-stop', sinceMin: 740, place: { name: 'Bar' } } } });
    expect(parseReplanBody({ date: '2026-10-27', nowMin: 760, scope: 'week' }).ok).toBe(false);
    expect(parseReplanBody({ date: '2026-10-27', nowMin: 760, observation: { kind: 'lost', sinceMin: 1 } }).ok).toBe(false);
  });

  it('accepts a whole-trip option applied (detail.days)', () => {
    const day = { date: '2026-10-27', stayId: null, stops: [], legs: [], warnings: [] };
    expect(parseEventsBody({ events: [{ clientId: 'e', kind: 'option-applied', at: '2026-10-27T09:00:00Z', detail: { days: [day, { ...day, date: '2026-10-28' }] } }] }).ok).toBe(true);
    expect(parseEventsBody({ events: [{ clientId: 'e', kind: 'option-applied', at: '2026-10-27T09:00:00Z', detail: { days: [] } }] }).ok).toBe(false);
  });
});
