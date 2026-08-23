import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isHermesReachable, invalidateHermesReach, __setClockForTests } from './hermes-reach';

const URL_ = 'http://homeserv.example:18790';

let clock = 0;

beforeEach(() => {
  clock = 1_000_000;
  __setClockForTests(() => clock);
  vi.restoreAllMocks();
});

afterEach(() => {
  __setClockForTests(() => Date.now());
});

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response> | Response;

function mockFetch(impl: FetchImpl) {
  const spy = vi.fn<FetchImpl>(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('isHermesReachable', () => {
  it('probes the health endpoint on the URL it was given', async () => {
    const f = mockFetch(() => new Response('ok', { status: 200 }));
    await expect(isHermesReachable(URL_)).resolves.toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toBe(`${URL_}/platforms/jkai/health`);
  });

  it('tolerates a trailing slash on the base URL', async () => {
    const f = mockFetch(() => new Response('ok', { status: 200 }));
    await isHermesReachable(`${URL_}/`);
    expect(String(f.mock.calls[0][0])).toBe(`${URL_}/platforms/jkai/health`);
  });

  it('fails closed when the probe rejects (dark host)', async () => {
    mockFetch(() => Promise.reject(new Error('UND_ERR_CONNECT_TIMEOUT')));
    await expect(isHermesReachable(URL_)).resolves.toBe(false);
  });

  it('treats 5xx as unreachable — up but unwell routes elsewhere', async () => {
    mockFetch(() => new Response('boom', { status: 503 }));
    await expect(isHermesReachable(URL_)).resolves.toBe(false);
  });

  it('fails closed on an empty URL without probing', async () => {
    const f = mockFetch(() => new Response('ok', { status: 200 }));
    await expect(isHermesReachable('')).resolves.toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('bounds the probe with a 2.5s signal', async () => {
    const f = mockFetch(() => new Response('ok', { status: 200 }));
    await isHermesReachable(URL_);
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('caches the verdict for 30s, then re-probes', async () => {
    const f = mockFetch(() => new Response('ok', { status: 200 }));
    await isHermesReachable(URL_);
    clock += 29_999;
    await isHermesReachable(URL_);
    expect(f).toHaveBeenCalledTimes(1);

    clock += 2;
    await isHermesReachable(URL_);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('caches a NEGATIVE verdict too — an outage must not cost a probe per call', async () => {
    const f = mockFetch(() => Promise.reject(new Error('down')));
    await expect(isHermesReachable(URL_)).resolves.toBe(false);
    await expect(isHermesReachable(URL_)).resolves.toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('single-flights concurrent callers onto one probe', async () => {
    let release!: (r: Response) => void;
    const f = mockFetch(() => new Promise<Response>((res) => { release = res; }));

    const all = Promise.all([
      isHermesReachable(URL_),
      isHermesReachable(URL_),
      isHermesReachable(URL_),
    ]);
    expect(f).toHaveBeenCalledTimes(1);

    release(new Response('ok', { status: 200 }));
    await expect(all).resolves.toEqual([true, true, true]);
  });

  it('re-probes immediately after invalidate', async () => {
    const f = mockFetch(() => new Response('ok', { status: 200 }));
    await isHermesReachable(URL_);
    invalidateHermesReach();
    await isHermesReachable(URL_);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('hermesWillAnswerChat', () => {
  const enabled = async () => true;
  const disabled = async () => false;
  const explodes = async () => { throw new Error('db down'); };

  it('is false when the engine is not selected — and does not probe', async () => {
    const f = mockFetch(() => new Response('ok', { status: 200 }));
    const { hermesWillAnswerChat } = await import('./hermes-reach');
    await expect(hermesWillAnswerChat(disabled, true, URL_)).resolves.toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('is false when selected but unreachable — the outage case', async () => {
    mockFetch(() => Promise.reject(new Error('dark')));
    const { hermesWillAnswerChat } = await import('./hermes-reach');
    await expect(hermesWillAnswerChat(enabled, true, URL_)).resolves.toBe(false);
  });

  it('is true only when selected and reachable', async () => {
    mockFetch(() => new Response('ok', { status: 200 }));
    const { hermesWillAnswerChat } = await import('./hermes-reach');
    await expect(hermesWillAnswerChat(enabled, true, URL_)).resolves.toBe(true);
  });

  it('falls back to the env default when the settings read throws', async () => {
    mockFetch(() => new Response('ok', { status: 200 }));
    const { hermesWillAnswerChat } = await import('./hermes-reach');
    // envDefault true → still consults reachability rather than failing chat
    await expect(hermesWillAnswerChat(explodes, true, URL_)).resolves.toBe(true);
    invalidateHermesReach();
    // envDefault false → off, no probe needed
    await expect(hermesWillAnswerChat(explodes, false, URL_)).resolves.toBe(false);
  });
});
