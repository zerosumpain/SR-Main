import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listPilotDevices,
  pilotFailureText,
  pilotPairCode,
  revokePilotDevice,
  setPilotSharing,
  upsertPilotUser,
} from './companion-accounts';

type Call = { url: string; init: RequestInit };

function fake(status: number, body?: unknown) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const saved = { ...process.env };
beforeEach(() => {
  process.env.COMPANION_HOUSEHOLD_TOKEN = 'tok-123';
  process.env.COMPANION_URL = 'http://pilot.test:5295/';
});
afterEach(() => {
  process.env = { ...saved };
});

describe('the companion accounts client', () => {
  it('makes no request without a token', async () => {
    delete process.env.COMPANION_HOUSEHOLD_TOKEN;
    const f = fake(200, {});
    expect(await upsertPilotUser('a@b.com', 'A', f.impl)).toEqual({ ok: false, reason: 'unconfigured' });
    expect(f.calls).toHaveLength(0);
  });

  it('upserts a user with the household token, email lower-cased', async () => {
    const f = fake(201, { id: 7, email: 'jane@example.com', name: 'Jane', created: true });
    const r = await upsertPilotUser('Jane@Example.com', 'Jane', f.impl);
    expect(r).toEqual({ ok: true, value: { id: 7, email: 'jane@example.com', name: 'Jane', created: true } });
    const { url, init } = f.calls[0];
    expect(url).toBe('http://pilot.test:5295/api/apple/household/users');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'jane@example.com', name: 'Jane' });
  });

  it('reports a user in another family as a conflict', async () => {
    const f = fake(409, { error: 'other family' });
    expect(await upsertPilotUser('x@y.com', 'X', f.impl)).toEqual({ ok: false, reason: 'conflict', status: 409 });
  });

  it('mints a pair code and hands back the exact QR payload', async () => {
    const payload = '{"type":"sr-companion-pair","version":1,"server":"https://strangeramblings.com","code":"ABC"}';
    const f = fake(200, { code: 'ABC', payload, expiresIn: 600 });
    const r = await pilotPairCode('jane@example.com', f.impl);
    expect(r).toEqual({ ok: true, value: { code: 'ABC', payload, expiresIn: 600 } });
    expect(f.calls[0].url).toBe('http://pilot.test:5295/api/apple/household/pair-code');
  });

  it('treats a malformed pair-code answer as a failure, not a code', async () => {
    const f = fake(200, { nope: true });
    expect(await pilotPairCode('jane@example.com', f.impl)).toEqual({ ok: false, reason: 'bad-response' });
  });

  it('lists devices, dropping rows without an id or email', async () => {
    const f = fake(200, {
      devices: [
        { id: 'h1', email: 'Jane@Example.com', name: 'Jane', label: 'iPhone', created: '2026-09-01T00:00:00Z', expires: null, lastUsed: null },
        { id: '', email: 'x@y.com' },
        { email: 'no-id@y.com' },
      ],
    });
    const r = await listPilotDevices(f.impl);
    expect(r.ok && r.value).toEqual([
      { id: 'h1', email: 'jane@example.com', name: 'Jane', label: 'iPhone', created: '2026-09-01T00:00:00Z', expires: null, lastUsed: null },
    ]);
    expect(f.calls[0].init.method).toBe('GET');
  });

  it('revokes by id, url-encoded, and reads 204 as success', async () => {
    const f = fake(204);
    expect(await revokePilotDevice('a/b', f.impl)).toEqual({ ok: true, value: null });
    expect(f.calls[0].url).toBe('http://pilot.test:5295/api/apple/household/devices/a%2Fb');
    expect(f.calls[0].init.method).toBe('DELETE');
  });

  it('maps 404 on revoke to not-found', async () => {
    const f = fake(404, { error: 'no' });
    expect(await revokePilotDevice('zzz', f.impl)).toEqual({ ok: false, reason: 'not-found', status: 404 });
  });

  it('sets sharing, reading 0/1 as well as booleans', async () => {
    const on = fake(200, { sharing: 1 });
    expect(await setPilotSharing('jane@example.com', true, on.impl)).toEqual({ ok: true, value: { sharing: true } });
    expect(on.calls[0].init.method).toBe('PUT');
    expect(JSON.parse(String(on.calls[0].init.body))).toEqual({ email: 'jane@example.com', enabled: true });
    const off = fake(200, { sharing: false });
    expect(await setPilotSharing('jane@example.com', false, off.impl)).toEqual({ ok: true, value: { sharing: false } });
  });

  it('reads a wrong token as refused and a network error as unreachable', async () => {
    expect(await listPilotDevices(fake(401).impl)).toEqual({ ok: false, reason: 'refused', status: 401 });
    const boom = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await listPilotDevices(boom)).toEqual({ ok: false, reason: 'unreachable' });
    expect(await listPilotDevices(fake(502).impl)).toEqual({ ok: false, reason: 'unreachable', status: 502 });
  });

  it('says every failure in words', () => {
    for (const r of ['unconfigured', 'unreachable', 'refused', 'not-found', 'conflict', 'bad-response'] as const) {
      expect(pilotFailureText(r).length).toBeGreaterThan(10);
    }
  });
});
