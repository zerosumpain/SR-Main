import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolPrincipal } from '$lib/tools/invoke-contract';

/**
 * `commissionBuild`'s order of work, with the database and the sidecar faked
 * (slice 6b): idempotency, the cost guards, intake as 'chat', the model rule,
 * the commission record, and what happens when the builder is down.
 */
const h = vi.hoisted(() => ({
  byKey: null as string | null,
  live: [] as Array<{ state: unknown; outcome: string | null }>,
  thread: true,
  mark: null as { fiveHourPct: number; weeklyPct: number } | null,
  created: [] as Array<Record<string, unknown>>,
  intake: [] as unknown[],
  backlogLive: null as { buildId: string } | null,
  capabilities: { persistentSessions: true, brokerConfigured: true } as unknown,
  mutated: [] as string[],
  badModel: false,
}));

vi.mock('$lib/db', () => {
  const chain = (fields: Record<string, unknown>) => {
    const keys = Object.keys(fields ?? {}).sort().join(',');
    const result = async () => {
      if (keys === 'buildId') return h.byKey ? [{ buildId: h.byKey }] : [];
      if (keys === 'outcome,state') return h.live;
      if (keys === 'id') return h.thread ? [{ id: 'conv-1' }] : [];
      return [];
    };
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'innerJoin', 'where', 'orderBy']) c[m] = () => c;
    c.limit = result;
    return c;
  };
  return { db: { select: (fields: Record<string, unknown>) => chain(fields) } };
});
vi.mock('$lib/daydream/budget', () => ({ readQuotaMark: async () => h.mark }));
vi.mock('$lib/selfimprove/backlog', () => ({
  intakeIdeas: async (ideas: unknown[]) => {
    h.intake.push(...ideas);
    return { added: ['add-x-to-the-backlog-page'], merged: [], capped: 0, outcomes: ['added'] };
  },
}));
vi.mock('$lib/selfimprove/types', () => ({ slugifyIdea: (t: string) => t.toLowerCase().replace(/\W+/g, '-') }));
vi.mock('../development-create.server', () => {
  class DevelopmentModelChoiceError extends Error {}
  return {
    DevelopmentModelChoiceError,
    findBacklogDelivery: async () => h.backlogLive,
    createDevelopmentDelivery: async (input: Record<string, unknown>) => {
      if (h.badModel && input.modelId !== undefined) throw new DevelopmentModelChoiceError('Choose a build model');
      h.created.push(input);
      return { buildId: `build-${h.created.length}`, model: { provider: 'codex', modelId: 'm' } };
    },
  };
});
vi.mock('../development-state.server', () => ({
  mutateDelivery: async (_id: string, kind: string) => {
    h.mutated.push(kind);
    return {};
  },
}));
vi.mock('../builder-client', () => ({
  builderClient: {
    developmentCapabilities: async () => {
      if (h.capabilities instanceof Error) throw h.capabilities;
      return h.capabilities;
    },
  },
}));

const { commissionBuild, derivedOperationKey, quoteCommission } = await import('./commission.server');

const OWNER: ToolPrincipal = { principalId: 'owner', via: 'session', attended: true, jobId: 'j' };
const ask = (over: Record<string, unknown> = {}) =>
  commissionBuild({ source: 'chat', principal: OWNER, outcome: 'Add X to the backlog page', conversationId: 'chat_conv-1', ...over } as never);

beforeEach(() => {
  Object.assign(h, {
    byKey: null, live: [], thread: true, mark: { fiveHourPct: 20, weeklyPct: 10 }, created: [], intake: [], backlogLive: null,
    capabilities: { persistentSessions: true, brokerConfigured: true }, mutated: [], badModel: false,
  });
});

describe('commissionBuild', () => {
  it('commissions a delivery from chat with the commission recorded on it', async () => {
    const r = await ask({ releasePolicy: 'pull_request', surface: 'web' });
    expect(r).toMatchObject({ ok: true, buildId: 'build-1', href: '/jkai/develop/build-1', deepLink: 'sr://develop/build-1', reused: false, started: true });
    const input = h.created[0];
    expect(input).toMatchObject({ origin: 'chat', releasePolicy: 'pull_request', autopilot: true, backlogSlug: 'add-x-to-the-backlog-page', conversationId: 'conv-1', area: 'Platform' });
    expect(input.commission).toMatchObject({ source: 'chat', surface: 'web', conversationId: 'conv-1', requestedBy: 'owner', quotaAtStart: { fiveHourPct: 20, weeklyPct: 10 } });
    expect((input.commission as { operationKey: string }).operationKey).toBe(derivedOperationKey('conv-1', 'Add X to the backlog page'));
  });

  it('files the ask on the backlog as source chat, quoted', async () => {
    await ask();
    expect(h.intake).toEqual([expect.objectContaining({ source: 'chat', kind: 'feature', ref: 'conversation:conv-1', detail: expect.stringContaining('"Add X to the backlog page"') })]);
  });

  it('returns the same delivery for the same operationKey, without creating or counting', async () => {
    h.byKey = 'build-existing';
    h.mark = { fiveHourPct: 99, weeklyPct: 99 };
    const r = await ask({ operationKey: 'op-key-12345' });
    expect(r).toMatchObject({ ok: true, buildId: 'build-existing', reused: true });
    expect(h.created).toHaveLength(0);
    expect(h.intake).toHaveLength(0);
  });

  it('derives the same key for the same ask in the same thread', () => {
    expect(derivedOperationKey('conv-1', ' Add  X ')).toBe(derivedOperationKey('conv-1', 'add x'));
    expect(derivedOperationKey('conv-1', 'add x')).not.toBe(derivedOperationKey('conv-2', 'add x'));
  });

  it('shares one in-flight call between two identical asks', async () => {
    const [a, b] = await Promise.all([ask({ operationKey: 'op-key-twice' }), ask({ operationKey: 'op-key-twice' })]);
    expect(a).toEqual(b);
    expect(h.created).toHaveLength(1);
  });

  it('refuses over the quota ceiling with the plain message', async () => {
    h.mark = { fiveHourPct: 82, weeklyPct: 10 };
    expect(await ask()).toEqual({ ok: false, reason: "The ChatGPT window is 82% used, so I won't start a build now. Try after it resets." });
    expect(h.created).toHaveLength(0);
  });

  it('refuses a third live commission, and does not count settled ones', async () => {
    const live = { stage: 'building', criteria: [], release: undefined, autopilot: undefined };
    h.live = [{ state: live, outcome: null }, { state: { ...live, stage: 'pr_open' }, outcome: null }];
    expect((await ask()).ok).toBe(true);
    h.live = [{ state: live, outcome: null }, { state: live, outcome: null }];
    expect(await ask({ operationKey: 'op-third-one' })).toMatchObject({ ok: false, reason: expect.stringMatching(/2 commissioned builds/) });
  });

  it('refuses unattended principals and production from chat before touching anything', async () => {
    for (const principal of [
      { principalId: 'owner', via: 'heartbeat', attended: false },
      { principalId: 'owner', via: 'whatsapp', attended: false },
      { principalId: 'owner', via: 'service', attended: false, purpose: 'daydream-think' },
    ]) {
      expect((await ask({ principal })).ok).toBe(false);
    }
    expect(await ask({ releasePolicy: 'production' })).toMatchObject({ ok: false, reason: expect.stringMatching(/production/) });
    expect(h.created).toHaveLength(0);
  });

  it('builds on the owner-pinned model, and falls back to the builder workload when the builder cannot use it', async () => {
    await ask({ pinnedModelId: 'codex/gpt-5' });
    expect(h.created[0].modelId).toBe('codex/gpt-5');
    await ask({ operationKey: 'op-unpinned', outcome: 'Another thing' });
    expect(h.created[1].modelId).toBeUndefined();
    h.badModel = true;
    expect((await ask({ operationKey: 'op-bad-model', outcome: 'Third', pinnedModelId: 'nope' })).ok).toBe(true);
    expect(h.created[2].modelId).toBeUndefined();
  });

  it('reuses a live delivery already working on the same backlog item', async () => {
    h.backlogLive = { buildId: 'build-nightly' };
    expect(await ask()).toMatchObject({ ok: true, buildId: 'build-nightly', reused: true });
    expect(h.created).toHaveLength(0);
  });

  it('drops a thread that is not the owner’s', async () => {
    h.thread = false;
    await ask();
    expect(h.created[0].conversationId).toBeUndefined();
  });

  it('says so when the builder sidecar is down, and keeps the delivery', async () => {
    h.capabilities = new Error('builder rpc developmentCapabilities: socket error: ENOENT');
    const r = await ask();
    expect(r).toMatchObject({ ok: true, buildId: 'build-1', started: false, note: expect.stringMatching(/could not be reached.*autopilot picks it up/s) });
    expect(h.mutated).toEqual(['commission_start_failed']);
  });

  it('leaves the brief for the owner with autopilot off, without asking the builder', async () => {
    h.capabilities = new Error('never asked');
    expect(await ask({ autopilot: false })).toMatchObject({ ok: true, started: true, note: expect.stringMatching(/autopilot off/) });
  });

  it('lets the nightly lane through unattended and skips its intake', async () => {
    h.mark = { fiveHourPct: 99, weeklyPct: 99 };
    expect((await commissionBuild({ source: 'selfimprove', principal: undefined, outcome: 'Nightly', releasePolicy: 'pull_request' })).ok).toBe(true);
    expect(h.intake).toHaveLength(0);
  });
});

describe('quoteCommission', () => {
  it('quotes SR-Main, the stop, $2 and the quota now', async () => {
    h.mark = { fiveHourPct: 34, weeklyPct: 12 };
    const q = await quoteCommission({ releasePolicy: 'preview_only', outcome: 'Add X' });
    expect(q).toMatchObject({ target: 'SR-Main', stopsAt: 'Preview only', budget: { maxIterations: 25, maxTotalMinutes: 120, maxCostUsd: 2 }, quota: { fiveHourPct: 34, weeklyPct: 12 }, liveCommissions: 0, refusal: null });
    expect(q.card).toContain('up to 25 rounds, 2 hours, $2');
    expect(q.card).toContain('ChatGPT 34%');
  });
});
