import { describe, it, expect } from 'vitest';
import { batteryFromSource, fixFromEntityState } from './observe';

const NOW = new Date('2026-08-27T10:00:00Z');

describe('fixFromEntityState', () => {
  it('parses a normal person entity', () => {
    const res = fixFromEntityState(
      {
        entity_id: 'person.katie',
        state: 'home',
        attributes: { latitude: 54.52, longitude: -1.57, gps_accuracy: 20, battery_level: 63.4 },
        last_updated: '2026-08-27T09:58:00Z',
      },
      'person.katie',
      NOW,
    );
    expect('fix' in res && res.fix).toMatchObject({
      lat: 54.52,
      lon: -1.57,
      accuracyM: 20,
      haState: 'home',
      batteryPct: 63,
      readingAgeS: 120,
    });
  });

  it('says WHY when an entity carries no GPS, naming the entity', () => {
    const res = fixFromEntityState({ state: 'not_home', attributes: {} }, 'person.rory', NOW);
    expect('error' in res && res.error).toContain('person.rory');
    expect('error' in res && res.error).toContain('not_home');
  });

  it('prefers the tracker last_seen over entity bookkeeping timestamps', () => {
    const res = fixFromEntityState(
      {
        state: 'home',
        attributes: { latitude: 1, longitude: 1, last_seen: '2026-08-27T09:00:00Z' },
        last_updated: '2026-08-27T09:59:00Z',
      },
      'person.john',
      NOW,
    );
    expect('fix' in res && res.fix.readingAgeS).toBe(3600);
  });
});

describe('batteryFromSource', () => {
  const tracker = (level: unknown) => ({ entity_id: 'device_tracker.life360_sam', attributes: { battery_level: level } });
  const person = { entity_id: 'person.sam', attributes: { source: 'device_tracker.life360_sam', latitude: 51, longitude: -1 } };

  it('reads the battery off the tracker the person follows — the person entity has none', () => {
    const byId = new Map([['device_tracker.life360_sam', tracker(80)]]);
    expect(batteryFromSource(person, byId)).toBe(80);
  });

  it('is null with no source, a missing tracker, or a level that is not a number', () => {
    expect(batteryFromSource({ attributes: {} }, new Map())).toBeNull();
    expect(batteryFromSource(person, new Map())).toBeNull();
    expect(batteryFromSource(person, new Map([['device_tracker.life360_sam', tracker('80')]]))).toBeNull();
  });

  it('clamps to a whole percentage', () => {
    expect(batteryFromSource(person, new Map([['device_tracker.life360_sam', tracker(99.6)]]))).toBe(100);
  });
});
