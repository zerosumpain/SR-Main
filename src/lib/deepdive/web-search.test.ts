import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The ledger writes through Drizzle; these tests are about which provider the
// balancer picks and what it does when one fails, so the database is a stub.
const inserted: Record<string, unknown>[] = [];
vi.mock('$lib/db', () => ({
  db: {
    insert: () => ({ values: (row: Record<string, unknown>) => (inserted.push(row), Promise.resolve()) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
}));
const keys: { tavilyApiKey?: string; braveApiKey?: string } = {};
vi.mock('$lib/llm/keys', () => ({
  loadKeys: () => keys,
  getTavilyKey: () => {
    if (!keys.tavilyApiKey) throw new Error('Tavily API key not configured');
    return keys.tavilyApiKey;
  },
}));
// The Brave key lives in app_settings; this is that row.
vi.mock('$lib/server/models/settings', () => ({
  getSetting: async (key: string) => (key === 'brave.api_key' && keys.braveApiKey ? { value: keys.braveApiKey } : null),
}));
/** The keys as the balancer sees them. */
const k = () => ({ tavily: !!keys.tavilyApiKey, brave: !!keys.braveApiKey });

const { search, chooseProviders, resetSearchBalancer, searchBalancerStatus } = await import('./web-search');
const { resetTavilyUsageCache } = await import('./tavily-usage');

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

/** A fetch that answers per provider and records what was asked. */
function stubProviders(replies: { tavily?: Reply[]; brave?: Reply[]; usage?: Reply }) {
  const calls: { provider: string; url: string }[] = [];
  const queue = { tavily: [...(replies.tavily ?? [])], brave: [...(replies.brave ?? [])] };
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith('/usage')) {
      const r = replies.usage ?? { status: 503, body: {} };
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
    }
    const provider = url.includes('api.search.brave.com') ? 'brave' : 'tavily';
    calls.push({ provider, url });
    const r = queue[provider].shift() ?? { status: 500, body: { error: 'no reply queued' } };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const tavilyOk: Reply = { body: { results: [{ title: 'T', url: 'https://t.example/a', content: 'tavily text', score: 0.8 }] } };
const braveOk = (remaining = 14_000): Reply => ({
  body: { web: { results: [{ title: '<strong>B</strong>', url: 'https://b.example/a', description: 'brave text', extra_snippets: ['more'] }] } },
  headers: {
    'x-ratelimit-limit': '1, 15000',
    'x-ratelimit-remaining': `0, ${remaining}`,
    'x-ratelimit-reset': '1, 86400',
    'x-ratelimit-policy': '1;w=1, 15000;w=2592000',
  },
});

beforeEach(() => {
  inserted.length = 0;
  keys.tavilyApiKey = 'tvly-test';
  keys.braveApiKey = 'BSAtestkey0000000000000';
  resetTavilyUsageCache();
  resetSearchBalancer(() => 0.5);
  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('choosing a provider', () => {
  it('sends a search only to a provider that has a key', async () => {
    keys.braveApiKey = undefined;
    expect(chooseProviders('q', {}, k())).toEqual(['tavily']);
    keys.braveApiKey = 'BSAtestkey0000000000000';
    keys.tavilyApiKey = undefined;
    expect(chooseProviders('q', {}, k())).toEqual(['brave']);
    keys.braveApiKey = undefined;
    expect(chooseProviders('q', {}, k())).toEqual([]);
  });

  it('weights by searches left: the larger allowance draws the larger share', async () => {
    // Defaults before either provider has reported: Tavily 1,000, Brave 2,000.
    resetSearchBalancer(() => 0.6);
    expect(chooseProviders('q', {}, k())[0]).toBe('brave');
    resetSearchBalancer(() => 0.7);
    expect(chooseProviders('q', {}, k())[0]).toBe('tavily');
    expect((await searchBalancerStatus()).share.brave).toBeCloseTo(2 / 3, 5);
  });

  it('sends answers, advanced depth and long domain lists to Tavily first', async () => {
    resetSearchBalancer(() => 0);
    expect(chooseProviders('q', {}, k())[0]).toBe('brave');
    expect(chooseProviders('q', { includeAnswer: true }, k())).toEqual(['tavily', 'brave']);
    expect(chooseProviders('q', { searchDepth: 'advanced' }, k())).toEqual(['tavily', 'brave']);
    const many = Array.from({ length: 12 }, (_, i) => `site${i}.example`);
    expect(chooseProviders('q', { includeDomains: many }, k())).toEqual(['tavily']);
    expect(chooseProviders('q'.repeat(500), {}, k())).toEqual(['tavily']);
  });

  it('keeps a short domain allow-list on Brave as site: terms, filtered afterwards', async () => {
    resetSearchBalancer(() => 0);
    const calls = stubProviders({
      brave: [{
        body: { web: { results: [
          { title: 'kept', url: 'https://www.pricerunner.com/x', description: 'd' },
          { title: 'dropped', url: 'https://elsewhere.example/y', description: 'd' },
        ] } },
      }],
    });
    const res = await search('kettle', { purpose: 'wishlist', includeDomains: ['pricerunner.com'] });
    expect(res.provider).toBe('brave');
    expect(new URL(calls[0].url).searchParams.get('q')).toBe('kettle (site:pricerunner.com)');
    expect(res.results.map((r) => r.title)).toEqual(['kept']);
  });
});

describe('searching', () => {
  it('returns Brave results in the Tavily shape, with a rank score and plain text', async () => {
    resetSearchBalancer(() => 0);
    stubProviders({ brave: [braveOk()] });
    const res = await search('q', { purpose: 'test', maxResults: 5 });
    expect(res.provider).toBe('brave');
    expect(res.results).toEqual([{ title: 'B', url: 'https://b.example/a', content: 'brave text … more', score: 0.9 }]);
    const row = inserted.find((r) => r.actionType === 'brave_call');
    expect(row).toMatchObject({ provider: 'brave', status: 'completed', toolName: 'search' });
    expect((row!.input as Record<string, unknown>).quota).toEqual({ limit: 15000, remaining: 14000, resetSeconds: 86400 });
  });

  it('learns Brave’s remaining allowance from its headers and weights by it', async () => {
    resetSearchBalancer(() => 0);
    stubProviders({ brave: [braveOk(100)] });
    await search('q', { purpose: 'test' });
    // Tavily 1,000 (default) against Brave's reported 100.
    expect((await searchBalancerStatus()).share.brave).toBeCloseTo(100 / 1100, 5);
  });

  it('fails over to the other provider at once, writing both attempts', async () => {
    resetSearchBalancer(() => 0);
    stubProviders({ brave: [{ status: 500, body: { error: 'down' } }], tavily: [tavilyOk] });
    const res = await search('q', { purpose: 'test' });
    expect(res.provider).toBe('tavily');
    const rows = inserted.filter((r) => r.actionType === 'brave_call' || r.actionType === 'tavily_call');
    expect(rows.map((r) => [r.provider, r.status, (r.input as Record<string, unknown>).attempt])).toEqual([
      ['brave', 'failed', 1],
      ['tavily', 'completed', 2],
    ]);
    // Brave rests after a server error, so the next search goes straight to Tavily.
    expect(chooseProviders('q', {}, k())).toEqual(['tavily', 'brave']);
    expect((await searchBalancerStatus()).restReason.brave).toBe('server error 500');
  });

  it('rests Brave until its reset when the month is spent', async () => {
    resetSearchBalancer(() => 0);
    stubProviders({
      brave: [{ status: 429, body: {}, headers: { 'x-ratelimit-limit': '1, 15000', 'x-ratelimit-remaining': '1, 0', 'x-ratelimit-reset': '1, 7200' } }],
      tavily: [tavilyOk],
    });
    await search('q', { purpose: 'test' });
    const status = (await searchBalancerStatus());
    expect(status.restReason.brave).toBe('monthly allowance spent');
    expect(new Date(status.restingUntil.brave!).getTime() - Date.now()).toBe(7_200_000);
  });

  it('moves a burst over Brave’s per-second limit to Tavily instead of queueing it', async () => {
    resetSearchBalancer(() => 0);
    stubProviders({ brave: [braveOk()], tavily: [tavilyOk] });
    const first = await search('one', { purpose: 'test' });
    const second = await search('two', { purpose: 'test' });
    expect([first.provider, second.provider]).toEqual(['brave', 'tavily']);
    vi.advanceTimersByTime(1_000);
    expect(chooseProviders('three', {}, k())[0]).toBe('brave');
  });

  it('with one provider, retries it once after two seconds, as search always did', async () => {
    keys.braveApiKey = undefined;
    stubProviders({ tavily: [{ status: 502, body: {} }, tavilyOk] });
    const pending = search('q', { purpose: 'test' });
    await vi.advanceTimersByTimeAsync(2_000);
    const res = await pending;
    expect(res.provider).toBe('tavily');
    expect(inserted.filter((r) => r.actionType === 'tavily_call').map((r) => r.status)).toEqual(['failed', 'completed']);
  });

  it('does not fail over a search the caller cancelled', async () => {
    resetSearchBalancer(() => 0);
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort();
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }));
    await expect(search('q', { purpose: 'test', signal: controller.signal })).rejects.toThrow('aborted');
    expect(inserted.filter((r) => r.actionType === 'tavily_call')).toHaveLength(0);
  });

  it('says plainly when no provider is configured', async () => {
    keys.tavilyApiKey = undefined;
    keys.braveApiKey = undefined;
    await expect(search('q', { purpose: 'test' })).rejects.toThrow('No web search provider configured');
  });
});

describe('the fixes a review asked for', () => {
  it('spaces a queue of Brave-only searches one burst slot apart instead of waking them together', async () => {
    keys.tavilyApiKey = undefined;
    const sentAt: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => {
      sentAt.push(Date.now());
      const r = braveOk();
      return new Response(JSON.stringify(r.body), { headers: r.headers });
    }));
    const all = Promise.all(['a', 'b', 'c'].map((q) => search(q, { purpose: 'test' })));
    await vi.advanceTimersByTimeAsync(3_000);
    await all;
    expect(sentAt).toHaveLength(3);
    expect(sentAt[1] - sentAt[0]).toBeGreaterThanOrEqual(1_000);
    expect(sentAt[2] - sentAt[1]).toBeGreaterThanOrEqual(1_000);
  });

  it('forgets Brave’s “0 left” once its reset time passes, so it is chosen again next month', async () => {
    resetSearchBalancer(() => 0);
    stubProviders({
      brave: [{ status: 429, body: {}, headers: { 'x-ratelimit-limit': '1, 15000', 'x-ratelimit-remaining': '1, 0', 'x-ratelimit-reset': '1, 3600' } }],
      tavily: [tavilyOk],
    });
    await search('q', { purpose: 'test' });
    expect((await searchBalancerStatus()).remaining.brave).toBe(0);
    vi.advanceTimersByTime(3_600_000);
    expect((await searchBalancerStatus()).remaining.brave).toBe(2_000);
    expect(chooseProviders('q', {}, k())[0]).toBe('brave');
  });

  it('asks only the named provider when a caller names one', async () => {
    resetSearchBalancer(() => 0);
    expect(chooseProviders('q', { provider: 'tavily' }, k())).toEqual(['tavily']);
    keys.tavilyApiKey = undefined;
    await expect(search('q', { purpose: 'test', provider: 'tavily' })).rejects.toThrow('Tavily API key not configured');
  });

  it('says why when only Brave has a key and Brave cannot take the search', async () => {
    keys.tavilyApiKey = undefined;
    await expect(search('x'.repeat(500), { purpose: 'test' })).rejects.toThrow('too long for Brave Search');
  });

  it('counts a Brave search in the research run meter without Tavily credits', async () => {
    const { runWithResearchMeter } = await import('$lib/context/research-meter');
    resetSearchBalancer(() => 0);
    stubProviders({ brave: [braveOk()] });
    const res = await runWithResearchMeter('run-1', () => search('q', { purpose: 'research.phase1' }));
    expect(res.provider).toBe('brave');
  });

  it('applies days to Brave only on news, as Tavily does', async () => {
    resetSearchBalancer(() => 0);
    const calls = stubProviders({ brave: [braveOk(), { body: { results: [] } }] });
    await search('q', { purpose: 'test', days: 7 });
    vi.advanceTimersByTime(1_000);
    await search('q', { purpose: 'test', days: 7, topic: 'news' });
    expect(new URL(calls[0].url).searchParams.get('freshness')).toBeNull();
    expect(new URL(calls[1].url).pathname).toBe('/res/v1/news/search');
    expect(new URL(calls[1].url).searchParams.get('freshness')).toBe('pw');
  });
});

describe('every search goes through the balancer', () => {
  // The provider clients are for the balancer and the key tests alone. A
  // caller importing one directly would bypass the split and the failover —
  // the point of the balancer is that no search can.
  const ALLOWED = new Set([
    'src/lib/deepdive/web-search.ts',
    'src/routes/api/admin/deepdive/test-tavily/+server.ts',
    'src/routes/api/admin/deepdive/test-brave/+server.ts',
  ]);
  const DIRECT = /\b(tavilySearch|braveSearch)\b[^;]*from\s+['"](\$lib\/deepdive|\.)\/(tavily|brave)['"]|import\(\s*['"]\$lib\/deepdive\/(tavily|brave)['"]\s*\)[^;]*\b(tavilySearch|braveSearch|search)\b|\bsearch\b[^;]*from\s+['"](\$lib\/deepdive|\.)\/tavily['"]/s;
  const RAW_API = /api\.tavily\.com\/search|api\.search\.brave\.com/;

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (/\.(ts|js|svelte)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
    }
    return out;
  }

  it('has no direct provider search outside the balancer', async () => {
    const offenders = walk('src').filter((file) => {
      if (ALLOWED.has(file) || file === 'src/lib/deepdive/tavily.ts' || file === 'src/lib/deepdive/brave.ts') return false;
      const text = readFileSync(file, 'utf-8');
      return DIRECT.test(text) || RAW_API.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
