import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));

const { deliver, privatePush } = await import('./push-devices');

const target = (id: string, email: string, env: string | null = 'production') => ({
  id,
  ownerEmail: email,
  apnsToken: id.padEnd(64, '0'),
  apnsEnv: env,
});

describe('deliver', () => {
  it('redacts personal preview content by default and preserves explicit opt-in', async () => {
    const message = { title: 'Sam is home', body: '1234 steps at Private Place', userInfo: { category: 'family-steps', url: 'sr://family/steps', location: 'Private Place' } };
    const send = vi.fn(async (_token: string, _message: unknown, _env?: string | null) => ({ ok: true, status: 200 }));
    await deliver([target('a', 'sam@example.test'), { ...target('b', 'alex@example.test'), notificationDetails: true }], message, send, async () => {});
    expect(send.mock.calls[0][1]).toEqual(privatePush(message));
    expect(JSON.stringify(send.mock.calls[0][1])).not.toMatch(/Sam|1234|Private Place/);
    expect(send.mock.calls[1][1]).toEqual(message);
  });
  it('reports who it reached, by lower-cased email, and forgets only dead tokens', async () => {
    const forgotten: string[] = [];
    const send = vi.fn(async (token: string, _message: unknown, _env?: string | null) =>
      token.startsWith('a')
        ? { ok: true, status: 200 }
        : token.startsWith('b')
          ? { ok: false, status: 410, reason: 'Unregistered' }
          : { ok: false, status: 503, reason: 'ServiceUnavailable' },
    );
    const out = await deliver(
      [target('a1', 'Sam@Example.test'), target('b1', 'alex@example.test'), target('c1', 'robin@example.test', 'sandbox')],
      { title: 't', body: 'b' },
      send,
      async (id) => {
        forgotten.push(id);
      },
    );
    expect([...out.reached]).toEqual(['sam@example.test']);
    expect(out).toMatchObject({ sent: 1, failed: 2 });
    expect(forgotten).toEqual(['b1']);
    expect(send.mock.calls[2][2]).toBe('sandbox');
  });
});

describe('privatePush — a silent background push', () => {
  it('stays silent: nothing on the lock screen to hide, and it must not become an alert', () => {
    const message = { title: '', body: '', background: true, category: 'family-report', ttlSeconds: 120, userInfo: { category: 'family-report', reason: 'steps' } };
    expect(privatePush(message)).toEqual(message);
  });
});

describe('privatePush — the family alarm', () => {
  it('still rings loudly, but keeps the name, message and position off the lock screen', () => {
    const message = {
      title: 'Sam raised the alarm', body: 'At Private Place', category: 'family-alarm', threadId: 'family-alarm',
      level: 'critical' as const, sound: { critical: 1 as const, name: 'sr-siren.caf', volume: 1 }, collapseId: 'alarm-a1',
      ttlSeconds: 1800, userInfo: { category: 'family-alarm', alarmId: 'a1', kind: 'siren', name: 'Sam', lat: 51.5, lon: -0.1, at: '2026-10-02T12:00:00.000Z' },
    };
    const p = privatePush(message);
    expect(p).toMatchObject({ title: 'Family alarm', level: 'critical', sound: message.sound, collapseId: 'alarm-a1', ttlSeconds: 1800 });
    expect(p.userInfo).toEqual({ category: 'family-alarm', alarmId: 'a1', kind: 'siren', at: '2026-10-02T12:00:00.000Z' });
    expect(JSON.stringify(p)).not.toMatch(/Sam|Private Place|51\.5/);
  });
});

describe('privatePush — the Bat phone', () => {
  it('rings as an urgent family alert, without where, battery or who', () => {
    const message = {
      title: 'Bat phone — Sam', body: 'At Private Place · battery 23% · about 14 min drive from you', category: 'family-alarm',
      threadId: 'family-alarm', level: 'time-sensitive' as const, sound: 'default', collapseId: 'alarm-a1', ttlSeconds: 1800,
      userInfo: { category: 'family-alarm', alarmId: 'a1', kind: 'quiet', name: 'Sam', place: 'Private Place', battery: 0.23, lat: 51.5, lon: -0.1, at: '2026-10-27T12:00:00.000Z' },
    };
    const p = privatePush(message);
    expect(p).toMatchObject({ title: 'Bat phone', level: 'time-sensitive', sound: 'default', collapseId: 'alarm-a1', category: 'family-alarm' });
    expect(p.userInfo).toEqual({ category: 'family-alarm', alarmId: 'a1', kind: 'quiet', at: '2026-10-27T12:00:00.000Z' });
    expect(JSON.stringify(p)).not.toMatch(/Sam|Private Place|23|51\.5/);
  });
});

describe('privatePush — the Bat phone message', () => {
  it('stays time-sensitive with an ordinary sound, without who, where or battery', () => {
    const message = {
      title: 'Bat phone — Sam', body: 'I need you.\nPrivate Place · battery 23%\nhttps://maps.apple.com/?ll=51.50000,-0.10000',
      category: 'family-msg', threadId: 'family-msg', level: 'time-sensitive' as const, sound: 'default', relevance: 1,
      collapseId: 'msg-m1', ttlSeconds: 86_400, userInfo: { category: 'family-msg', messageId: 'm1', kind: 'bat-phone' },
    };
    const p = privatePush(message);
    expect(p).toMatchObject({ title: 'Bat phone', level: 'time-sensitive', sound: 'default', ttlSeconds: 86_400, category: 'family-msg' });
    expect(p.userInfo).toEqual({ category: 'family-msg', messageId: 'm1', kind: 'bat-phone' });
    expect(JSON.stringify(p)).not.toMatch(/Sam|Private Place|23|51\.5/);
  });
});

describe('privatePush — game pushes', () => {
  it('an invite keeps time-sensitive, the lobby expiry and the room, but not who invited', () => {
    const message = {
      title: 'Sam invited you to Chess', body: 'Easy, with Sam and Robin. Tap to join.', category: 'game', threadId: 'game',
      level: 'time-sensitive' as const, relevance: 1, collapseId: 'game-g1', ttlSeconds: 120,
      userInfo: { roomId: 'g1', game: 'chess', category: 'game' },
    };
    const p = privatePush(message);
    expect(p).toMatchObject({ title: 'Game invite', level: 'time-sensitive', ttlSeconds: 120, collapseId: 'game-g1', category: 'game' });
    expect(p.userInfo).toEqual({ category: 'game', roomId: 'g1', game: 'chess' });
    expect(JSON.stringify(p)).not.toMatch(/Sam|Robin/);
  });
  it('a turn reads as a turn', () => {
    const p = privatePush({ title: 'Your move in Homestead', body: 'Sam rolled a 9.', category: 'game', level: 'active', ttlSeconds: 3600,
      userInfo: { roomId: 'g2', game: 'homestead', category: 'game', kind: 'turn' } });
    expect(p).toMatchObject({ title: 'Your move', ttlSeconds: 3600 });
    expect(JSON.stringify(p)).not.toMatch(/Sam/);
  });
});

describe('privatePush — anything else', () => {
  it('hides the words but keeps how urgent it is and how long Apple keeps trying', () => {
    const p = privatePush({ title: 'Sam left school', body: 'Private Place', category: 'household', level: 'time-sensitive', ttlSeconds: 900,
      userInfo: { category: 'household' } });
    expect(p).toMatchObject({ title: 'Strange Ramblings', level: 'time-sensitive', ttlSeconds: 900 });
    expect(JSON.stringify(p)).not.toMatch(/Sam|Private Place/);
  });
});
