import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The develop toolset's handlers (slice 6b): what they hand `commissionBuild`,
 * the request_change alias, and the refusals said before anything runs. The
 * lane itself (token + session) is pinned in principal-enforcement.test.ts
 * and the invoke route tests.
 */
const h = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/jkai/commission/commission.server', () => ({
  commissionBuild: async (input: Record<string, unknown>) => {
    h.calls.push(input);
    return { ok: true, buildId: 'b1', href: '/jkai/develop/b1', deepLink: 'sr://develop/b1', reused: false, started: false, note: 'n' };
  },
  quoteCommission: async (input: Record<string, unknown>) => ({ card: 'card', ...input }),
}));

const { tools } = await import('../registry-internal');
await import('./develop');
const tool = (name: string) => tools.find((t) => t.name === name)!;
const ctx = {
  emit: () => {},
  conversationId: 'conv-1',
  surface: 'web' as const,
  principal: { principalId: 'owner', via: 'session' as const, attended: true, jobId: 'j' },
  modelContext: { provider: 'codex', modelId: 'codex/gpt-5' } as never,
};

beforeEach(() => {
  h.calls = [];
});

describe('develop_commission', () => {
  it('hands commissionBuild the principal, thread, surface and pinned model', async () => {
    const r = await tool('develop_commission').handler({ outcome: 'Add X', releasePolicy: 'pull_request', operationKey: 'op-key-123' }, ctx);
    expect(r).toMatchObject({ success: true, data: { buildId: 'b1', href: '/jkai/develop/b1', deepLink: 'sr://develop/b1', started: false } });
    expect(h.calls[0]).toMatchObject({ source: 'chat', outcome: 'Add X', releasePolicy: 'pull_request', autopilot: true, conversationId: 'conv-1', surface: 'web', operationKey: 'op-key-123', pinnedModelId: 'codex/gpt-5', principal: ctx.principal });
  });

  it('refuses production from chat before commissioning', async () => {
    const r = await tool('develop_commission').handler({ outcome: 'Add X', releasePolicy: 'production' }, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/production/);
    expect(h.calls).toHaveLength(0);
  });

  it('refuses a member', async () => {
    const r = await tool('develop_commission').handler({ outcome: 'x' }, { ...ctx, principalId: 'u_kid' });
    expect(r.success).toBe(false);
    expect(h.calls).toHaveLength(0);
  });

  it('attaches a delivery watcher', () => {
    expect(tool('develop_commission').producesLongRunningTask).toMatchObject({ kind: 'delivery', idPath: 'buildId' });
  });
});

describe('request_change (the alias, decision 6)', () => {
  it('is develop_commission stopping at a draft pull request, on the same lane', async () => {
    expect(tool('request_change')).toMatchObject({ effect: 'mutate', confirm: 'always', lane: 'commission' });
    expect(tool('request_change').destructive).toBeUndefined();
    await tool('request_change').handler({ title: 'Tide times page', request: 'A page at /projects/tide-times' }, ctx);
    expect(h.calls[0]).toMatchObject({ source: 'chat', outcome: 'Tide times page\n\nA page at /projects/tide-times', releasePolicy: 'pull_request' });
  });

  it('no longer promises 30-60 minutes or an auto-merge', () => {
    expect(tool('request_change').description).not.toMatch(/30-60|auto-merge/);
  });
});

describe('develop_quote', () => {
  it('passes the stop point through and refuses an unknown one', async () => {
    expect(await tool('develop_quote').handler({ releasePolicy: 'pull_request', outcome: 'Add X' }, ctx)).toMatchObject({ success: true, data: { releasePolicy: 'pull_request', outcome: 'Add X' } });
    expect((await tool('develop_quote').handler({ releasePolicy: 'production' }, ctx)).success).toBe(false);
  });
});
