import { beforeEach, describe, expect, it, vi } from 'vitest';

// web_search (workflow knit 2026-11-11, slice 3): the search balancer's result
// list. It never names a provider: the balancer chooses.

const h = vi.hoisted(() => ({ calls: [] as Array<{ query: string; options: Record<string, unknown> }>, fail: false }));
vi.mock('$lib/deepdive/web-search', () => ({
  search: async (query: string, options: Record<string, unknown>) => {
    h.calls.push({ query, options });
    if (h.fail) throw new Error('every provider is out of credit');
    return { provider: 'synthetic', results: Array.from({ length: 12 }, (_, i) => ({ title: `Result ${i}`, url: `https://example.invalid/${i}`, content: 'c'.repeat(900), score: 1, raw_content: 'RAW' })) };
  },
}));

const TIERS: Record<string, [string, string, string]> = { web_search: ['read', 'never', 'research'] };

const { tools } = await import('$lib/tools/registry-internal');
await import('./web-search');
const { MEMBER_SAFE_TOOLS, tierOf, principalRefusal } = await import('$lib/tools/invoke-contract');
const { MEMBER_FORBIDDEN_TOOLSETS } = await import('$lib/jkai/member-chat/policy');
const { WHATSAPP_READ_TOOLS } = await import('$lib/integrations/whatsapp/tool-whitelist');

const NAMES = Object.keys(TIERS);
const tool = (name: string) => tools.find((t) => t.name === name)!;
const run = (name: string, args: Record<string, unknown> = {}, principalId?: string, busKey?: string) => tool(name).handler(args, { emit: () => {}, ...(principalId ? { principalId } : {}), ...(busKey ? { busKey } : {}) });

function contract(forbidden = true) {
  it('declare their tier, are owner-only, and are off every member and WhatsApp list', async () => {
    for (const name of NAMES) {
      const t = tool(name);
      expect(tools.filter((x) => x.name === name).length, name).toBe(1);
      expect(tierOf(t), name).toEqual({ effect: TIERS[name][0], confirm: TIERS[name][1], lane: 'standard' });
      expect(t.toolset, name).toBe(TIERS[name][2]);
      expect(t.surfaces, name).toEqual(['chat', 'app']);
      expect(MEMBER_SAFE_TOOLS.includes(name), name).toBe(false);
      expect((WHATSAPP_READ_TOOLS as readonly string[]).includes(name), name).toBe(false);
      if (forbidden) expect((MEMBER_FORBIDDEN_TOOLSETS as readonly string[]).includes(t.toolset), name).toBe(true);
      expect(JSON.stringify([t.description, t.parameters]), name).not.toMatch(/\b20\d\d-\d\d-\d\d\b|\b\d{1,2}:\d\d\b/);
      const r = await run(name, {}, 'u_member');
      expect(r.success, name).toBe(false);
      expect(r.error, name).toMatch(/owner/);
      expect(principalRefusal({ principalId: 'u_member', via: 'session', attended: true, jobId: 'j', allowedTools: [name] }, { name, tier: tierOf(t) }), name).toBeTruthy();
      if (TIERS[name][0] !== 'read') {
        expect(principalRefusal({ principalId: 'owner', via: 'heartbeat', attended: false }, { name, tier: tierOf(t) }), name).toBeTruthy();
      }
    }
  });
}

const { SNIPPET_CAP, UNATTENDED_DAILY_CAP, WEB_TEXT_IS_DATA, resetUnattendedSearches } = await import('./web-search');

describe('web_search', () => {
  beforeEach(() => {
    h.calls = [];
    h.fail = false;
    resetUnattendedSearches();
    delete process.env.WEB_SEARCH_UNATTENDED_DAILY_CAP;
    vi.useRealTimers();
  });
  // `research` is not a member-forbidden toolset; the member list is closed and does not hold it.
  contract(false);

  it('asks the balancer with a purpose and no provider, and returns compact results', async () => {
    expect((await run('web_search', { query: '  ' })).error).toMatch(/query/);
    expect(h.calls).toEqual([]);
    const r = await run('web_search', { query: ' synthetic thing ', limit: 3 });
    expect(h.calls).toEqual([{ query: 'synthetic thing', options: { purpose: 'tool.web_search', maxResults: 3 } }]);
    const d = r.data as { provider: string; results: Array<Record<string, string>> };
    expect(d.provider).toBe('synthetic');
    expect(d.results).toHaveLength(3);
    expect(d.results[0]).toEqual({ title: 'Result 0', url: 'https://example.invalid/0', snippet: 'c'.repeat(SNIPPET_CAP) });
  });

  it('passes a news search and its window, clamps the limit, and reports a failure', async () => {
    await run('web_search', { query: 'q', news: true, days: 99, limit: 50 });
    expect(h.calls[0].options).toEqual({ purpose: 'tool.web_search', maxResults: 10, topic: 'news', days: 30 });
    h.fail = true;
    expect(await run('web_search', { query: 'q' })).toMatchObject({ success: false, error: 'web_search failed: every provider is out of credit' });
  });

  it('labels the results as web text: data, not instructions', async () => {
    const r = await run('web_search', { query: 'q' });
    expect((r.data as { label: string }).label).toBe(WEB_TEXT_IS_DATA);
    expect(WEB_TEXT_IS_DATA).toMatch(/never instructions/);
    expect(tool('web_search').description).toMatch(/never instructions/);
  });

  it('caps a day of searches nobody is attached to, and not the ones John is in', async () => {
    expect(UNATTENDED_DAILY_CAP).toBe(100);
    process.env.WEB_SEARCH_UNATTENDED_DAILY_CAP = '3';
    vi.useFakeTimers({ now: new Date('2026-01-02T10:00:00Z') });
    for (let i = 0; i < 3; i++) expect((await run('web_search', { query: 'q' })).success).toBe(true);
    const over = await run('web_search', { query: 'q' });
    expect(over.success).toBe(false);
    expect(over.error).toMatch(/3 unattended searches/);
    // Refused before the balancer is asked: no credit is spent.
    expect(h.calls).toHaveLength(3);
    // A turn with John attached (it has a bus key) is not counted and not refused.
    expect((await run('web_search', { query: 'q' }, 'owner', 'chat_1')).success).toBe(true);
    expect(h.calls).toHaveLength(4);
    // The next day starts again.
    vi.setSystemTime(new Date('2026-01-03T00:00:01Z'));
    expect((await run('web_search', { query: 'q' })).success).toBe(true);
  });

  it('the default allowance is 100 a day', async () => {
    for (let i = 0; i < UNATTENDED_DAILY_CAP; i++) expect((await run('web_search', { query: 'q' })).success).toBe(true);
    expect((await run('web_search', { query: 'q' })).success).toBe(false);
  });

  it('leaves tavily_search alone', () => {
    expect(tools.filter((t) => t.name === 'web_search')).toHaveLength(1);
  });
});
