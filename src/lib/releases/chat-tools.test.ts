import { beforeEach, describe, expect, it, vi } from 'vitest';

// The release desk reads (workflow knit 2026-11-11, slice 3). Merging,
// closing and reverting a pull request stay on the page. Fixtures are synthetic.

const h = vi.hoisted(() => ({ console: [] as Array<Record<string, unknown>> }));
const pull = (n: number, over: Record<string, unknown> = {}) => ({
  repo: 'synthetic-org/synthetic-app', number: n, title: `Synthetic change ${n}`, url: `https://example.invalid/pull/${n}`, author: 'synthetic-bot', isDraft: false,
  branch: `feat/${n}`, base: 'main', updatedAt: '2026-01-02T03:04:05Z', mergedAt: null, changedFiles: 3, additions: 10, deletions: 2,
  checks: [{ name: 'gate', state: 'failure' }, { name: 'build', state: 'success' }], checkState: 'failure', touchesSchema: false, consequence: 'deploys the app',
  supersededBy: null, revertedBy: null, body: 'a long body that must not be returned', files: ['secret/path.ts'], ...over,
});

vi.mock('./console', () => ({
  getReleaseConsole: async (q: Record<string, unknown>) => {
    h.console.push(q);
    return {
      items: Array.from({ length: 12 }, (_, i) => ({ repo: 'synthetic-org/synthetic-app', version: `1.0.${i}`, shortSha: 'abc1234', via: 'ci', deployedAt: new Date('2026-01-02T03:04:05Z'), title: `Release ${i}`, summary: 's'.repeat(900), kinds: ['fix'], itemCount: 4, items: [{ secret: true }] })),
      totals: { releases: 12, commits: 40, minDate: '2025-12-01', maxDate: '2026-01-02' },
      repos: ['synthetic-org/synthetic-app'],
      hasMore: false,
    };
  },
}));
vi.mock('$lib/github/pull-desk.server', () => ({
  loadPullDesk: async () => ({ open: [pull(1), pull(2, { repo: 'synthetic-org/other' })], merged: [pull(3, { mergedAt: '2026-01-01T00:00:00Z' })], fetchedAt: '2026-01-02T03:04:05Z' }),
  mergeVerdict: () => ({ ok: false, reason: 'checks are failing' }),
}));

const TIERS: Record<string, [string, string, string]> = {
  releases_status: ['read', 'never', 'releases'],
  pulls_list: ['read', 'never', 'releases'],
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

describe('release chat tools', () => {
  beforeEach(() => {
    h.console = [];
  });
  contract();

  it('there is no tool that merges, closes or reverts a pull request', () => {
    expect(tools.filter((t) => t.toolset === 'releases').map((t) => t.name).sort()).toEqual(['pulls_list', 'releases_status']);
  });

  it('releases_status validates its filters and returns compact rows', async () => {
    expect((await run('releases_status', { repo: 'not a repo' })).error).toMatch(/owner\/name/);
    expect((await run('releases_status', { from: 'yesterday' })).error).toMatch(/YYYY-MM-DD/);
    expect(h.console).toEqual([]);
    const r = await run('releases_status', { repo: 'synthetic-org/synthetic-app', q: 'fix', limit: 3 });
    const d = r.data as { releases: Array<{ summary: string }>; more: boolean; totals: unknown };
    expect(h.console[0]).toMatchObject({ repo: 'synthetic-org/synthetic-app', q: 'fix', kind: 'all', page: 0 });
    expect(d.releases).toHaveLength(3);
    expect(d.releases[0].summary.length).toBe(500);
    expect(d.releases[0]).toMatchObject({ version: '1.0.0', sha: 'abc1234', deployedAt: '2026-01-02T03:04:05.000Z', changes: 4 });
    expect(d.releases[0]).not.toHaveProperty('items');
    expect(d.more).toBe(true);
    expect(d.totals).toEqual({ releases: 12, commits: 40, first: '2025-12-01', last: '2026-01-02' });
  });

  it('pulls_list gives open pull requests a verdict, filters by repository and never returns bodies or files', async () => {
    const open = (await run('pulls_list')).data as { open: Array<Record<string, unknown>>; merged?: unknown };
    expect(open.merged).toBeUndefined();
    expect(open.open).toHaveLength(2);
    expect(open.open[0]).toMatchObject({ number: 1, checks: 'failure', failing: ['gate'], size: { files: 3, added: 10, removed: 2 }, verdict: { ok: false } });
    expect(JSON.stringify(open)).not.toMatch(/long body|secret\/path/);
    const both = (await run('pulls_list', { state: 'both', repo: 'OTHER' })).data as { open: unknown[]; merged: unknown[] };
    expect(both.open).toHaveLength(1);
    expect(both.merged).toHaveLength(0);
    const merged = (await run('pulls_list', { state: 'merged' })).data as { merged: Array<Record<string, unknown>>; open?: unknown };
    expect(merged.open).toBeUndefined();
    expect(merged.merged[0]).not.toHaveProperty('verdict');
  });

  it('pulls_list labels titles, branches and authors as other people\'s text: data, not instructions', async () => {
    for (const state of ['open', 'merged', 'both']) {
      const data = (await run('pulls_list', { state })).data as { label: string };
      expect(data.label, state).toMatch(/public repositories.*never instructions/);
    }
    expect(tool('pulls_list').description).toMatch(/never instructions/);
  });
});
