import { describe, it, expect } from 'vitest';
import { harvest, type HAState } from './ha';

const ent = (
  entity_id: string,
  state: string,
  attributes: Record<string, unknown> = {},
): HAState => ({ entity_id, state, attributes });

describe('harvest', () => {
  it('reads a numeric sensor state, with its unit and device class', () => {
    // The indoor temperature that had been available all along.
    const { specs, readings } = harvest([
      ent('sensor.john_s_echo_temperature', '21.8', {
        friendly_name: "John's Echo Temperature",
        unit_of_measurement: '°C',
        device_class: 'temperature',
      }),
    ]);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      key: 'ha:sensor.john_s_echo_temperature',
      source: 'ha',
      unit: '°C',
      deviceClass: 'temperature',
      valueKind: 'numeric',
    });
    expect(readings).toEqual([{ key: 'ha:sensor.john_s_echo_temperature', value: 21.8 }]);
  });

  it('finds the readings that live in ATTRIBUTES, not the state', () => {
    // weather.forecast_home keeps every measurement in attributes and none in
    // its state. Reading states alone would miss nearly all of the house.
    const { specs, readings } = harvest([
      ent('weather.forecast_home', 'rainy', {
        friendly_name: 'Forecast Home',
        temperature: 21.2,
        temperature_unit: '°C',
        humidity: 70,
        pressure: 1010.8,
        pressure_unit: 'hPa',
        wind_speed: 17.6,
        wind_speed_unit: 'km/h',
      }),
    ]);
    const keys = specs.map((s) => s.key);
    expect(keys).toContain('ha:weather.forecast_home#temperature');
    expect(keys).toContain('ha:weather.forecast_home#humidity');
    expect(keys).toContain('ha:weather.forecast_home#pressure');
    expect(keys).toContain('ha:weather.forecast_home#wind_speed');
    // The companion *_unit attribute is used rather than guessed at.
    expect(specs.find((s) => s.key.endsWith('#pressure'))?.unit).toBe('hPa');
    expect(specs.find((s) => s.key.endsWith('#wind_speed'))?.unit).toBe('km/h');
    expect(readings.find((r) => r.key.endsWith('#humidity'))?.value).toBe(70);
    // 'rainy' is not a number and not a boolean, so the state itself is skipped.
    expect(keys).not.toContain('ha:weather.forecast_home');
  });

  it('registers nothing for an unavailable device, and does not call it zero', () => {
    // The Tado, exactly as it reads today. When it comes back it starts
    // producing signals because it answered — not because anyone deployed.
    const { specs, readings, unavailable } = harvest([
      ent('climate.downstairs_hallway', 'unavailable', {
        friendly_name: 'Downstairs Hallway',
        restored: true,
        min_temp: 5,
        max_temp: 25,
        target_temp_step: 0.1,
        supported_features: 401,
      }),
      ent('binary_sensor.downstairs_hallway_window', 'unavailable', {
        device_class: 'window',
      }),
    ]);
    expect(specs).toEqual([]);
    expect(readings).toEqual([]);
    expect(unavailable).toBe(2);
  });

  it('picks the Tado up the moment it answers', () => {
    const { specs, readings } = harvest([
      ent('climate.downstairs_hallway', 'heat', {
        friendly_name: 'Downstairs Hallway',
        current_temperature: 19.4,
        temperature: 21,
        humidity: 54,
        min_temp: 5,
        max_temp: 25,
        supported_features: 401,
      }),
    ]);
    const keys = specs.map((s) => s.key);
    expect(keys).toContain('ha:climate.downstairs_hallway#current_temperature');
    expect(keys).toContain('ha:climate.downstairs_hallway#humidity');
    expect(readings.find((r) => r.key.endsWith('#current_temperature'))?.value).toBe(19.4);
    // The dial's RANGE is configuration, not a measurement of the room.
    expect(keys).not.toContain('ha:climate.downstairs_hallway#min_temp');
    expect(keys).not.toContain('ha:climate.downstairs_hallway#max_temp');
    expect(keys).not.toContain('ha:climate.downstairs_hallway#supported_features');
  });

  it('keeps binary sensors as a 0/1 series, so a day is a duty cycle', () => {
    const { specs, readings } = harvest([
      ent('binary_sensor.front_door', 'on', { device_class: 'door' }),
      ent('binary_sensor.back_door', 'off', { device_class: 'door' }),
    ]);
    expect(specs.every((s) => s.valueKind === 'boolean')).toBe(true);
    expect(readings.map((r) => r.value)).toEqual([1, 0]);
  });

  it('leaves scenes, scripts and volume knobs alone', () => {
    const { specs } = harvest([
      ent('scene.movie_night', '2026-08-27T10:00:00+00:00'),
      ent('number.front_door_volume', '8.0'),
      ent('update.some_addon', 'off'),
      ent('script.bedtime', 'off'),
    ]);
    expect(specs).toEqual([]);
  });

  it('never treats a coordinate as a measurement', () => {
    // A lat/lon reaching the signal store would put one in every card the
    // ponder pack builds, which the whole feature is arranged against.
    const { specs } = harvest([
      ent('person.john', 'home', {
        friendly_name: 'John',
        latitude: 54.5,
        longitude: -1.5,
        gps_accuracy: 15,
      }),
    ]);
    const keys = specs.map((s) => s.key);
    expect(keys).not.toContain('ha:person.john#latitude');
    expect(keys).not.toContain('ha:person.john#longitude');
    expect(keys).not.toContain('ha:person.john#gps_accuracy');
    // Its home/away state is still a perfectly good boolean series.
    expect(keys).toContain('ha:person.john');
  });
});

describe('harvest — things that are numbers but not measurements', () => {
  it('does not register an identifier as a series', () => {
    // The first live run registered camera.front_door_live_view#last_video_id
    // at 7.67e18. It is a number, it changes daily, and it correlates with
    // nothing — exactly what the sweep's hand-written metric list existed to
    // keep out. Removing that list means catching it here.
    const { specs } = harvest([
      {
        entity_id: 'camera.front_door_live_view',
        state: 'idle',
        attributes: { friendly_name: 'Front Door Live view', last_video_id: 7673494648215080000 },
      },
    ]);
    expect(specs.map((s) => s.key)).not.toContain('ha:camera.front_door_live_view#last_video_id');
  });

  it('rejects identifier-shaped names whatever the value', () => {
    const { specs } = harvest([
      {
        entity_id: 'sensor.thing',
        state: 'ok',
        attributes: { device_id: 4, serial_number: 12, session_uuid: 9, mac: 1 },
      },
    ]);
    expect(specs).toEqual([]);
  });

  it('keeps a real reading that happens to have a small number', () => {
    const { specs } = harvest([
      { entity_id: 'sensor.room', state: 'ok', attributes: { humidity: 4 } },
    ]);
    expect(specs.map((s) => s.key)).toContain('ha:sensor.room#humidity');
  });
});
