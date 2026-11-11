import { beforeEach, describe, expect, it, vi } from 'vitest';

// share_links (workflow knit 2026-11-11, slice 3): who opened what, in counts.
// Never the link, its token, its password hash or a visitor row. Creating and
// revoking stay on the page. Fixtures are synthetic.

const link = (id: string, over: Record<string, unknown> = {}) => ({
  id, label: `Synthetic link ${id}`, token: 'tok_SECRET_VALUE', tokenHash: 'hash_SECRET_VALUE', passwordHash: 'pw_SECRET_VALUE', url: 'https://example.invalid/s/tok_SECRET_VALUE',
  createdAt: new Date('2026-01-01T00:00:00Z'), expiresAt: null, revokedAt: null, lastUsedAt: new Date('2026-01-02T00:00:00Z'), hasPassword: true, pack: null,
  opens: 4, browsers: 2, networks: 2, countries: ['AA', 'BB'], likelyForwarded: true, visits: [{ ip: '192.0.2.1', userAgent: 'SECRET_VALUE agent' }], ...over,
});

vi.mock('$lib/projects/registry', () => ({ getAllowedProjectKeys: () => new Set(['beta', 'alpha']) }));
vi.mock('$lib/projects/shares', () => ({
  listSharesWithVisits: async (key: string) =>
    key === 'alpha' ? [link('a1'), link('a2', { revokedAt: new Date('2026-01-01T12:00:00Z') }), link('a3', { expiresAt: new Date('2000-01-01T00:00:00Z') })] : [],
}));

const TIERS: Record<string, [string, string, string]> = { share_links: ['read', 'never', 'shares'] };

const { tools } = await import('$lib/tools/registry-internal');
await import('./shares');
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

describe('share_links', () => {
  beforeEach(() => {});
  contract();

  it('is the only tool in its toolset: nothing creates, revokes or sets a password', () => {
    expect(tools.filter((t) => t.toolset === 'shares').map((t) => t.name)).toEqual(['share_links']);
  });

  it('reports each link\'s state and counts, and no secret or visitor row', async () => {
    const r = await run('share_links');
    expect(r.success, r.error).toBe(true);
    const d = r.data as { projects: Array<{ project: string; links: Array<Record<string, unknown>> }> };
    expect(d.projects.map((p) => p.project)).toEqual(['alpha']);
    expect(d.projects[0].links.map((l) => l.state)).toEqual(['live', 'revoked', 'expired']);
    expect(d.projects[0].links[0]).toMatchObject({ id: 'a1', label: 'Synthetic link a1', asksForPassword: true, opens: 4, browsers: 2, networks: 2, likelyForwarded: true });
    expect(JSON.stringify(r.data)).not.toMatch(/SECRET_VALUE|192\.0\.2\.1|token|passwordHash|visits|"url"/);
  });

  it('filters to live links and to one project, and refuses an unknown project', async () => {
    const live = (await run('share_links', { live_only: true, project: 'alpha' })).data as { projects: Array<{ links: unknown[] }> };
    expect(live.projects[0].links).toHaveLength(1);
    expect((await run('share_links', { project: 'beta' })).data).toMatchObject({ projects: [], message: 'No share link matched.' });
    expect((await run('share_links', { project: 'gamma' })).error).toMatch(/No project "gamma"/);
  });
});
