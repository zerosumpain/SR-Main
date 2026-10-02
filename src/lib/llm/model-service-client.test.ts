import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createModelServiceClient, usableBaseUrl } from './model-service-client';
import { MODEL_SERVICE_CONTRACT, type ModelConfigSnapshot, type UsageEvent } from './model-service-contract';

const TOKEN = 't'.repeat(40);
const BASE = 'http://127.0.0.1:5173';
const quiet = { warn: vi.fn(), error: vi.fn() };

function snapshot(modelId = 'deepseek/deepseek-v4-flash'): ModelConfigSnapshot {
  return {
    contract: MODEL_SERVICE_CONTRACT,
    generatedAt: '2026-10-02T12:00:00Z',
    settings: { 'jkai.chat.default_model': { modelId } },
    resolved: { defaultModel: { provider: 'openrouter', modelId }, codexEnabled: false, workloads: {} },
    catalogue: [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let dir: string;
let clock: number;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'model-service-test-'));
  clock = Date.parse('2026-10-02T12:00:00Z');
  quiet.warn.mockReset();
  quiet.error.mockReset();
});
afterEach(async () => {
  // The last good configuration is saved in the background; let it land.
  await new Promise((r) => setTimeout(r, 20));
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

function client(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return createModelServiceClient({
    app: 'policy-engine',
    baseUrl: BASE,
    token: TOKEN,
    stateDir: dir,
    fetch: fetchImpl,
    now: () => clock,
    flushDelayMs: 60_000, // tests flush explicitly
    log: quiet,
    ...extra,
  });
}

describe('usableBaseUrl', () => {
  it('allows https anywhere and http only to loopback', () => {
    expect(usableBaseUrl('https://strangeramblings.com/x')).toBe('https://strangeramblings.com');
    expect(usableBaseUrl('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173');
    expect(usableBaseUrl('http://localhost:5173')).toBe('http://localhost:5173');
    expect(usableBaseUrl('http://10.0.0.5:5173')).toBeNull();
    expect(usableBaseUrl('http://user:pw@127.0.0.1')).toBeNull();
    expect(usableBaseUrl(undefined)).toBeNull();
  });
});

describe('configuration', () => {
  it('is unconfigured without a URL or a long enough token, and never calls out', async () => {
    const f = vi.fn();
    expect(client(f as never, { token: 'short' }).configured).toBe(false);
    const c = client(f as never, { baseUrl: undefined });
    expect(await c.getConfig()).toBeNull();
    c.recordUsage({ provider: 'openrouter', model: 'm', tokensInput: 1, tokensOutput: 1, costUsd: null });
    await c.flush();
    expect(f).not.toHaveBeenCalled();
  });

  it('sends the bearer token and caches for the TTL', async () => {
    const f = vi.fn(async () => jsonResponse(snapshot()));
    const c = client(f as never);
    expect((await c.getConfig())?.resolved.defaultModel.modelId).toBe('deepseek/deepseek-v4-flash');
    await c.getConfig();
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/platform/models/config`);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    clock += 61_000;
    await c.getConfig();
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2));
  });

  it('serves the last good copy when Main fails, and backs off instead of retrying per call', async () => {
    let up = true;
    const f = vi.fn(async () => (up ? jsonResponse(snapshot('a/one')) : jsonResponse({ error: 'down' }, 503)));
    const c = client(f as never, { configTtlMs: 1000, configRetryMs: 10_000 });
    await c.getConfig();
    up = false;
    clock += 2000;
    expect((await c.getConfig())?.resolved.defaultModel.modelId).toBe('a/one');
    await vi.waitFor(() => expect(c.status().lastConfigError).toMatch(/503/));
    const calls = f.mock.calls.length;
    clock += 5000; // inside the backoff window
    expect((await c.getConfig())?.resolved.defaultModel.modelId).toBe('a/one');
    expect(f.mock.calls.length).toBe(calls);
    expect(c.status().configStale).toBe(true);
  });

  it('starts from the configuration saved by a previous process when Main is down', async () => {
    const first = client(vi.fn(async () => jsonResponse(snapshot('saved/model'))) as never);
    await first.getConfig();
    await vi.waitFor(async () => expect(JSON.parse(await readFile(join(dir, 'model-config.json'), 'utf8')).contract).toBe(1));
    const second = client(vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as never);
    expect((await second.getConfig())?.resolved.defaultModel.modelId).toBe('saved/model');
  });

  it('refuses a document from a different contract', async () => {
    const c = client(vi.fn(async () => jsonResponse({ ...snapshot(), contract: 99 })) as never);
    expect(await c.getConfig()).toBeNull();
  });

  it('returns null rather than hanging when Main never answers', async () => {
    const c = client(vi.fn(async () => { throw new Error('timeout'); }) as never);
    expect(await c.getConfig()).toBeNull();
  });
});

describe('usage', () => {
  const call = { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', tokensInput: 10, tokensOutput: 5, costUsd: 0.001 };

  async function spool(): Promise<UsageEvent[]> {
    try {
      return (await readFile(join(dir, 'usage-spool.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  it('posts events with an id and time, and empties the spool on success', async () => {
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      const n = JSON.parse(String(init.body)).events.length;
      return jsonResponse({ accepted: n, duplicates: 0, rejected: [] });
    });
    const c = client(f as never);
    c.recordUsage(call);
    c.recordUsage({ ...call, provider: 'codex', model: 'gpt-5.6-terra', costUsd: null });
    await c.flush();
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/platform/models/usage`);
    const sent = JSON.parse(String(init.body)).events as UsageEvent[];
    expect(sent).toHaveLength(2);
    expect(sent[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent[0].occurredAt).toBe('2026-10-02T12:00:00.000Z');
    // A null cost crosses the wire as null, never as zero.
    expect(sent[1].costUsd).toBeNull();
    expect(await spool()).toEqual([]);
    expect(c.status().delivered).toBe(2);
  });

  it('keeps events through an outage and resends them with the SAME ids', async () => {
    let up = false;
    const bodies: UsageEvent[][] = [];
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      if (!up) throw new Error('ECONNREFUSED');
      const events = JSON.parse(String(init.body)).events as UsageEvent[];
      bodies.push(events);
      return jsonResponse({ accepted: events.length, duplicates: 0, rejected: [] });
    });
    const c = client(f as never);
    c.recordUsage(call);
    await c.flush();
    const held = await spool();
    expect(held).toHaveLength(1);
    expect(c.status().lastUsageError).toMatch(/ECONNREFUSED/);

    // A new process picks the spool up.
    up = true;
    const restarted = client(f as never);
    await restarted.flush();
    expect(bodies[0].map((e) => e.id)).toEqual(held.map((e) => e.id));
    expect(await spool()).toEqual([]);
  });

  it('does not block or throw in the caller when Main is down', () => {
    const c = client(vi.fn(async () => { throw new Error('down'); }) as never);
    expect(() => c.recordUsage(call)).not.toThrow();
  });

  it('bounds the spool by dropping the oldest, and counts the loss', async () => {
    const c = client(vi.fn(async () => { throw new Error('down'); }) as never, { maxSpooledEvents: 3 });
    for (let i = 0; i < 5; i++) c.recordUsage({ ...call, tokensInput: i });
    await c.flush();
    const left = await spool();
    expect(left.map((e) => e.tokensInput)).toEqual([2, 3, 4]);
    expect(c.status().dropped).toBe(2);
    expect(quiet.error).toHaveBeenCalled();
  });

  it('drops events Main rejects as invalid instead of retrying them forever', async () => {
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      const [first, second] = JSON.parse(String(init.body)).events as UsageEvent[];
      return jsonResponse({ accepted: 1, duplicates: 0, rejected: [{ id: second.id, error: 'bad' }], _first: first.id });
    });
    const c = client(f as never);
    c.recordUsage(call);
    c.recordUsage(call);
    await c.flush();
    expect(await spool()).toEqual([]);
    expect(c.status().rejected).toBe(1);
  });

  it('keeps events when the credential is refused, for after the fix', async () => {
    const c = client(vi.fn(async () => jsonResponse({ message: 'invalid token' }, 401)) as never);
    c.recordUsage(call);
    await c.flush();
    expect(await spool()).toHaveLength(1);
  });

  it('counts a duplicate acknowledgement as delivered', async () => {
    const c = client(vi.fn(async () => jsonResponse({ accepted: 0, duplicates: 1, rejected: [] })) as never);
    c.recordUsage(call);
    await c.flush();
    expect(await spool()).toEqual([]);
    expect(c.status().delivered).toBe(1);
  });
});
