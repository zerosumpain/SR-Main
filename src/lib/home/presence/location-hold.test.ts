import { describe, expect, it } from 'vitest';
import { applyHold, heldReading, HOLD_MAX_MS, isActive, parseHold, readHold, type LocationHold } from './location-hold';
import type { HouseholdPresence, LivePosition } from './household';

const now = new Date('2026-10-21T10:00:00Z');
const hold: LocationHold = { lat: 54.52345, lon: -1.55678, label: 'Home', since: '2026-10-21T09:00:00.000Z', until: '2026-10-21T12:00:00.000Z' };

function card(subject: string, extra: Partial<HouseholdPresence> = {}): HouseholdPresence {
  return {
    subject, isHome: false, placeLabel: 'Station', distanceHomeKm: 4.2, batteryPct: 61, ageMins: 95,
    lastSeenAt: new Date('2026-10-21T08:25:00Z'), today: { firstOutMins: 420, minutesOut: 60, placesVisited: 3, fixes: 120 }, ...extra,
  };
}
const pin = (subject: string): LivePosition => ({ subject, lat: 54.6, lon: -1.4, at: '2026-10-21T08:25:00.000Z', isHome: false });

describe('parseHold', () => {
  it('takes a point, a name and an end in the next week', () => {
    const out = parseHold({ lat: 54.5, lon: -1.5, label: '  Home  ', until: '2026-10-21T12:00:00Z' }, now);
    expect(out).toEqual({ hold: { lat: 54.5, lon: -1.5, label: 'Home', since: now.toISOString(), until: '2026-10-21T12:00:00.000Z' } });
  });

  it('refuses what is not a place, a name, or a time to come within a week', () => {
    const ok = { lat: 54.5, lon: -1.5, label: 'Home', until: '2026-10-21T12:00:00Z' };
    for (const bad of [null, [], { ...ok, lat: 91 }, { ...ok, lon: 'x' }, { ...ok, lat: 0, lon: 0 }, { ...ok, lat: NaN },
      { ...ok, label: ' ' }, { ...ok, label: 'x'.repeat(61) }, { ...ok, until: 'soon' }, { ...ok, until: '2026-10-21T09:00:00Z' },
      { ...ok, until: new Date(now.getTime() + HOLD_MAX_MS + 60_000).toISOString() }]) {
      expect(parseHold(bad, now)).toHaveProperty('error');
    }
  });
});

describe('readHold and isActive', () => {
  it('reads a stored hold back and is off once it has run out', () => {
    expect(readHold(hold)).toEqual(hold);
    expect(readHold({ lat: 'x' })).toBeNull();
    expect(readHold(null)).toBeNull();
    expect(isActive(hold, now)).toBe(true);
    expect(isActive(hold, new Date('2026-10-21T12:00:00Z'))).toBe(false);
    expect(isActive(null, now)).toBe(false);
  });
});

describe('heldReading', () => {
  const home = { lat: 54.5235, lon: -1.5568 };
  it('reads as a fix there would: home within 150 m, the place it falls in, the distance', () => {
    const places = [{ id: 'h', lat: 54.5235, lon: -1.5568, radiusM: 80, label: 'Elton Parade' }, { id: 's', lat: 54.6, lon: -1.4, radiusM: 100, label: 'Station' }];
    const there = heldReading(hold, home, places);
    expect(there).toMatchObject({ isHome: true, placeLabel: 'Elton Parade' });
    expect(there.distanceHomeKm).toBeLessThanOrEqual(0.01);
    const away = heldReading({ lat: 54.6, lon: -1.4 }, home, places);
    expect(away).toMatchObject({ isHome: false, placeLabel: 'Station' });
    expect(away.distanceHomeKm).toBeGreaterThan(10);
    expect(heldReading(hold, null, [])).toEqual({ isHome: null, placeLabel: null, distanceHomeKm: null });
  });
});

describe('applyHold', () => {
  const reading = { isHome: true, placeLabel: 'Elton Parade', distanceHomeKm: 0 };
  const input = {
    presence: [card('john'), card('kid')],
    positions: [pin('john'), pin('kid')],
    recent: new Map([['john', [1, 2, 3]], ['kid', [4]]]),
  };

  it('puts the owner at the held point, seen moments ago and still; nobody else moves', () => {
    const out = applyHold(input, hold, ['john'], reading, now, 45_000);
    expect(out.presence[0]).toEqual({ ...card('john'), ...reading, ageMins: 1, lastSeenAt: new Date('2026-10-21T09:59:15Z') });
    expect(out.presence[1]).toEqual(card('kid'));
    expect(out.positions).toEqual([pin('kid'), { subject: 'john', lat: 54.5235, lon: -1.5568, at: '2026-10-21T09:59:15.000Z', isHome: true }]);
    expect([...out.recent.keys()]).toEqual(['kid']);
    // The same keys as an unheld card and pin: nothing for a viewer to notice.
    expect(Object.keys(out.presence[0]).sort()).toEqual(Object.keys(card('john')).sort());
    expect(Object.keys(out.positions[1]).sort()).toEqual(Object.keys(pin('john')).sort());
    // And the input is left as it was, for the owner's own view.
    expect(input.presence[0]).toEqual(card('john'));
  });

  it('caps the jitter, works from pins alone, and never makes a non-sharer appear', () => {
    expect(applyHold(input, hold, ['john'], reading, now, 10 * 60_000).presence[0].ageMins).toBe(2);
    expect(applyHold({ presence: [], positions: [pin('john')], recent: new Map() }, hold, ['john'], reading, now, 0).positions[0])
      .toMatchObject({ lat: 54.5235, at: now.toISOString() });
    const off = applyHold({ presence: [card('john', { notSharing: true })], positions: [], recent: new Map() }, hold, ['john'], reading, now, 0);
    expect(off.presence[0]).toEqual(card('john', { notSharing: true }));
    expect(off.positions).toEqual([]);
  });
});
