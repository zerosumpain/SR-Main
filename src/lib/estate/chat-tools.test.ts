import { beforeEach, describe, expect, it, vi } from 'vitest';

// The estate and connection tools (workflow knit 2026-11-11, slices 3 and 4).
// The two writes are a pull of health data and a read test of a mail account;
// reconnecting an account and testing a credential stay on the page.
// Fixtures are synthetic.

const h = vi.hoisted(() => ({ synced: 0, syncOk: true, listed: [] as unknown[] }));
const report = (key: string, status: string, over: Record<string, unknown> = {}) => ({ key, label: `Synthetic ${key}`, group: 'accounts', tier: 'core', status, detail: 'd'.repeat(500), token: 'SECRET_VALUE', ...over });

vi.mock('./probe.server', () => ({ probeEstate: async () => ({ web: 'up', db: 'up', runner: 'down', mystery: 'unknown' }) }));
vi.mock('./vitals.server', () => ({
  readHostCards: async () => [{ id: 'h1', label: 'Synthetic host', role: 'app', state: 'ok', reason: null, concerns: [], services: 3, address: '192.0.2.10', vitals: { mem: { usedPct: 40 }, disk: { usedPct: 55 }, load: [0.5, 0.4, 0.3] } }],
}));
vi.mock('$lib/connectors/probes', () => ({
  probeAll: async () => [report('gmail:1', 'ok'), report('whoop', 'broken', { fixUrl: '/admin/connections', needsResync: true }), report('bank', 'unconfigured')],
}));
vi.mock('$lib/connectors/types', () => ({
  sortReports: (r: unknown[]) => r,
  needsResync: (r: Array<{ status: string }>) => r.filter((x) => x.status === 'broken'),
}));
vi.mock('$lib/server/health-service', () => ({
  syncWhoop: async () => (h.synced++, h.syncOk ? { success: true, recordsSynced: 7, errors: [] } : { success: false, recordsSynced: 0, errors: ['the provider said no'] }),
}));
vi.mock('$lib/db', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => (h.listed.length > 100 ? [] : [{ id: 1, refreshToken: 'SECRET_VALUE' }]) }) }) }) } }));
vi.mock('$lib/db/schema', () => ({ gmailAccounts: { id: 'id' } }));
vi.mock('$lib/integrations/gmail/owner-accounts', () => ({ ownerGmailWhere: (w: unknown) => w }));
vi.mock('$lib/integrations/gmail/service', () => ({ gmailService: { listMessages: async (...a: unknown[]) => (h.listed.push(a.slice(1)), ['m1', 'm2']) } }));

const TIERS: Record<string, [string, string, string]> = {
  estate_status: ['read', 'never', 'estate'],
  connector_status: ['read', 'never', 'estate'],
  connector_resync: ['mutate', 'light', 'estate'],
  connector_test: ['mutate', 'light', 'estate'],
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

describe('estate chat tools', () => {
  beforeEach(() => {
    h.synced = 0;
    h.syncOk = true;
    h.listed = [];
  });
  contract();

  it('estate_status counts the probes and describes hosts without an address', async () => {
    const r = await run('estate_status');
    expect(r.data).toMatchObject({ hosts: [{ id: 'h1', label: 'Synthetic host', state: 'ok', memoryUsedPct: 40, diskUsedPct: 55, load: 0.5 }], probes: { up: 2, total: 4 }, down: ['runner'], unknown: ['mystery'] });
    expect(JSON.stringify(r.data)).not.toMatch(/192\.0\.2\.10|"address"/);
  });

  it('connector_status counts by state, filters, and never returns a token', async () => {
    const all = (await run('connector_status')).data as { counts: Record<string, number>; needsYou: number; connections: Array<{ key: string; detail: string }> };
    expect(all.counts).toEqual({ ok: 1, degraded: 0, broken: 1, unconfigured: 1 });
    expect(all.needsYou).toBe(1);
    expect(all.connections[0].detail.length).toBe(300);
    expect(JSON.stringify(all)).not.toMatch(/SECRET_VALUE|token/);
    expect(((await run('connector_status', { status: 'broken' })).data as { connections: Array<{ key: string }> }).connections.map((c) => c.key)).toEqual(['whoop']);
    expect(((await run('connector_status', { attention_only: true })).data as { connections: unknown[] }).connections).toHaveLength(1);
  });

  it('connector_resync pulls the one service it knows and reports a failed sync as a failure', async () => {
    expect((await run('connector_resync', { service: 'bank' })).error).toMatch(/whoop/);
    expect(h.synced).toBe(0);
    expect((await run('connector_resync', { service: 'whoop' })).data).toMatchObject({ service: 'whoop', recordsSynced: 7 });
    h.syncOk = false;
    expect(await run('connector_resync', { service: 'whoop' })).toMatchObject({ success: false, error: 'the provider said no' });
  });

  it('connector_test reads a mail account and refuses any other key', async () => {
    expect((await run('connector_test', { key: 'bank' })).error).toMatch(/gmail:1/);
    expect((await run('connector_test', { key: 'gmail:x' })).success).toBe(false);
    expect(h.listed).toEqual([]);
    const r = await run('connector_test', { key: 'gmail:1' });
    expect(r.data).toMatchObject({ key: 'gmail:1', ok: true, read: 2 });
    expect(h.listed).toEqual([['newer_than:1d', 5]]);
    expect(JSON.stringify(r.data)).not.toMatch(/SECRET_VALUE/);
  });
});
