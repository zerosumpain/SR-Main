import { describe, it, expect } from 'vitest';
import { fixFromEntityState } from './observe';

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
