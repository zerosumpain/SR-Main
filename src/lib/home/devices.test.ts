import { describe, expect, it } from 'vitest';
import { summariseDevices, unavailableIsNormal, verdictFor, type DevicesPayload, type EntityRow } from './devices';

// Shapes copied from homeserv's HA 2026.9.3 on 2026-09-25.
const row = (entry: string, id: string, state: string, extra: Partial<{ dc: string; bat: number; name: string }> = {}): EntityRow => [
  entry,
  id,
  state,
  '2026-09-25T17:00:00+00:00',
  extra.dc ?? null,
  extra.bat ?? null,
  extra.name ?? null,
];

describe('verdictFor', () => {
  it('reads a failed entry as down whatever its entities say', () => {
    expect(verdictFor('setup_retry', false, 135, 135)).toBe('down');
    expect(verdictFor('setup_error', false, 0, 0)).toBe('down');
  });
  it('grades a loaded entry by how much of it is unavailable', () => {
    expect(verdictFor('loaded', false, 10, 10)).toBe('down');
    expect(verdictFor('loaded', false, 22, 6)).toBe('degraded');
    expect(verdictFor('loaded', false, 22, 3)).toBe('watch');
    expect(verdictFor('loaded', false, 6, 0)).toBe('ok');
  });
  it('leaves a disabled entry out of it', () => {
    expect(verdictFor('not_loaded', true, 4, 4)).toBe('off');
  });
});

describe('unavailableIsNormal', () => {
  it('knows an Alexa alarm sensor rests at unavailable', () => {
    expect(unavailableIsNormal('sensor.soundbar_next_alarm')).toBe(true);
    expect(unavailableIsNormal('sensor.fins_echo_next_timer')).toBe(true);
    expect(unavailableIsNormal('sensor.john_s_echo_temperature')).toBe(false);
  });
});

describe('summariseDevices', () => {
  const payload: DevicesPayload = {
    entries: {
      hue: ['hue', 'Hue Bridge ecb5fa2e991b', 'setup_retry', 'None'],
      alexa: ['alexa_devices', 'johnkelly.main@gmail.com', 'loaded', 'None'],
      tado: ['tado', 'Kelly Home', 'loaded', 'None'],
      l360: ['life360', 'Life360', 'loaded', 'None'],
    },
    rows: [
      row('hue', 'light.kitchen', 'unavailable', { name: 'Kitchen' }),
      row('hue', 'light.hall', 'unavailable', { name: 'Hall' }),
      row('alexa', 'sensor.soundbar_next_alarm', 'unavailable'),
      row('alexa', 'sensor.fins_echo_next_timer', 'unavailable'),
      row('alexa', 'media_player.kitchen', 'idle'),
      row('alexa', 'binary_sensor.soundbar_connectivity', 'on'),
      row('tado', 'climate.downstairs_hallway', 'unavailable', { name: 'Downstairs Hallway' }),
      row('tado', 'sensor.downstairs_hallway_temperature', '19.2'),
      row('tado', 'sensor.downstairs_hallway_humidity', '55'),
      row('tado', 'sensor.downstairs_hallway_heating', '0'),
      row('tado', 'sensor.tado_battery', 'unavailable', { dc: 'battery' }),
      row('l360', 'device_tracker.life360_katie_kelly', 'home', { bat: 15, name: 'Katie Kelly' }),
      row('l360', 'device_tracker.life360_rory_kelly', 'home', { bat: 100, name: 'Rory Kelly' }),
      row('l360', 'sensor.ring_battery', '0', { dc: 'battery', name: 'Front door battery' }),
    ],
  };
  const s = summariseDevices(payload);

  it('puts what is broken first, by verdict then name', () => {
    expect(s.integrations.map((i) => [i.label, i.verdict])).toEqual([
      ['Philips Hue', 'down'],
      ['Tado heating', 'degraded'],
      ['Alexa', 'ok'],
      ['Life360', 'ok'],
    ]);
  });
  it('does not count resting Alexa alarm sensors', () => {
    const alexa = s.integrations.find((i) => i.domain === 'alexa_devices')!;
    expect(alexa.entities).toBe(2);
    expect(alexa.unavailable).toBe(0);
  });
  it('names what is unavailable and drops an e-mail title', () => {
    const hue = s.integrations.find((i) => i.domain === 'hue')!;
    expect(hue.unavailableNames).toEqual(['Kitchen', 'Hall']);
    expect(hue.title).toBe('Hue Bridge ecb5fa2e991b');
    expect(s.integrations.find((i) => i.domain === 'alexa_devices')!.title).toBeNull();
    expect(s.integrations.find((i) => i.domain === 'life360')!.title).toBeNull();
  });
  it('reads batteries from the attribute or a battery sensor, lowest first', () => {
    expect(s.batteries.map((b) => [b.name, b.level])).toEqual([
      ['Front door battery', 0],
      ['Katie Kelly', 15],
      ['Rory Kelly', 100],
    ]);
  });
  it('counts verdicts', () => {
    expect(s.counts).toEqual({ down: 1, degraded: 1, watch: 0, ok: 2, off: 0 });
  });
  it('survives an empty answer', () => {
    expect(summariseDevices({ entries: {}, rows: [] }).integrations).toEqual([]);
  });
});
