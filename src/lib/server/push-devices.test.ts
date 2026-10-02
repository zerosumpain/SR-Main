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
