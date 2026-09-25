import { describe, expect, it } from 'vitest';
import { newSignals, parseSignalHistory, parseSignalState, signalDevice, signalKind } from './signals';

// Shapes copied from homeserv's HA 2026.9.3 on 2026-09-25.
const st = (entity_id: string, state: string, at: string, attributes: Record<string, unknown> = {}, updated?: string) => ({
  entity_id,
  state,
  attributes,
  last_changed: at,
  last_updated: updated ?? at,
});

describe('signalKind', () => {
  it('tells the Echo entities apart by suffix', () => {
    expect(signalKind('sensor.john_s_echo_temperature')).toBe('temperature');
    expect(signalKind('sensor.john_s_echo_illuminance')).toBe('illuminance');
    expect(signalKind('binary_sensor.john_s_echo_motion')).toBe('motion');
    expect(signalKind('sensor.soundbar_next_alarm')).toBe('alarm');
    expect(signalKind('sensor.fins_echo_next_timer')).toBe('timer');
    expect(signalKind('sensor.fins_echo_next_reminder')).toBe('reminder');
    expect(signalKind('media_player.rorys_room_rorys_alexa')).toBe('media');
  });
  it('ignores the rest of the integration', () => {
    expect(signalKind('binary_sensor.soundbar_connectivity')).toBeNull();
    expect(signalKind('event.soundbar_voice_event')).toBeNull();
    expect(signalKind('switch.soundbar_do_not_disturb')).toBeNull();
  });
});

describe('signalDevice', () => {
  it('strips the sensor part of the friendly name', () => {
    expect(signalDevice('sensor.john_s_echo_temperature', "John's Echo Temperature")).toBe("John's Echo");
    expect(signalDevice('sensor.soundbar_next_alarm', 'SoundBar Next alarm')).toBe('SoundBar');
    expect(signalDevice('media_player.rorys_room_rorys_alexa', 'Rorys Alexa')).toBe('Rorys Alexa');
  });
  it('falls back to the entity id', () => {
    expect(signalDevice('binary_sensor.john_s_echo_motion', undefined)).toBe('john s echo');
  });
});

describe('parseSignalState', () => {
  it('reads a temperature, converting Fahrenheit', () => {
    const c = parseSignalState(st('sensor.john_s_echo_temperature', '18.5', '2026-09-25T18:00:00Z', { unit_of_measurement: '°C' }));
    expect(c).toMatchObject({ kind: 'temperature', value: 18.5, text: null, device: 'john s echo' });
    const f = parseSignalState(st('sensor.john_s_echo_temperature', '68', '2026-09-25T18:00:00Z', { unit_of_measurement: '°F' }));
    expect(f?.value).toBe(20);
  });
  it('drops an unavailable sensor reading', () => {
    expect(parseSignalState(st('sensor.john_s_echo_illuminance', 'unavailable', '2026-09-25T18:00:00Z'))).toBeNull();
    expect(parseSignalState(st('binary_sensor.john_s_echo_motion', 'unavailable', '2026-09-25T18:00:00Z'))).toBeNull();
  });
  it('reads an alarm as its due time and ignores unavailable', () => {
    expect(parseSignalState(st('sensor.soundbar_next_alarm', 'unavailable', '2026-09-25T18:00:00Z'))).toBeNull();
    const set = parseSignalState(st('sensor.soundbar_next_alarm', '2026-09-26T05:30:00+00:00', '2026-09-25T21:00:00Z'));
    expect(set?.text).toBe('2026-09-26T05:30:00.000Z');
  });
  it('logs a track only while playing, stamped by last_updated', () => {
    const attrs = { friendly_name: 'Rorys Alexa', media_title: 'Little Talks', media_artist: 'Of Monsters And Men', media_album_name: 'Upbeat Indie Hits', media_content_type: 'music' };
    const r = parseSignalState(st('media_player.rorys_room_rorys_alexa', 'playing', '2026-09-24T17:50:00Z', attrs, '2026-09-24T17:54:07Z'));
    expect(r).toMatchObject({
      kind: 'media',
      device: 'Rorys Alexa',
      text: 'Little Talks',
      detail: { artist: 'Of Monsters And Men', album: 'Upbeat Indie Hits', contentType: 'music' },
    });
    expect(r?.occurredAt.toISOString()).toBe('2026-09-24T17:54:07.000Z');
    expect(parseSignalState(st('media_player.rorys_room_rorys_alexa', 'idle', '2026-09-24T20:49:07Z', attrs))).toBeNull();
  });
  it('keys a row by entity and time', () => {
    const r = parseSignalState(st('sensor.john_s_echo_temperature', '18.5', '2026-09-25T18:00:00Z'));
    expect(r?.id).toBe('sensor.john_s_echo_temperature|2026-09-25T18:00:00.000Z');
  });
});

describe('parseSignalHistory', () => {
  it('carries entity_id forward and sorts oldest first', () => {
    const rows = parseSignalHistory(
      [
        [st('sensor.john_s_echo_temperature', '19', '2026-09-25T10:00:00Z'), { state: '18.5', last_changed: '2026-09-25T09:00:00Z' }],
        [st('binary_sensor.john_s_echo_motion', 'on', '2026-09-25T09:30:00Z')],
      ],
      { 'sensor.john_s_echo_temperature': 'Kitchen' },
    );
    expect(rows.map((r) => [r.entityId, r.value ?? r.text, r.room])).toEqual([
      ['sensor.john_s_echo_temperature', 18.5, 'Kitchen'],
      ['binary_sensor.john_s_echo_motion', 'on', null],
      ['sensor.john_s_echo_temperature', 19, 'Kitchen'],
    ]);
  });
  it('survives junk', () => {
    expect(parseSignalHistory(null)).toEqual([]);
    expect(parseSignalHistory([null, [null]])).toEqual([]);
  });
});

describe('newSignals', () => {
  const t = (v: string, at: string) => parseSignalState(st('sensor.john_s_echo_temperature', v, at))!;
  const alarm = (v: string, at: string) => parseSignalState(st('sensor.soundbar_next_alarm', v, at))!;

  it('keeps changes only, across an unavailable blink', () => {
    const rows = [t('18.5', '2026-09-25T10:00:00Z'), t('18.5', '2026-09-25T10:05:00Z'), t('19', '2026-09-25T10:10:00Z'), t('18.5', '2026-09-25T10:20:00Z')];
    expect(newSignals(rows, {}).map((r) => r.value)).toEqual([18.5, 19, 18.5]);
  });
  it('skips the window-opening value already held', () => {
    expect(newSignals([t('18.5', '2026-09-25T10:00:00Z')], { 'sensor.john_s_echo_temperature': { text: null, value: 18.5 } })).toEqual([]);
  });
  it('keeps one alarm through the nightly network blip', () => {
    // Fins Echo, 2026-09-03/04 as HA recorded it: set, blip at 03:00, back, rang.
    const rows = [
      alarm('2026-09-04T06:00:00Z', '2026-09-03T19:58:51Z'),
      alarm('unavailable', '2026-09-04T01:59:00Z'),
      alarm('2026-09-04T06:00:00Z', '2026-09-04T02:04:00Z'),
      alarm('unavailable', '2026-09-04T05:04:00Z'),
      alarm('2026-09-05T06:00:00Z', '2026-09-04T20:00:00Z'),
    ].filter(Boolean);
    expect(newSignals(rows, {}).map((r) => r.text)).toEqual(['2026-09-04T06:00:00.000Z', '2026-09-05T06:00:00.000Z']);
  });
  it('drops a duplicate id from an overlapping read', () => {
    const a = t('18.5', '2026-09-25T10:00:00Z');
    expect(newSignals([a, { ...a }], {})).toHaveLength(1);
  });
  it('tells two tracks with the same title apart by artist', () => {
    const m = (title: string, artist: string, at: string) =>
      parseSignalState(st('media_player.x', 'playing', at, { media_title: title, media_artist: artist }))!;
    expect(newSignals([m('Gloria', 'The Snuts', '2026-09-25T10:00:00Z'), m('Gloria', 'Them', '2026-09-25T10:03:00Z')], {})).toHaveLength(2);
  });
});
