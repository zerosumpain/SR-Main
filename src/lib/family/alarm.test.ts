import { describe, expect, it } from 'vitest';
import {
  alarmPush,
  alarmRecipients,
  alarmView,
  cancelPush,
  decideRaise,
  driveMinutesByEmail,
  driveText,
  estimateDriveMinutes,
  mayCancel,
  parseAlarmInput,
  quietBody,
  quietMessageBody,
  quietPush,
  quietPushes,
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
    battery: null,
    place: null,
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
    expect(r).toEqual({ kind: 'morse', message: 'x'.repeat(140), position: { lat: 51.5, lon: -0.1, accuracy: 8 }, battery: null, place: null });
  });

  it('defaults to siren, and an empty message is none', () => {
    expect(parseAlarmInput({ message: '   ' })).toEqual({ kind: 'siren', message: null, position: null, battery: null, place: null });
  });

  it('refuses an unknown kind and a non-object body', () => {
    expect(parseAlarmInput({ kind: 'klaxon' })).toHaveProperty('error');
    expect(parseAlarmInput(null)).toHaveProperty('error');
    expect(parseAlarmInput([1])).toHaveProperty('error');
  });

  it('drops a position that is not a place, and still raises', () => {
    expect(parseAlarmInput({ kind: 'siren', position: { lat: -180, lon: -180 } })).toMatchObject({ kind: 'siren', message: null, position: null });
    expect(parseAlarmInput({ kind: 'siren', position: { lat: '51', lon: 0 } })).toMatchObject({ position: null });
    expect(parseAlarmInput({ kind: 'siren', position: { lat: 1, lon: 2, accuracy: -1 } })).toMatchObject({ position: { lat: 1, lon: 2, accuracy: null } });
  });
});

describe('parseAlarmInput — the Bat phone', () => {
  it('reads kind quiet with the battery and place', () => {
    expect(parseAlarmInput({ kind: 'quiet', battery: 0.23, place: '  Elton Parade, Darlington ', position: { lat: 54.5, lon: -1.55 } })).toEqual({
      kind: 'quiet', message: null, position: { lat: 54.5, lon: -1.55, accuracy: null }, battery: 0.23, place: 'Elton Parade, Darlington',
    });
  });

  it('drops a battery that is not 0–1 and a place that is not text, and cuts a long place to 80', () => {
    for (const battery of [-1, 1.5, '0.5', Number.NaN, null]) {
      expect(parseAlarmInput({ kind: 'quiet', battery })).toMatchObject({ kind: 'quiet', battery: null });
    }
    expect(parseAlarmInput({ kind: 'quiet', battery: 0 })).toMatchObject({ battery: 0 });
    expect(parseAlarmInput({ kind: 'quiet', battery: 1 })).toMatchObject({ battery: 1 });
    expect(parseAlarmInput({ kind: 'quiet', place: 42 })).toMatchObject({ place: null });
    expect(parseAlarmInput({ kind: 'quiet', place: '   ' })).toMatchObject({ place: null });
    expect(parseAlarmInput({ kind: 'quiet', place: 'p'.repeat(120) })).toMatchObject({ place: 'p'.repeat(80) });
  });

  it('takes battery and place on the loud kinds too', () => {
    expect(parseAlarmInput({ kind: 'siren', battery: 0.5, place: 'Home' })).toMatchObject({ kind: 'siren', battery: 0.5, place: 'Home' });
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

describe('decideRaise — escalating a Bat phone', () => {
  const quiet = alarm({ kind: 'quiet' });

  it('rings the siren or morse at once while their Bat phone is active — no gap', () => {
    expect(decideRaise(quiet, at(1_000), 'siren')).toEqual({ kind: 'new' });
    expect(decideRaise(quiet, at(29 * 60_000), 'morse')).toEqual({ kind: 'new' });
  });

  it('answers every other press with the active alarm, as before', () => {
    expect(decideRaise(quiet, at(1_000), 'quiet')).toEqual({ kind: 'existing', alarm: quiet });
    const siren = alarm({ kind: 'siren' });
    expect(decideRaise(siren, at(1_000), 'quiet')).toEqual({ kind: 'existing', alarm: siren });
    expect(decideRaise(siren, at(1_000), 'morse')).toEqual({ kind: 'existing', alarm: siren });
  });

  it('keeps the gap after a Bat phone that was stood down', () => {
    expect(decideRaise(alarm({ kind: 'quiet', cancelledAt: at(3_000) }), at(10_000), 'siren')).toEqual({ kind: 'limited', retryAfterSeconds: 20 });
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

// Points due north of a start, so the straight-line distance is exact.
const START = { lat: 54.5, lon: -1.55 };
const north = (km: number) => ({ lat: START.lat + (km / 6371) * (180 / Math.PI), lon: START.lon });
const road = (km: number) => north(km / 1.3);

describe('estimateDriveMinutes', () => {
  it('drives the first 5 road-km at 25 km/h', () => {
    expect(estimateDriveMinutes(START, road(3.25))).toBe(8); // 7.8 min
  });

  it('then 45 km/h to 30 km', () => {
    expect(estimateDriveMinutes(START, road(13))).toBe(23); // 12 + 10.7
  });

  it('then 70 km/h beyond', () => {
    expect(estimateDriveMinutes(START, road(65))).toBe(76); // 12 + 33.3 + 30
    expect(estimateDriveMinutes(START, road(130))).toBe(132); // 12 + 33.3 + 85.7
  });

  it('is at least a minute, and never shorter for a longer trip', () => {
    expect(estimateDriveMinutes(START, START)).toBe(1);
    expect(estimateDriveMinutes(START, road(4.9))).toBeLessThanOrEqual(estimateDriveMinutes(START, road(5.1)));
    expect(estimateDriveMinutes(START, road(29.9))).toBeLessThanOrEqual(estimateDriveMinutes(START, road(30.1)));
  });

  it('reads as minutes under an hour and a half, hours and minutes after', () => {
    expect(driveText(14)).toBe('about 14 min drive from you');
    expect(driveText(89)).toBe('about 89 min drive from you');
    expect(driveText(90)).toBe('about 1 h 30 drive from you');
    expect(driveText(132)).toBe('about 2 h 12 drive from you');
    expect(driveText(120)).toBe('about 2 h drive from you');
  });
});

describe('driveMinutesByEmail', () => {
  const subjects: Record<string, string> = { 'owner@example.test': 'john', 'kid@example.test': 'kid' };
  const subjectOf = (e: string) => subjects[e] ?? null;
  const now = new Date('2026-10-27T12:00:00Z');
  const positions = [
    { subject: 'john', ...road(13), at: '2026-10-27T11:00:00.000Z' },
    { subject: 'kid', ...road(3.25), at: '2026-10-27T05:59:00.000Z' }, // over 6 h old
  ];

  it('estimates for each recipient with a fresh fix, and nobody else', () => {
    const m = driveMinutesByEmail(['owner@example.test', 'kid@example.test', 'parent@example.test'], START, subjectOf, positions, now);
    expect([...m]).toEqual([['owner@example.test', 23]]);
  });

  it('estimates nothing for an alarm without a position', () => {
    expect(driveMinutesByEmail(['owner@example.test'], { lat: null, lon: null }, subjectOf, positions, now).size).toBe(0);
  });
});

describe('the Bat phone push', () => {
  const bat = alarm({ kind: 'quiet', battery: 0.23, place: 'Elton Parade, Darlington' });

  it('says where, battery and drive, each only when known', () => {
    const base = { name: 'Kid', place: 'Elton Parade, Darlington', battery: 0.23, driveMinutes: 14, message: null };
    expect(quietBody(base)).toBe('At Elton Parade, Darlington · battery 23% · about 14 min drive from you');
    expect(quietBody({ ...base, place: null })).toBe('battery 23% · about 14 min drive from you');
    expect(quietBody({ ...base, place: null, driveMinutes: null })).toBe('battery 23%');
    expect(quietBody({ ...base, battery: null, driveMinutes: null })).toBe('At Elton Parade, Darlington');
  });

  it('falls back to a plain "needs you", and puts their message on its own line', () => {
    const none = { name: 'Kid', place: null, battery: null, driveMinutes: null, message: null };
    expect(quietBody(none)).toBe('Kid needs you. Open SR to see where they are.');
    expect(quietBody({ ...none, message: 'Come now' })).toBe('Kid needs you. Open SR to see where they are.\nCome now');
    expect(quietBody({ ...none, battery: 0.05, message: 'Come now' })).toBe('battery 5%\nCome now');
  });

  it('is time-sensitive with the default sound — never the siren — and carries battery and place', () => {
    const p = JSON.parse(buildPayload(quietPush(bat, 'f_kid', false, 14)));
    expect(p.aps).toEqual({
      alert: { title: 'Bat phone — Kid', body: 'At Elton Parade, Darlington · battery 23% · about 14 min drive from you' },
      sound: 'default',
      'interruption-level': 'time-sensitive',
      category: 'family-alarm',
      'thread-id': 'family-alarm',
      'relevance-score': 1,
    });
    expect(p).toMatchObject({
      category: 'family-alarm', alarmId: bat.id, from: 'f_kid', name: 'Kid', kind: 'quiet', lat: 51.5, lon: -0.12,
      battery: 0.23, place: 'Elton Parade, Darlington', at: '2026-10-02T12:00:00.000Z',
    });
  });

  it('is critical at full volume with the default sound only when critical alerts are on, and collapses on the alarm', () => {
    const push = quietPush(bat, 'f_kid', true, null);
    expect(push.level).toBe('critical');
    expect(push.sound).toEqual({ critical: 1, name: 'default', volume: 1 });
    expect(push.collapseId).toBe(`alarm-${bat.id}`);
    expect(push.ttlSeconds).toBe(1800);
    expect(push.body).toBe('At Elton Parade, Darlington · battery 23%');
  });

  it('sends each recipient the drive from them, sharing a send where the text is the same', () => {
    const minutes = new Map([['owner@example.test', 14], ['owner.alt@example.test', 14], ['parent@example.test', 40]]);
    const pushes = quietPushes(['owner@example.test', 'owner.alt@example.test', 'parent@example.test', 'kid2@example.test'], bat, 'f_kid', false, minutes);
    expect(pushes.map((p) => [p.emails, p.message.body])).toEqual([
      [['owner@example.test', 'owner.alt@example.test'], 'At Elton Parade, Darlington · battery 23% · about 14 min drive from you'],
      [['parent@example.test'], 'At Elton Parade, Darlington · battery 23% · about 40 min drive from you'],
      [['kid2@example.test'], 'At Elton Parade, Darlington · battery 23%'],
    ]);
  });

  it('is recorded in msg family as one line', () => {
    expect(quietMessageBody(bat)).toBe('🦇 Bat phone — at Elton Parade, Darlington · battery 23%');
    expect(quietMessageBody({ ...bat, message: 'Come now' })).toBe('🦇 Bat phone — at Elton Parade, Darlington · battery 23%\nCome now');
    expect(quietMessageBody({ place: null, battery: null, message: null })).toBe('🦇 Bat phone');
  });

  it('shows battery and place in the alarm list', () => {
    expect(alarmView(bat, 'f_kid')).toMatchObject({ kind: 'quiet', battery: 0.23, place: 'Elton Parade, Darlington' });
    expect(alarmView(alarm(), 'f_kid')).toMatchObject({ battery: null, place: null });
  });
});
