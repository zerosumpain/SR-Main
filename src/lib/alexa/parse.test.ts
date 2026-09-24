import { describe, expect, it } from 'vitest';
import { deviceName, dropReplays, isVoiceEventEntity, newSpeech, parseVoiceHistory, parseVoiceState } from './parse';

const fired = (entity_id: string, state: string, attributes: Record<string, unknown> = {}) => ({
  entity_id,
  state,
  attributes: {
    event_types: ['triggered'],
    event_type: 'triggered',
    friendly_name: "John's Echo Studio Voice event",
    voice_command: 'what is the weather',
    voice_reply: 'Right now in London it is 14 degrees.',
    intent: 'GetWeatherForecastIntent',
    person_first_name: 'John',
    person_type: 'ADULT',
    ...attributes,
  },
});

describe('isVoiceEventEntity', () => {
  it('matches only event.*_voice_event', () => {
    expect(isVoiceEventEntity('event.kitchen_john_s_echo_studio_voice_event')).toBe(true);
    expect(isVoiceEventEntity('event.front_door_ding')).toBe(false);
    expect(isVoiceEventEntity('sensor.x_voice_event')).toBe(false);
  });
});

describe('deviceName', () => {
  it('strips the HA suffix from the friendly name', () => {
    expect(deviceName('event.a_voice_event', "John's Echo Studio Voice event")).toBe("John's Echo Studio");
  });
  it('falls back to the entity id', () => {
    expect(deviceName('event.fins_echo_voice_event', undefined)).toBe('fins echo');
  });
});

describe('parseVoiceState', () => {
  it('reads a fired event', () => {
    const row = parseVoiceState(fired('event.k_voice_event', '2026-09-24T18:01:02.345+00:00'), {
      'event.k_voice_event': 'Kitchen',
    });
    expect(row).toMatchObject({
      id: 'event.k_voice_event|2026-09-24T18:01:02.345Z',
      device: "John's Echo Studio",
      room: 'Kitchen',
      command: 'what is the weather',
      intent: 'GetWeatherForecastIntent',
      personName: 'John',
    });
    expect(row?.occurredAt.toISOString()).toBe('2026-09-24T18:01:02.345Z');
  });

  it('drops never-fired and unavailable states', () => {
    expect(parseVoiceState(fired('event.k_voice_event', 'unknown'))).toBeNull();
    expect(parseVoiceState(fired('event.k_voice_event', 'unavailable'))).toBeNull();
  });

  it('drops a fire with no command', () => {
    expect(parseVoiceState(fired('event.k_voice_event', '2026-09-24T18:01:02Z', { voice_command: '  ' }))).toBeNull();
  });

  it('keeps blank replies and unknown speakers as null', () => {
    const row = parseVoiceState(
      fired('event.k_voice_event', '2026-09-24T18:01:02Z', { voice_reply: '', person_first_name: null }),
    );
    expect(row?.reply).toBeNull();
    expect(row?.personName).toBeNull();
  });
});

describe('parseVoiceHistory', () => {
  it('dedupes the window-start repeat and carries entity ids forward', () => {
    const a = fired('event.k_voice_event', '2026-09-24T18:01:02Z');
    const rows = parseVoiceHistory([
      [a, { ...a }, { state: '2026-09-24T18:05:00Z', attributes: { ...a.attributes, voice_command: 'stop' } }],
      [fired('event.front_door_ding', '2026-09-24T18:01:02Z')],
      'junk',
    ]);
    expect(rows.map((r) => r.command)).toEqual(['what is the weather', 'stop']);
    expect(rows[1].entityId).toBe('event.k_voice_event');
  });
});

describe('dropReplays', () => {
  const row = (entityId: string, iso: string, command: string, reply: string | null = null) => ({
    id: `${entityId}|${iso}`,
    entityId,
    device: 'd',
    room: null,
    occurredAt: new Date(iso),
    command,
    reply,
    intent: null,
    personName: null,
    personType: null,
  });

  it('drops a restart replay of the stored last record', () => {
    const out = dropReplays([row('e.a', '2026-09-25T09:00:00Z', 'what time is it', "It's 7:46 am.")], {
      'e.a': { id: 'e.a|2026-09-24T06:46:00.000Z', command: 'what time is it', reply: "It's 7:46 am." },
    });
    expect(out).toEqual([]);
  });

  it('drops the window-start row that is already held', () => {
    const held = row('e.a', '2026-09-24T06:46:00Z', 'stop');
    expect(dropReplays([held], { 'e.a': { id: held.id, command: 'x', reply: null } })).toEqual([]);
  });

  it('keeps new speech, and compares within the batch in time order', () => {
    const out = dropReplays(
      [
        row('e.a', '2026-09-25T09:05:00Z', 'play radio 2'),
        row('e.a', '2026-09-25T09:00:00Z', 'what time is it', 'Nine.'),
        row('e.a', '2026-09-25T09:10:00Z', 'play radio 2'),
        row('e.b', '2026-09-25T09:10:00Z', 'play radio 2'),
      ],
      {},
    );
    expect(out.map((r) => `${r.entityId} ${r.command}`)).toEqual(['e.a what time is it', 'e.a play radio 2', 'e.b play radio 2']);
  });
});

describe('newSpeech', () => {
  const row = (entityId: string, iso: string, command: string, reply: string | null = null) => ({
    id: `${entityId}|${iso}`,
    entityId,
    device: 'd',
    room: null,
    occurredAt: new Date(iso),
    command,
    reply,
    intent: null,
    personName: null,
    personType: null,
  });
  const fence = Date.parse('2026-09-24T18:00:00Z');

  // 2026-09-24: a device with no stored row had its restart replay stored as
  // new speech, because the opening state that proves it a replay was fenced
  // off before the comparison.
  it('lets a state from before the fence catch a replay after it', () => {
    const out = newSpeech(
      [
        row('e.k', '2026-09-24T17:59:57.270Z', "what's the b. b. c. news"),
        row('e.k', '2026-09-24T20:55:34.554Z', "what's the b. b. c. news"),
        row('e.j', '2026-09-24T17:59:57.270Z', 'alexa stop the music', 'Goodbye.'),
        row('e.j', '2026-09-24T20:55:34.554Z', 'alexa will it rain tomorrow', 'Probably not.'),
      ],
      {},
      fence,
    );
    expect(out.map((r) => `${r.entityId} ${r.command}`)).toEqual(['e.j alexa will it rain tomorrow']);
  });
});
