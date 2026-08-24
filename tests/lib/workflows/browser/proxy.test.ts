import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { callVerb, closeSession, onHomeserv } = vi.hoisted(() => ({
  callVerb: vi.fn(),
  closeSession: vi.fn(),
  onHomeserv: vi.fn(),
}));

vi.mock('$lib/workflows/browser/session', () => ({
  callVerb: (...a: unknown[]) => callVerb(...a),
  closeSession: (...a: unknown[]) => closeSession(...a),
  isOnHomeserv: () => onHomeserv(),
}));

import { runBrowserVerb } from '$lib/workflows/browser';

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.BROWSER_SERVICE_URL;
  delete process.env.BROWSER_ALLOW_NON_HOMESERV;
});
afterEach(() => {
  process.env = { ...ENV };
});

describe('runBrowserVerb — residential-IP routing', () => {
  it('drives the local daemon when on homeserv', async () => {
    onHomeserv.mockReturnValue(true);
    callVerb.mockResolvedValue({ ok: true, url: 'https://x' });
    const r = await runBrowserVerb('navigate', { url: 'https://x' });
    expect(r.ok).toBe(true);
    expect(callVerb).toHaveBeenCalledWith('navigate', { url: 'https://x' });
    expect(fetchCalls()).toBe(0);
  });

  it('proxies to homeserv when NOT on homeserv', async () => {
    onHomeserv.mockReturnValue(false);
    process.env.BROWSER_SERVICE_URL = 'http://homeserv:5173/api/browser';
    const spy = mockFetch({ ok: true, title: 'T' });
    const r = await runBrowserVerb('snapshot', {});
    expect(r).toMatchObject({ ok: true, title: 'T' });
    expect(callVerb).not.toHaveBeenCalled();
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({
      verb: 'snapshot',
      args: {},
    });
  });

  it('never drives a browser locally off homeserv — a datacentre IP defeats the point', async () => {
    onHomeserv.mockReturnValue(false);
    // No BROWSER_SERVICE_URL configured.
    const r = await runBrowserVerb('navigate', { url: 'https://x' });
    expect(r.ok).toBe(false);
    expect(callVerb).not.toHaveBeenCalled();
    expect(r.error).toMatch(/homeserv|residential/i);
  });

  it('FAILS SOFT when homeserv is unreachable, and tells the model what to do', async () => {
    onHomeserv.mockReturnValue(false);
    process.env.BROWSER_SERVICE_URL = 'http://homeserv:5173/api/browser';
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('UND_ERR_CONNECT_TIMEOUT'))));
    const r = await runBrowserVerb('navigate', { url: 'https://x' });
    // A browser is a nice-to-have on a chat turn: never throw, never pretend.
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unreachable/i);
    expect(r.error).toMatch(/rather than guessing/i);
  });

  it('reports a non-200 from the service rather than parsing it as a result', async () => {
    onHomeserv.mockReturnValue(false);
    process.env.BROWSER_SERVICE_URL = 'http://homeserv:5173/api/browser';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    const r = await runBrowserVerb('snapshot', {});
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toContain('503');
  });

  it('bounds the proxy call with a signal', async () => {
    onHomeserv.mockReturnValue(false);
    process.env.BROWSER_SERVICE_URL = 'http://homeserv:5173/api/browser';
    const spy = mockFetch({ ok: true });
    await runBrowserVerb('snapshot', {});
    expect(spy.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('routes close through the local path on homeserv', async () => {
    onHomeserv.mockReturnValue(true);
    const r = await runBrowserVerb('close', {});
    expect(closeSession).toHaveBeenCalledOnce();
    expect(r.ok).toBe(true);
  });

  it('the escape hatch allows local driving off homeserv, for dev only', async () => {
    onHomeserv.mockReturnValue(false);
    process.env.BROWSER_ALLOW_NON_HOMESERV = '1';
    callVerb.mockResolvedValue({ ok: true });
    await runBrowserVerb('snapshot', {});
    expect(callVerb).toHaveBeenCalledOnce();
  });

  it('turns a thrown daemon error into a soft result', async () => {
    onHomeserv.mockReturnValue(true);
    callVerb.mockRejectedValue(new Error('daemon died'));
    const r = await runBrowserVerb('snapshot', {});
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toContain('daemon died');
  });
});

type FetchArgs = [input: string, init?: RequestInit];

function mockFetch(payload: Record<string, unknown>) {
  const spy = vi.fn(async (..._a: FetchArgs) => new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal('fetch', spy);
  return spy;
}
function fetchCalls(): number {
  const f = globalThis.fetch as unknown as { mock?: { calls: unknown[] } };
  return f?.mock?.calls.length ?? 0;
}
