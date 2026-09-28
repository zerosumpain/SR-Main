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
