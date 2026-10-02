import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ inserted: [] as Array<Record<string, unknown>> }));

vi.mock('$lib/db', () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        h.inserted.push(v);
        return { returning: async () => [{ id: 'build-1' }] };
      },
    }),
  },
}));
vi.mock('./change-request', () => ({ CHANGE_REQUEST_BUDGET: { maxCostUsd: 2 } }));
vi.mock('./development-models.server', () => ({
  resolveDevelopmentModel: vi.fn(async (id: unknown) => {
    if (id === 'nope') throw new Error('Choose a build model from the available catalogue.');
    return { provider: 'openrouter', modelId: 'm' };
  }),
}));
vi.mock('./development-state.server', () => ({ ensureDelivery: vi.fn(), mutateDelivery: vi.fn() }));

import { createDevelopmentDelivery, DevelopmentModelChoiceError, liveBacklogDelivery, type BacklogDeliveryRow } from './development-create.server';
import { ensureDelivery, mutateDelivery } from './development-state.server';
import type { DeliveryState } from '$lib/constants/development';

beforeEach(() => {
  h.inserted = [];
  vi.clearAllMocks();
});

describe('createDevelopmentDelivery', () => {
  it('creates the same paused, budgeted build the New feature form does', async () => {
    const { buildId } = await createDevelopmentDelivery({ outcome: '  Make a thing\nwith detail ', area: 'News' });

    expect(buildId).toBe('build-1');
    expect(h.inserted[0]).toMatchObject({ title: 'Make a thing', prompt: 'Make a thing\nwith detail', status: 'paused', budgetConfig: { maxCostUsd: 2 } });
    expect((h.inserted[0].gitTargetConfig as Record<string, unknown>).backlogSlug).toBeUndefined();
    expect(ensureDelivery).toHaveBeenCalledWith('build-1', 'News', [], expect.objectContaining({ commissioned: true, releasePolicy: 'preview_only', autopilot: false }));
    expect(mutateDelivery).not.toHaveBeenCalled();
  });

  it('records a backlog item on the build and carries its accepted brief into the delivery', async () => {
    await createDevelopmentDelivery({
      outcome: 'Brief', title: 'A rail feed', area: 'Platform', criteria: ['It lists lines'], backlogSlug: 'rail',
      releasePolicy: 'pull_request', autopilot: true, brief: { constraints: '- Owner only', questions: '' },
    });

    expect(h.inserted[0].title).toBe('A rail feed');
    expect((h.inserted[0].gitTargetConfig as Record<string, unknown>).backlogSlug).toBe('rail');
    expect(ensureDelivery).toHaveBeenCalledWith('build-1', 'Platform', ['It lists lines'], expect.objectContaining({ releasePolicy: 'pull_request', autopilot: true }));
    const [, kind, change] = vi.mocked(mutateDelivery).mock.calls[0];
    expect(kind).toBe('brief_imported_from_backlog');
    const next = change({ brief: { outcome: 'Brief', constraints: '', routes: [], revision: 1, acceptedAt: null } } as unknown as DeliveryState);
    expect(next.brief.constraints).toBe('- Owner only');
    expect(next.brief.questions).toBeUndefined();
  });

  it('reports an unknown model as the caller\'s choice, not a fault', async () => {
    await expect(createDevelopmentDelivery({ outcome: 'x', area: 'News', modelId: 'nope' })).rejects.toBeInstanceOf(DevelopmentModelChoiceError);
    expect(h.inserted).toEqual([]);
  });
});

const row = (over: Partial<BacklogDeliveryRow> & { stage?: string; stopReason?: string }): BacklogDeliveryRow => ({
  buildId: over.buildId ?? 'b', outcome: over.outcome ?? null,
  state: { stage: (over.stage ?? 'building') as BacklogDeliveryRow['state']['stage'], autopilot: over.stopReason ? { enabled: true, rounds: 1, maxRounds: 6, startedAt: '', stopReason: over.stopReason } : undefined },
});

describe('liveBacklogDelivery', () => {
  it('treats an in-progress or open-PR delivery as still answering the item', () => {
    expect(liveBacklogDelivery([row({ buildId: 'a', stage: 'pr_open' })])?.buildId).toBe('a');
    expect(liveBacklogDelivery([row({ buildId: 'a', stage: 'brief' })])?.buildId).toBe('a');
  });

  it('lets a re-opened item start again after the last delivery shipped, stopped or was stopped by the owner', () => {
    expect(liveBacklogDelivery([row({ stage: 'deployed' })])).toBeNull();
    expect(liveBacklogDelivery([row({ stopReason: 'needs you' })])).toBeNull();
    expect(liveBacklogDelivery([row({ outcome: 'stopped_by_user' })])).toBeNull();
  });
});
