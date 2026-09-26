import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deletePilotData,
  listPilotDevices,
  pilotDay,
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

describe('phase 2: deleting uploaded data', () => {
  it('posts the email, lower-cased, to household/data/delete and keeps the counts', async () => {
    const f = fake(200, { deleted: { health: 12, locations: 340, alerts: 1, junk: 'x' } });
    const r = await deletePilotData('Jane@Example.com', f.impl);
    expect(r).toEqual({ ok: true, value: { counts: { health: 12, locations: 340, alerts: 1 } } });
    expect(f.calls[0].url).toBe('http://pilot.test:5295/api/apple/household/data/delete');
    expect(f.calls[0].init.method).toBe('POST');
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ email: 'jane@example.com' });
  });

  it('accepts a bare {ok:true}', async () => {
    expect(await deletePilotData('a@b.com', fake(200, { ok: true }).impl)).toEqual({ ok: true, value: { counts: {} } });
  });

  it('never reports a deletion the pilot did not confirm', async () => {
    expect(await deletePilotData('a@b.com', fake(200, { nope: 1 }).impl)).toEqual({ ok: false, reason: 'bad-response' });
    expect(await deletePilotData('a@b.com', fake(404, { error: 'no' }).impl)).toEqual({
      ok: false,
      reason: 'not-found',
      status: 404,
    });
  });
});

describe('phase 2: one day', () => {
  // Made-up coordinates (51.0, -1.0): this repo is public.
  const TRACK = {
    date: '2026-09-20',
    from: 1_789_858_800,
    to: 1_789_945_200,
    points: [
      [-1.0, 51.0, 1_789_880_000, 8, 1, 1.4],
      [-1.001, 51.001, 1_789_880_030, 6, 1, 1.5],
      ['bad'],
    ],
    segments: [[0, 1]],
    activities: [{ kind: 'journey', first: 0, last: 1, from: 1_789_880_000, to: 1_789_880_030, seconds: 30, metres: 130, fixes: 2 }],
    totals: { fixes: 2, metres: 130, movingSeconds: 30, journeys: 1 },
    gapSeconds: 600,
    retentionDays: 30,
    truncated: false,
  };
  const TIMELINE = {
    from: 1_789_858_800,
    to: 1_789_945_200,
    heartRate: { seconds: 300, bins: [[1_789_880_000, 72], ['x', 1]] },
    restingHeartRate: { value: 55, at: '2026-09-20T06:00:00Z' },
    steps: [{ value: 8000, start: '2026-09-19T23:00:00Z', end: '2026-09-20T23:00:00Z', source: 'iPhone' }],
    workouts: [{ activity: 'Walk', start: '2026-09-20T07:00:00Z', end: '2026-09-20T07:30:00Z', seconds: 1800, distance: 2100, energy: 90 }],
    sleep: [{ stage: 'core', start: '2026-09-19T22:30:00Z', end: '2026-09-20T05:30:00Z', source: 'Watch' }, { stage: 'deep', start: 'nope', end: 'x' }],
  };
  const WINDOW = { from: 1_789_858_800, to: 1_789_945_200, tz: -60 };

  it('asks for the window as ISO with the tz offset, email lower-cased', async () => {
    const f = fake(200, { track: TRACK, timeline: TIMELINE });
    const r = await pilotDay('Jane@Example.com', WINDOW, f.impl);
    const url = new URL(f.calls[0].url);
    expect(url.pathname).toBe('/api/apple/household/day');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      email: 'jane@example.com',
      from: new Date(WINDOW.from * 1000).toISOString(),
      to: new Date(WINDOW.to * 1000).toISOString(),
      tz: '-60',
    });
    expect(f.calls[0].init.method).toBe('GET');
    expect(r.ok).toBe(true);
  });

  it('reads the track and timeline defensively', async () => {
    const r = await pilotDay('jane@example.com', WINDOW, fake(200, { track: TRACK, timeline: TIMELINE }).impl);
    if (!r.ok) throw new Error('expected ok');
    // One malformed point dropped — so the pilot's indices no longer line up
    // and segments/activities are left for the page to rebuild.
    expect(r.value.track.points).toHaveLength(2);
    expect(r.value.track.segments).toEqual([]);
    expect(r.value.track.activities).toEqual([]);
    expect(r.value.track.totals).toEqual({ fixes: 2, metres: 130, movingSeconds: 30, journeys: 1 });
    expect(r.value.timeline.heartRate).toEqual({ seconds: 300, bins: [[1_789_880_000, 72]] });
    expect(r.value.timeline.sleep).toEqual([{ stage: 'core', start: '2026-09-19T22:30:00Z', end: '2026-09-20T05:30:00Z' }]);
    expect(r.value.timeline.steps).toEqual([{ value: 8000, start: '2026-09-19T23:00:00Z', end: '2026-09-20T23:00:00Z' }]);
    expect(r.value.timeline.workouts[0]).toMatchObject({ activity: 'Walk', seconds: 1800, distance: 2100 });
    expect(r.value.timeline.restingHeartRate).toEqual({ value: 55, at: '2026-09-20T06:00:00Z' });
  });

  it('keeps segments and activities when every point is good', async () => {
    const clean = { ...TRACK, points: TRACK.points.slice(0, 2) };
    const r = await pilotDay('jane@example.com', WINDOW, fake(200, { track: clean, timeline: {} }).impl);
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.track.segments).toEqual([[0, 1]]);
    expect(r.value.track.activities).toHaveLength(1);
    expect(r.value.timeline.heartRate.bins).toEqual([]);
  });

  it('refuses an answer with no track, and maps 404 to not-found', async () => {
    expect(await pilotDay('a@b.com', WINDOW, fake(200, { timeline: {} }).impl)).toEqual({ ok: false, reason: 'bad-response' });
    expect(await pilotDay('a@b.com', WINDOW, fake(404, { error: 'unknown' }).impl)).toEqual({
      ok: false,
      reason: 'not-found',
      status: 404,
    });
  });
});
