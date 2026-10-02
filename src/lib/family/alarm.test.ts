import { describe, expect, it } from 'vitest';
import {
  alarmPush,
  alarmRecipients,
  cancelPush,
  decideRaise,
  mayCancel,
  parseAlarmInput,
  type AlarmRecord,
} from './alarm';
import { buildPayload } from '$lib/server/apns';

const OWNERS = ['owner@example.test', 'owner.alt@example.test'];
const isOwner = (e: string) => OWNERS.includes(e.trim().toLowerCase());
const T0 = new Date('2026-10-02T12:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

function alarm(over: Partial<AlarmRecord> = {}): AlarmRecord {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    fromEmail: 'kid@example.test',
    fromName: 'Kid',
    kind: 'siren',
    message: null,
    lat: 51.5,
    lon: -0.12,
    accuracy: 12,
    recipientCount: 2,
    pushedCount: 1,
    createdAt: T0,
    cancelledAt: null,
    cancelledByEmail: null,
    ...over,
  };
}

describe('parseAlarmInput', () => {
  it('reads the contract and trims the message to 140', () => {
    const r = parseAlarmInput({ kind: 'morse', message: `  ${'x'.repeat(200)}  `, position: { lat: 51.5, lon: -0.1, accuracy: 8 } });
    expect(r).toEqual({ kind: 'morse', message: 'x'.repeat(140), position: { lat: 51.5, lon: -0.1, accuracy: 8 } });
  });

  it('defaults to siren, and an empty message is none', () => {
    expect(parseAlarmInput({ message: '   ' })).toEqual({ kind: 'siren', message: null, position: null });
  });

  it('refuses an unknown kind and a non-object body', () => {
    expect(parseAlarmInput({ kind: 'klaxon' })).toHaveProperty('error');
    expect(parseAlarmInput(null)).toHaveProperty('error');
    expect(parseAlarmInput([1])).toHaveProperty('error');
  });

  it('drops a position that is not a place, and still raises', () => {
    expect(parseAlarmInput({ kind: 'siren', position: { lat: -180, lon: -180 } })).toEqual({ kind: 'siren', message: null, position: null });
    expect(parseAlarmInput({ kind: 'siren', position: { lat: '51', lon: 0 } })).toMatchObject({ position: null });
    expect(parseAlarmInput({ kind: 'siren', position: { lat: 1, lon: 2, accuracy: -1 } })).toMatchObject({ position: { lat: 1, lon: 2, accuracy: null } });
  });
});

describe('decideRaise (rate limit)', () => {
  it('raises when the sender has no alarm', () => {
    expect(decideRaise(null, T0)).toEqual({ kind: 'new' });
  });

  it('answers a repeat press with the alarm still sounding, however late in its 30 minutes', () => {
    const a = alarm();
    expect(decideRaise(a, at(5_000))).toEqual({ kind: 'existing', alarm: a });
    expect(decideRaise(a, at(29 * 60_000))).toEqual({ kind: 'existing', alarm: a });
  });

  it('limits a new alarm to one per 30 s after the last was stood down', () => {
    const a = alarm({ cancelledAt: at(3_000) });
    expect(decideRaise(a, at(10_000))).toEqual({ kind: 'limited', retryAfterSeconds: 20 });
    expect(decideRaise(a, at(30_000))).toEqual({ kind: 'new' });
  });

  it('raises afresh once the last alarm has expired', () => {
    expect(decideRaise(alarm(), at(30 * 60_000))).toEqual({ kind: 'new' });
  });
});

describe('alarmRecipients (who is rung)', () => {
  const family = ['owner@example.test', 'kid@example.test', 'parent@example.test'];

  it('a member raising it rings everybody else, the owner included, owner emails counted once', () => {
    const r = alarmRecipients('Kid@Example.test', family, OWNERS, isOwner);
    expect(r.emails.sort()).toEqual(['owner.alt@example.test', 'owner@example.test', 'parent@example.test']);
    expect(r.people).toBe(2);
  });

  it('the owner raising it rings every member and none of the owner’s own phones', () => {
    const r = alarmRecipients('owner.alt@example.test', family, OWNERS, isOwner);
    expect(r.emails.sort()).toEqual(['kid@example.test', 'parent@example.test']);
    expect(r.people).toBe(2);
  });
});

describe('alarmPush (payload shape)', () => {
  it('is time-sensitive with the kind’s bundled sound by default', () => {
    const p = JSON.parse(buildPayload(alarmPush(alarm({ message: 'At the station' }), 'f_kid', false)));
    expect(p.aps).toEqual({
      alert: { title: 'Kid raised the alarm', body: 'At the station' },
      sound: 'sr-siren.caf',
      'interruption-level': 'time-sensitive',
      category: 'family-alarm',
      'thread-id': 'family-alarm',
      'relevance-score': 1,
    });
    expect(p).toMatchObject({
      category: 'family-alarm',
      alarmId: '11111111-2222-3333-4444-555555555555',
      from: 'f_kid',
      name: 'Kid',
      kind: 'siren',
      lat: 51.5,
      lon: -0.12,
      at: '2026-10-02T12:00:00.000Z',
    });
  });

  it('is critical, full volume, only when critical alerts are switched on', () => {
    const p = JSON.parse(buildPayload(alarmPush(alarm({ kind: 'morse' }), 'f_kid', true)));
    expect(p.aps.sound).toEqual({ critical: 1, name: 'sr-morse.caf', volume: 1 });
    expect(p.aps['interruption-level']).toBe('critical');
    expect(p.aps.alert.body).toBe('They pressed the alarm on the SR app. Open to see where they are.');
  });

  it('collapses on the alarm id, so the stand-down replaces it', () => {
    const a = alarm();
    expect(alarmPush(a, 'f_kid', false).collapseId).toBe(`alarm-${a.id}`);
    const c = cancelPush(a, 'f_kid', null);
    expect(c.collapseId).toBe(`alarm-${a.id}`);
    expect(c.category).toBe('family-alarm-cancel');
    expect(c.level).toBe('active');
    expect(c.title).toBe('Kid is OK — alarm stood down');
  });
});

describe('mayCancel', () => {
  const a = alarm({ fromEmail: 'kid@example.test' });

  it('lets the sender stand it down', () => {
    expect(mayCancel(a, 'KID@example.test', false, isOwner)).toBe(true);
  });

  it('lets the owner stand anyone’s down', () => {
    expect(mayCancel(a, 'owner@example.test', true, isOwner)).toBe(true);
  });

  it('refuses any other member, a parent included', () => {
    expect(mayCancel(a, 'parent@example.test', false, isOwner)).toBe(false);
  });

  it('treats the owner’s emails as one person', () => {
    expect(mayCancel(alarm({ fromEmail: 'owner@example.test' }), 'owner.alt@example.test', false, isOwner)).toBe(true);
  });
});
