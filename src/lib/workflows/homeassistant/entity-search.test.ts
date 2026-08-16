import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  matchesQuery,
  resolveEntityId,
  scoreEntity,
  searchEntities,
  type RegistryMeta,
} from './entity-search';

/** A slice of a real house: the entities the 14 Aug sweep was hunting for. */
const states = [
  { entity_id: 'binary_sensor.front_door', state: 'off', last_changed: '2026-08-16T07:00:00Z', attributes: { friendly_name: 'Front Door', device_class: 'door' } },
  { entity_id: 'binary_sensor.garage_door', state: 'on', attributes: { friendly_name: 'Garage Door', device_class: 'garage_door' } },
  { entity_id: 'binary_sensor.back_window', state: 'off', attributes: { friendly_name: 'Back Window', device_class: 'window' } },
  { entity_id: 'lock.front_door', state: 'locked', attributes: { friendly_name: 'Front Door Lock' } },
  { entity_id: 'sensor.outdoor_temperature', state: '17.2', attributes: { friendly_name: 'Outdoor Temperature', unit_of_measurement: '°C' } },
  { entity_id: 'alarm_control_panel.home_alarm', state: 'disarmed', attributes: { friendly_name: 'Home Alarm' } },
  { entity_id: 'light.kitchen_ceiling', state: 'on', attributes: { friendly_name: 'Kitchen Ceiling' } },
  { entity_id: 'person.katie', state: 'home', attributes: { friendly_name: 'Katie' } },
];

const registry = new Map<string, RegistryMeta>([
  ['binary_sensor.front_door', { area_id: 'hall', area_name: 'Hallway', domain: 'binary_sensor', friendly_name: 'Front Door' }],
  ['binary_sensor.garage_door', { area_id: 'gar', area_name: 'Garage', domain: 'binary_sensor', friendly_name: 'Garage Door' }],
  ['lock.front_door', { area_id: 'hall', area_name: 'Hallway', domain: 'lock', friendly_name: 'Front Door Lock' }],
  ['light.kitchen_ceiling', { area_id: 'kit', area_name: 'Kitchen', domain: 'light', friendly_name: 'Kitchen Ceiling' }],
]);

describe('the sweep this replaces', () => {
  it('answers in one call what took seven Jinja templates', () => {
    // 14 Aug: select('search','lock'), then 'alarm', then binary_sensor+door,
    // +window, +motion, +garage, +contact — one keyword per round trip.
    const doors = searchEntities(states, registry, { query: 'door' });
    expect(doors.entities.map((e) => e.entity_id)).toEqual([
      'binary_sensor.front_door', 'binary_sensor.garage_door', 'lock.front_door',
    ]);
    // The follow-up question — "what kinds of thing are these" — is already
    // answered, which is what collapses the next call too.
    expect(doors.domains).toEqual({ binary_sensor: 2, lock: 1 });
    expect(doors.areas).toEqual(['Garage', 'Hallway']);
  });

  it('carries the live state, so no per-entity follow-up is needed', () => {
    const open = searchEntities(states, registry, { domain: 'binary_sensor', state: 'on' });
    expect(open.entities).toHaveLength(1);
    expect(open.entities[0]).toMatchObject({ entity_id: 'binary_sensor.garage_door', state: 'on', device_class: 'garage_door', area_name: 'Garage' });
  });

  it('narrows on two words instead of widening', () => {
    // Under OR, "garage door" would return every door AND every garage thing,
    // which answers nothing — the second word has to cost matches, not add them.
    const got = searchEntities(states, registry, { query: 'garage door' });
    expect(got.entities.map((e) => e.entity_id)).toEqual(['binary_sensor.garage_door']);
  });

  it('does not put a near-miss above the obvious answer', () => {
    // `sensor.outdoor_temperature` contains "door". Ranking it first is how a
    // sweep ends up guessing at ids like `lock.0`.
    const got = searchEntities(states, registry, { query: 'door', limit: 10 });
    expect(got.entities[0].entity_id).toBe('binary_sensor.front_door');
    expect(got.entities.map((e) => e.entity_id)).not.toContain('sensor.outdoor_temperature');
  });

  it('matches on the room, because that is how a person asks', () => {
    const got = searchEntities(states, registry, { query: 'kitchen' });
    expect(got.entities.map((e) => e.entity_id)).toContain('light.kitchen_ceiling');
  });
});

describe('filters', () => {
  it('restricts by domain, singular or plural', () => {
    expect(searchEntities(states, registry, { domain: 'lock' }).entities).toHaveLength(1);
    expect(searchEntities(states, registry, { domain: ['lock', 'light'] }).entities.map((e) => e.domain).sort()).toEqual(['light', 'lock']);
  });

  it('restricts by area', () => {
    const hall = searchEntities(states, registry, { area: 'hallway' });
    expect(hall.entities.map((e) => e.entity_id).sort()).toEqual(['binary_sensor.front_door', 'lock.front_door']);
  });

  it('omits attributes unless asked, and includes them when asked', () => {
    const lean = searchEntities(states, registry, { query: 'outdoor' });
    expect(lean.entities[0].attributes).toBeUndefined();
    // The unit still rides along — a reading without its unit is not a reading.
    expect(lean.entities[0].unit).toBe('°C');
    const full = searchEntities(states, registry, { query: 'outdoor', includeAttributes: true });
    expect(full.entities[0].attributes).toMatchObject({ friendly_name: 'Outdoor Temperature' });
  });
});

describe('limits and honesty about them', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ entity_id: `light.bulb_${i}`, state: 'on', attributes: {} }));

  it('defaults, caps, and says when it truncated', () => {
    expect(searchEntities(many, new Map(), {}).entities).toHaveLength(DEFAULT_LIMIT);
    expect(searchEntities(many, new Map(), { limit: 999 }).entities).toHaveLength(MAX_LIMIT);
    const got = searchEntities(many, new Map(), { limit: 10 });
    expect(got).toMatchObject({ truncated: true, totalCount: 300 });
  });

  it('counts domains over EVERY match, not just the page returned', () => {
    const got = searchEntities(many, new Map(), { limit: 5 });
    // Reporting `light: 5` on a 300-entity house implies the rest do not
    // exist, which is the wrong conclusion to hand back.
    expect(got.domains).toEqual({ light: 300 });
  });
});

describe('degrading without losing the house', () => {
  it('works with an empty or stale registry', () => {
    const got = searchEntities(states, new Map(), { query: 'front door' });
    // No area enrichment, but the entity is still found and still typed.
    expect(got.entities.map((e) => e.entity_id)).toContain('binary_sensor.front_door');
    expect(got.entities[0].area_name).toBeNull();
    expect(got.entities[0].domain).toBe('binary_sensor');
  });

  it('survives malformed input rather than throwing at a chat turn', () => {
    expect(searchEntities(null, new Map(), {}).entities).toEqual([]);
    expect(searchEntities([{ state: 'on' }, null, 'nonsense'], new Map(), {}).entities).toEqual([]);
    expect(searchEntities(states, new Map(), { limit: 'lots' }).entities.length).toBeGreaterThan(0);
  });
});

describe('the 404 that was really a spelling mismatch', () => {
  it('accepts both entity_id and entityId', () => {
    // 32 of 72 live calls passed `entityId`; the handler read undefined, built
    // /api/states/undefined, and HA answered "404 Not Found" — which reads as
    // "no such entity" and sends the caller guessing.
    expect(resolveEntityId({ entity_id: 'lock.front_door' })).toBe('lock.front_door');
    expect(resolveEntityId({ entityId: 'lock.front_door' })).toBe('lock.front_door');
    expect(resolveEntityId({ entity: 'lock.front_door' })).toBe('lock.front_door');
    expect(resolveEntityId({ entity_id: ' lock.front_door ' })).toBe('lock.front_door');
  });

  it('prefers the declared spelling when both are present', () => {
    expect(resolveEntityId({ entity_id: 'a.one', entityId: 'b.two' })).toBe('a.one');
  });

  it('returns empty for nothing usable, so the caller can say so', () => {
    expect(resolveEntityId({})).toBe('');
    expect(resolveEntityId({ entity_id: '   ' })).toBe('');
    expect(resolveEntityId({ entity_id: 42 } as never)).toBe('');
  });
});

describe('helpers', () => {
  it('matchesQuery is AND across terms', () => {
    expect(matchesQuery('binary_sensor.garage_door Garage Door', 'garage door')).toBe(true);
    expect(matchesQuery('binary_sensor.front_door Front Door', 'garage door')).toBe(false);
    expect(matchesQuery('anything', '  ')).toBe(true);
  });

  it('scoreEntity rewards a whole-word name hit most', () => {
    const named = { entity_id: 'binary_sensor.front_door', domain: 'binary_sensor', friendly_name: 'Front Door', area_name: null, state: 'off' };
    const buried = { entity_id: 'sensor.outdoor_temperature', domain: 'sensor', friendly_name: 'Outdoor Temperature', area_name: null, state: '17' };
    expect(scoreEntity(named, 'door')).toBeGreaterThan(scoreEntity(buried, 'door'));
  });
});
