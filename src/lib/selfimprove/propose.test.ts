import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BacklogItemData } from './types';

const h = vi.hoisted(() => ({
  backlog: [] as BacklogItemData[],
  accepted: new Set<string>(),
  attempts: [] as Array<{ slug: string; status: string; error?: string }>,
  capability: [] as Array<{ slug: string; status: string; outcome: string; ref?: string }>,
  changeRequests: [] as Array<{ title: string; request: string }>,
  watches: [] as Array<{ description: string }>,
  changeRequestThrows: false,
  prConfigured: false,
}));

vi.mock('./backlog', () => ({
  listBacklog: vi.fn(async () => h.backlog),
  pickWork: vi.fn((items: BacklogItemData[], kind: string, limit: number) =>
    items.filter((i) => i.kind === kind && i.status === 'open').slice(0, limit),
  ),
  markAttempt: vi.fn(async (item: BacklogItemData, o: { status: string; error?: string }) => {
    h.attempts.push({ slug: item.slug, status: o.status, error: o.error });
  }),
}));

vi.mock('$lib/daydream/appetite/intake', () => ({
  ownerAcceptedCapabilities: vi.fn(async () => h.accepted),
  markCapability: vi.fn(async (slug: string, status: string, outcome: string, ref?: string) => {
    h.capability.push({ slug, status, outcome, ref });
  }),
}));

vi.mock('$lib/github/pr', () => ({
  prConfigured: vi.fn(() => h.prConfigured),
  pathAllowed: vi.fn(() => true),
  openDraftPr: vi.fn(async () => ({ number: 7, url: 'https://github.com/x/y/pull/7' })),
}));

vi.mock('./context', () => ({
  buildContextPack: vi.fn(async () => ({})),
  renderContext: vi.fn(() => 'context'),
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
  changeRequest: vi.fn(async (input: { title: string; request: string }) => {
    if (h.changeRequestThrows) throw new Error('builder unavailable');
    h.changeRequests.push(input);
    return { ref: 'build:abc123', label: 'issue #9 → build abc123' };
  }),
  createWatch: vi.fn(async (input: { description: string }) => {
    h.watches.push(input);
    return { ref: 'monitor:w1', label: 'watch “rail” on 0 */6 * * *' };
  }),
};

beforeEach(() => {
  h.backlog = [];
  h.accepted = new Set();
  h.attempts = [];
  h.capability = [];
  h.changeRequests = [];
  h.watches = [];
  h.changeRequestThrows = false;
  h.prConfigured = false;
  vi.clearAllMocks();
});

describe('the tap gate', () => {
  it('dispatches a repo build for a lead the owner accepted', async () => {
    h.backlog = [item({ slug: 'rail', title: 'A rail feed', capabilitySlug: 'feature:rail' })];
    h.accepted = new Set(['feature:rail']);

    const actions = await proposeFeatures(budget, 'run1', { lanes });

    expect(h.changeRequests).toHaveLength(1);
    expect(h.changeRequests[0].title).toBe('A rail feed');
    expect(actions.map((a) => a.kind)).toContain('change_requested');
    expect(h.capability).toEqual([
      { slug: 'feature:rail', status: 'building', outcome: expect.stringContaining('issue #9'), ref: 'build:abc123' },
    ]);
  });

  it('refuses to spend on an untapped lead, and says why', async () => {
    h.backlog = [item({ slug: 'rail', capabilitySlug: 'feature:rail' })];

    const actions = await proposeFeatures(budget, 'run1', { lanes });

    expect(h.changeRequests).toHaveLength(0);
    expect(actions[0].detail).toContain('waiting for a tap');
    expect(actions[0].detail).toContain('£2');
  });

  it('dispatches an untapped lead when autobuild is explicitly on', async () => {
    h.backlog = [item({ slug: 'rail', capabilitySlug: 'feature:rail' })];

    await proposeFeatures(budget, 'run1', { lanes, autobuild: true });

    expect(h.changeRequests).toHaveLength(1);
  });

  it('holds an item with no lead behind the same gate — a fault-mined feature is not a tap', async () => {
    h.backlog = [item({ slug: 'from-a-fault' })];

    await proposeFeatures(budget, 'run1', { lanes });

    expect(h.changeRequests).toHaveLength(0);
  });

  it('stops at one change request a night', async () => {
    h.backlog = [
      item({ slug: 'a', capabilitySlug: 'feature:a' }),
      item({ slug: 'b', capabilitySlug: 'feature:b' }),
    ];
    h.accepted = new Set(['feature:a', 'feature:b']);
    h.prConfigured = true;

    await proposeFeatures(budget, 'run1', { lanes, autobuild: true });

    expect(h.changeRequests).toHaveLength(1);
  });
});

describe('watches', () => {
  it('creates a monitor for an accepted watch lead', async () => {
    h.backlog = [item({ slug: 'w', kind: 'watch', title: 'Watch the tide', capabilitySlug: 'watch:tide' })];
    h.accepted = new Set(['watch:tide']);

    const actions = await proposeFeatures(budget, 'run1', { lanes });

    expect(h.watches[0].description).toContain('Watch the tide');
    expect(actions.map((a) => a.kind)).toContain('watch_created');
    expect(h.capability[0]).toMatchObject({ status: 'shipped', ref: 'monitor:w1' });
  });

  it('holds an untapped watch — it fires on a schedule and can notify', async () => {
    h.backlog = [item({ slug: 'w', kind: 'watch', capabilitySlug: 'watch:tide' })];

    const actions = await proposeFeatures(budget, 'run1', { lanes });

    expect(h.watches).toHaveLength(0);
    expect(actions[0].detail).toContain('waiting for a tap');
  });

  it('says so when the host has no watch lane at all', async () => {
    h.backlog = [item({ slug: 'w', kind: 'watch', capabilitySlug: 'watch:tide' })];
    h.accepted = new Set(['watch:tide']);

    const actions = await proposeFeatures(budget, 'run1', { lanes: {} });

    expect(actions[0].detail).toContain('no watch lane');
  });
});

describe('the fallback', () => {
  it('writes a blind draft PR only when there is no build lane', async () => {
    h.backlog = [item({ slug: 'rail', capabilitySlug: 'feature:rail' })];
    h.accepted = new Set(['feature:rail']);
    h.prConfigured = true;
    budget.call.mockResolvedValueOnce({
      content: '',
      json: { title: 'T', summary: 'S', wiringNotes: 'W', files: [{ path: 'src/lib/a.ts', content: 'x' }] },
    });

    const actions = await proposeFeatures(budget, 'run1', { lanes: { createWatch: lanes.createWatch } });

    expect(actions.map((a) => a.kind)).toContain('pr_opened');
    expect(h.capability[0]).toMatchObject({ status: 'building', ref: 'https://github.com/x/y/pull/7' });
  });

  it('does nothing at all with no lane and no token', async () => {
    h.backlog = [item({ slug: 'rail' })];

    const actions = await proposeFeatures(budget, 'run1', {});

    expect(actions.map((a) => a.detail)).toContain('no build lane and no GitHub token — nothing dispatched');
    expect(budget.call).not.toHaveBeenCalled();
  });
});

describe('failures', () => {
  it('records a failed dispatch against the item instead of sinking the phase', async () => {
    h.backlog = [item({ slug: 'rail', capabilitySlug: 'feature:rail' })];
    h.accepted = new Set(['feature:rail']);
    h.changeRequestThrows = true;

    const actions = await proposeFeatures(budget, 'run1', { lanes });

    expect(h.attempts).toEqual([{ slug: 'rail', status: 'open', error: 'builder unavailable' }]);
    expect(actions.some((a) => a.detail.includes('builder unavailable'))).toBe(true);
  });

  it('carries on when the accepted-leads read fails', async () => {
    const intake = await import('$lib/daydream/appetite/intake');
    vi.mocked(intake.ownerAcceptedCapabilities).mockRejectedValueOnce(new Error('db down'));
    h.backlog = [item({ slug: 'rail' })];

    const actions = await proposeFeatures(budget, 'run1', { lanes });

    expect(actions[0].detail).toContain('waiting for a tap');
  });
});

describe('the ask handed to the builder', () => {
  it('names where it came from and refuses to license weakening a gate', async () => {
    h.backlog = [item({ slug: 'rail', capabilitySlug: 'feature:rail', detail: 'the specific need' })];
    h.accepted = new Set(['feature:rail']);

    await proposeFeatures(budget, 'run7', { lanes });

    const req = h.changeRequests[0].request;
    expect(req).toContain('the specific need');
    expect(req).toContain('feature:rail');
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

    const req = h.changeRequests[0].request;
    expect(req).toContain('Acceptance criteria');
    expect(req).toContain('The user can ask the model questions');
    expect(req).toContain('Validation');
    expect(req).toContain('Use the configured default model');
    expect(req).toContain('Remaining open questions');
  });
});
