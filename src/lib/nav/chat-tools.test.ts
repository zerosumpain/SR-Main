import { beforeEach, describe, expect, it, vi } from 'vitest';

// The site tools (workflow knit 2026-11-11, slice 3): the map's own pages and
// the analytics client's counts.

const h = vi.hoisted(() => ({ configured: true, calls: [] as unknown[] }));
vi.mock('$lib/umami/client', () => ({
  getUmami: () =>
    h.configured
      ? {
          getStatsForPath: async (path: string, days: number) => (h.calls.push(['stats', path, days]), { pageviews: 42, visitors: 17 }),
          getDailyViews: async (path: string, days: number) => (h.calls.push(['daily', path, days]), [{ date: 'd1', views: 20 }, { date: 'd2', views: 22 }]),
          getTopReferrers: async (path: string, days: number, limit: number) => (h.calls.push(['ref', path, days, limit]), [{ referrer: 'example.invalid', views: 5 }]),
        }
      : null,
}));

const TIERS: Record<string, [string, string, string]> = {
  site_map: ['read', 'never', 'site'],
  site_analytics: ['read', 'never', 'site'],
};

const { tools } = await import('$lib/tools/registry-internal');
await import('./chat-tools');
const { MEMBER_SAFE_TOOLS, tierOf, principalRefusal } = await import('$lib/tools/invoke-contract');
const { MEMBER_FORBIDDEN_TOOLSETS } = await import('$lib/jkai/member-chat/policy');
const { WHATSAPP_READ_TOOLS } = await import('$lib/integrations/whatsapp/tool-whitelist');

const NAMES = Object.keys(TIERS);
const tool = (name: string) => tools.find((t) => t.name === name)!;
const run = (name: string, args: Record<string, unknown> = {}, principalId?: string) => tool(name).handler(args, { emit: () => {}, ...(principalId ? { principalId } : {}) });

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

const { placesFor } = await import('./go');

describe('site chat tools', () => {
  beforeEach(() => {
    h.configured = true;
    h.calls = [];
  });
  contract();

  it('site_map is the map\'s own list, read as the owner, and finds a page by its words', async () => {
    const all = (await run('site_map')).data as { total: number; pages: Array<{ name: string; url: string }> };
    const map = placesFor(true);
    expect(all.total).toBe(map.length);
    expect(all.pages.length).toBe(Math.min(120, map.length));
    expect(all.pages[0]).toEqual({ name: map[0].label, url: map[0].href, under: map[0].context });
    for (const p of all.pages) expect(p.url.startsWith('/') || p.url.startsWith('http'), p.url).toBe(true);
    const found = (await run('site_map', { q: map[0].label })).data as { matched: number; pages: Array<{ url: string }> };
    expect(found.matched).toBeGreaterThan(0);
    expect(found.pages.length).toBeLessThanOrEqual(12);
    expect(found.pages.map((p) => p.url)).toContain(map[0].href);
    expect((await run('site_map', { q: 'zzzzqqqqxxxx' })).data).toMatchObject({ matched: 0, pages: [], message: 'No page is named that.' });
  });

  it('site_analytics validates the path, clamps the window and returns counts', async () => {
    expect((await run('site_analytics', { path: 'https://example.invalid/' })).error).toMatch(/path/);
    expect((await run('site_analytics', { path: '/a b' })).error).toMatch(/path/);
    expect(h.calls).toEqual([]);
    const r = await run('site_analytics', { path: '/blog', days: 900 });
    expect(r.data).toEqual({ path: '/blog', days: 90, pageviews: 42, visitors: 17, daily: [{ date: 'd1', views: 20 }, { date: 'd2', views: 22 }], referrers: [{ referrer: 'example.invalid', views: 5 }] });
    expect(h.calls).toEqual([['stats', '/blog', 90], ['daily', '/blog', 90], ['ref', '/blog', 90, 8]]);
    expect((await run('site_analytics')).data).toMatchObject({ path: '/', days: 7 });
  });

  it('site_analytics says so when analytics is not configured', async () => {
    h.configured = false;
    expect(await run('site_analytics')).toEqual({ success: false, error: 'Analytics is not configured on this host.' });
  });
});
