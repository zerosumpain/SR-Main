import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BacklogItemData, DeliveryRequest } from './types';

const h = vi.hoisted(() => ({
  backlog: [] as BacklogItemData[],
  attempts: [] as Array<{ slug: string; status: string; error?: string }>,
  buildRefs: [] as Array<{ slug: string; ref: string }>,
  deliveries: [] as DeliveryRequest[],
  reuse: false,
  watches: [] as Array<{ description: string }>,
  deliveryThrows: false,
}));

vi.mock('./backlog', () => ({
  listBacklog: vi.fn(async () => h.backlog),
  pickWork: vi.fn((items: BacklogItemData[], kind: string | string[], limit: number) => {
    const kinds = typeof kind === 'string' ? [kind] : kind;
    return items.filter((i) => kinds.includes(i.kind) && i.status === 'open' && !i.buildRef).slice(0, limit);
  }),
  // The real rule (tested in backlog.test.ts): an accepted brief is the tap.
  isOwnerAccepted: vi.fn((i: BacklogItemData) => Boolean(i.grooming?.acceptedAt)),
  markAttempt: vi.fn(async (item: BacklogItemData, o: { status: string; error?: string }) => {
    h.attempts.push({ slug: item.slug, status: o.status, error: o.error });
  }),
  recordBuildRef: vi.fn(async (item: BacklogItemData, ref: string) => {
    h.buildRefs.push({ slug: item.slug, ref });
  }),
}));

import { proposeFeatures } from './propose';

function item(over: Partial<BacklogItemData>): BacklogItemData {
  return {
    slug: 'x',
    title: 'X',
    detail: 'because of a thing',
    kind: 'feature',
    status: 'open',
    priority: 2,
    attempts: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

const budget = {
  llmCalls: 0,
  tokensIn: 0,
  tokensOut: 0,
  costUsd: 0,
  exceeded: false,
  call: vi.fn(async () => ({ content: '', json: {} })),
  timeLeftMs: () => 10 * 60 * 1000,
};

const lanes = {
  startDelivery: vi.fn(async (input: DeliveryRequest) => {
    if (h.deliveryThrows) throw new Error('builder unavailable');
    h.deliveries.push(input);
    if (h.reuse) return { ref: 'delivery:old999', label: 'existing delivery old999', reused: true };
    return { ref: 'delivery:abc123', label: 'delivery abc123' };
  }),
  createWatch: vi.fn(async (input: { description: string }) => {
    h.watches.push(input);
    return { ref: 'monitor:w1', label: 'watch “rail” on 0 */6 * * *' };
  }),
};

beforeEach(() => {
  h.backlog = [];
  h.attempts = [];
  h.buildRefs = [];
  h.deliveries = [];
  h.reuse = false;
  h.watches = [];
  h.deliveryThrows = false;
  vi.clearAllMocks();
});

/** An accepted brief — the owner's tap since D3. */
const tap: Pick<BacklogItemData, 'grooming'> = {
  grooming: {
    problem: 'It is missing.',
    outcome: 'It exists.',
    acceptanceCriteria: ['It works'],
    constraints: [],
    nonGoals: [],
    dependencies: [],
    implementationNotes: [],
    validation: [],
    assumptions: [],
    openQuestions: [],
    decisions: [],
    relatedItems: [],
    effort: 'small',
    risk: 'low',
    readiness: { score: 90, status: 'ready', reason: 'Clear.' },
    assistantSummary: '',
    modelId: 'test-model',
    groomedAt: '2026-09-26T08:59:00.000Z',
    acceptedAt: '2026-09-26T09:00:00.000Z',
    revision: 1,
  },
};

describe('the tap gate', () => {
  it('dispatches a repo build for an item whose brief the owner accepted', async () => {
    h.backlog = [item({ slug: 'rail', title: 'A rail feed', ...tap })];

    const actions = await proposeFeatures(budget, 'run1', { lanes });

    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0].title).toBe('A rail feed');
    // The slug travels with the ask so the lane can find an open build for it.
    expect(h.deliveries[0].backlogSlug).toBe('rail');
    expect(actions.map((a) => a.kind)).toContain('delivery_started');
    expect(h.attempts).toEqual([{ slug: 'rail', status: 'open', error: undefined }]);
  });

  it('refuses to spend on an untapped item, and says how to tap it', async () => {
    h.backlog = [item({ slug: 'rail' })];

    const actions = await proposeFeatures(budget, 'run1', { lanes });

    expect(h.deliveries).toHaveLength(0);
    expect(actions[0].detail).toContain('waiting for a tap');
    expect(actions[0].detail).toContain('accept its brief');
  });

  it('dispatches an untapped item when autobuild is explicitly on', async () => {
    h.backlog = [item({ slug: 'rail' })];

    await proposeFeatures(budget, 'run1', { lanes, autobuild: true });

    expect(h.deliveries).toHaveLength(1);
  });

  it('does not let untapped items crowd a tapped one out of the night', async () => {
    h.backlog = [
      item({ slug: 'loud-1', priority: 1 }),
      item({ slug: 'loud-2', priority: 1 }),
      item({ slug: 'quiet-but-tapped', priority: 4, ...tap }),
    ];

    await proposeFeatures(budget, 'run1', { lanes });

    expect(h.deliveries.map((c) => c.backlogSlug)).toEqual(['quiet-but-tapped']);
  });

  it('builds tool and source items through the repo lane now the toolsmith is retired', async () => {
    h.backlog = [item({ slug: 'a-tool', kind: 'tool', ...tap })];

    await proposeFeatures(budget, 'run1', { lanes });

    expect(h.deliveries.map((c) => c.backlogSlug)).toEqual(['a-tool']);
  });

  it('stops at one delivery a night, and never falls through to a blind PR', async () => {
    h.backlog = [item({ slug: 'a', ...tap }), item({ slug: 'b', ...tap })];

    const actions = await proposeFeatures(budget, 'run1', { lanes, autobuild: true });

    expect(h.deliveries).toHaveLength(1);
    expect(actions.map((a) => a.kind)).not.toContain('pr_opened');
  });

  it('points at an existing open build instead of counting an attempt or a slot', async () => {
    h.backlog = [item({ slug: 'a', ...tap }), item({ slug: 'b', ...tap })];
    h.reuse = true;

    const actions = await proposeFeatures(budget, 'run1', { lanes });

    // Both asked; both were already building, so nothing new was spent.
    expect(h.deliveries.map((c) => c.backlogSlug)).toEqual(['a', 'b']);
    expect(h.buildRefs).toEqual([
      { slug: 'a', ref: 'delivery:old999' },
      { slug: 'b', ref: 'delivery:old999' },
    ]);
    expect(h.attempts).toEqual([]);
    expect(actions.some((a) => a.detail.includes('already in development'))).toBe(true);
  });
});

describe('watches', () => {
  it('creates a monitor for a tapped watch', async () => {
    h.backlog = [item({ slug: 'w', kind: 'watch', title: 'Watch the tide', ...tap })];

    const actions = await proposeFeatures(budget, 'run1', { lanes });

    expect(h.watches[0].description).toContain('Watch the tide');
    expect(actions.map((a) => a.kind)).toContain('watch_created');
    expect(h.attempts).toEqual([{ slug: 'w', status: 'shipped', error: undefined }]);
  });

  it('holds an untapped watch — it fires on a schedule and can notify', async () => {
    h.backlog = [item({ slug: 'w', kind: 'watch' })];

    const actions = await proposeFeatures(budget, 'run1', { lanes });

    expect(h.watches).toHaveLength(0);
    expect(actions[0].detail).toContain('waiting for a tap');
  });

  it('says so when the host has no watch lane at all', async () => {
    h.backlog = [item({ slug: 'w', kind: 'watch', ...tap })];

    const actions = await proposeFeatures(budget, 'run1', { lanes: {} });

    expect(actions[0].detail).toContain('no watch lane');
  });
});

describe('a host without the delivery lane', () => {
  it('dispatches nothing, writes no code and says why', async () => {
    h.backlog = [item({ slug: 'rail', ...tap })];

    const actions = await proposeFeatures(budget, 'run1', { lanes: { createWatch: lanes.createWatch } });

    expect(actions.map((a) => a.detail)).toContain('no delivery lane on this host — nothing dispatched');
    expect(actions.map((a) => a.kind)).not.toContain('pr_opened');
    expect(budget.call).not.toHaveBeenCalled();
    expect(h.attempts).toEqual([]);
  });
});

describe('failures', () => {
  it('records a failed dispatch against the item instead of sinking the phase', async () => {
    h.backlog = [item({ slug: 'rail', ...tap })];
    h.deliveryThrows = true;

    const actions = await proposeFeatures(budget, 'run1', { lanes });

    expect(h.attempts).toEqual([{ slug: 'rail', status: 'open', error: 'builder unavailable' }]);
    expect(actions.some((a) => a.detail.includes('builder unavailable'))).toBe(true);
  });
});

describe('the delivery handed to /jkai/develop', () => {
  it('names where it came from and refuses to license weakening a gate', async () => {
    h.backlog = [item({ slug: 'rail', source: 'think', ...tap })];

    await proposeFeatures(budget, 'run7', { lanes });

    const req = h.deliveries[0].outcome;
    // The accepted brief, not the raw detail, is what the builder reads.
    expect(req).toContain('It is missing.');
    expect(req).toContain('`rail`');
    expect(req).toContain('`think` channel');
    expect(req).toContain('run7');
    expect(req).toContain('Do not weaken a gate');
  });

  it('hands an accepted structured brief to the builder instead of making it infer done', async () => {
    h.backlog = [item({
      slug: 'groomed',
      grooming: {
        problem: 'The backlog modal is hard to use.',
        outcome: 'A clear three-step grooming journey.',
        acceptanceCriteria: ['The user can ask the model questions', 'The user applies suggestions explicitly'],
        constraints: ['Use the configured default model'],
        nonGoals: ['Do not auto-merge'],
        dependencies: [],
        implementationNotes: ['Persist only the accepted structured brief'],
        validation: ['Run route tests', 'Run the Svelte check'],
        assumptions: [],
        openQuestions: ['Should transcript history persist?'],
        decisions: ['Keep transcript ephemeral'],
        relatedItems: [],
        effort: 'medium',
        risk: 'medium',
        readiness: { score: 64, status: 'needs_input', reason: 'One question remains.' },
        assistantSummary: 'Drafted the contract.',
        modelId: 'default-test-model',
        groomedAt: '2026-09-04T09:00:00.000Z',
        acceptedAt: '2026-09-04T09:01:00.000Z',
        revision: 1,
      },
    })];

    await proposeFeatures(budget, 'run8', { lanes, autobuild: true });

    const req = h.deliveries[0].outcome;
    expect(req).toContain('Acceptance criteria');
    expect(req).toContain('The user can ask the model questions');
    expect(req).toContain('Validation');
    expect(req).toContain('Use the configured default model');
    expect(req).toContain('Remaining open questions');
  });
});

describe('the accepted brief becomes delivery fields', () => {
  it('carries criteria and the brief sections the delivery holds, so grooming starts from them', async () => {
    h.backlog = [item({
      slug: 'shaped',
      title: 'A shaped feature',
      grooming: {
        ...tap.grooming!,
        acceptanceCriteria: ['The page lists every rail line', '  '],
        constraints: ['Owner only'],
        nonGoals: ['No live map'],
        dependencies: ['The rail feed'],
        validation: ['Route test'],
        assumptions: ['Feed is daily'],
        openQuestions: ['Which lines?'],
      },
    })];

    await proposeFeatures(budget, 'run9', { lanes });

    const d = h.deliveries[0];
    expect(d.title).toBe('A shaped feature');
    expect(d.backlogSlug).toBe('shaped');
    expect(d.criteria).toEqual(['The page lists every rail line']);
    expect(d.brief.constraints).toContain('- Owner only');
    expect(d.brief.constraints).toContain('Not in scope: No live map');
    expect(d.brief.dependencies).toBe('- The rail feed');
    expect(d.brief.validation).toBe('- Route test');
    expect(d.brief.assumptions).toBe('- Feed is daily');
    expect(d.brief.questions).toBe('- Which lines?');
    expect(d.outcome.length).toBeLessThanOrEqual(20_000);
  });

  it('sends an ungroomed autobuild item with its detail and no invented criteria', async () => {
    h.backlog = [item({ slug: 'raw', detail: 'Plain words only' })];

    await proposeFeatures(budget, 'run9', { lanes, autobuild: true });

    expect(h.deliveries[0].criteria).toEqual([]);
    expect(h.deliveries[0].brief).toEqual({});
    expect(h.deliveries[0].outcome).toContain('Plain words only');
  });

  it('records the delivery on the item so the backlog links to /jkai/develop', async () => {
    const { markAttempt } = await import('./backlog');
    h.backlog = [item({ slug: 'rail', ...tap })];

    await proposeFeatures(budget, 'run1', { lanes });

    expect(vi.mocked(markAttempt).mock.calls[0][1]).toMatchObject({ status: 'open', runId: 'run1', buildRef: 'delivery:abc123' });
  });

  it('stops dispatching when the wall clock reserve is reached', async () => {
    h.backlog = [item({ slug: 'rail', ...tap })];

    await proposeFeatures({ ...budget, timeLeftMs: () => 1000 }, 'run1', { lanes });

    expect(h.deliveries).toHaveLength(0);
  });
});
