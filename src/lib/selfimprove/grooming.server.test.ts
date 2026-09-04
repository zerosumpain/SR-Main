import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BacklogItemData } from './types';

const h = vi.hoisted(() => ({
  backlog: [] as BacklogItemData[],
  resolveDefaultModel: vi.fn(async () => ({ provider: 'openrouter', modelId: 'owner-default' })),
  create: vi.fn(),
}));

vi.mock('./backlog', () => ({ listBacklog: vi.fn(async () => h.backlog) }));
vi.mock('$lib/server/models/settings', () => ({ resolveDefaultModel: h.resolveDefaultModel }));
vi.mock('$lib/llm/client', () => ({
  getLLMClient: vi.fn(async () => ({ client: { chat: { completions: { create: h.create } } }, model: 'resolved-default' })),
}));
vi.mock('$lib/context/activity', () => ({
  withActivity: vi.fn(async (_activity: string, fn: () => Promise<unknown>) => fn()),
}));

import { groomBacklogDraft, relatedCandidates } from './grooming.server';

function item(over: Partial<BacklogItemData>): BacklogItemData {
  return {
    slug: 'x',
    title: 'X',
    detail: '',
    kind: 'feature',
    status: 'open',
    priority: 3,
    attempts: 0,
    createdAt: '2026-09-04T09:00:00.000Z',
    updatedAt: '2026-09-04T09:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.backlog = [];
  h.create.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({
      assistantMessage: 'The main decision is whether removal is reversible.',
      suggestions: { title: 'AI backlog grooming', detail: 'A clear journey.', kind: 'feature', priority: 2 },
      grooming: {
        problem: 'Rough backlog items leave the builder guessing.',
        outcome: 'Every accepted item carries an implementation contract.',
        acceptanceCriteria: ['Ask questions', 'Apply explicitly', 'Save the contract'],
        validation: ['Run route tests'],
        implementationNotes: ['Use the existing owner-gated endpoint'],
        openQuestions: [],
        relatedItems: [
          { slug: 'known-related', relation: 'related', reason: 'Both improve backlog planning.' },
          { slug: 'invented-by-model', relation: 'duplicate', reason: 'Not a supplied id.' },
        ],
        effort: 'medium',
        risk: 'low',
      },
    }) } }],
  });
});

describe('interactive grooming server', () => {
  it('ranks candidate relationships by shared content and excludes the current item', () => {
    const candidates = relatedCandidates([
      item({ slug: 'current', title: 'AI backlog grooming' }),
      item({ slug: 'close', title: 'Backlog planning with AI questions' }),
      item({ slug: 'far', title: 'Weather source', detail: 'Forecast temperatures' }),
    ], { slug: 'current', title: 'AI backlog grooming', detail: 'Ask planning questions' });
    expect(candidates.map((candidate) => candidate.slug)).toEqual(['close']);
  });

  it('uses the configured default model and keeps relations inside supplied candidate ids', async () => {
    h.backlog = [item({
      slug: 'known-related',
      title: 'Backlog planning assistant',
      detail: 'Use AI to improve backlog planning.',
    })];

    const result = await groomBacklogDraft({
      slug: 'current',
      title: 'AI backlog grooming',
      detail: 'Use AI to improve backlog planning and ask questions.',
      kind: 'feature',
      priority: 3,
    });

    expect(h.resolveDefaultModel).toHaveBeenCalledOnce();
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ model: 'resolved-default' }));
    expect(result.model).toBe('resolved-default');
    expect(result.grooming.modelId).toBe('resolved-default');
    expect(result.grooming.relatedItems.map((relation) => relation.slug)).toEqual(['known-related']);
    expect(result.grooming.readiness.status).toBe('ready');
  });

  it('fails visibly instead of silently accepting a non-JSON answer', async () => {
    h.create.mockResolvedValueOnce({ choices: [{ message: { content: 'Here is a prose answer.' } }] });
    await expect(groomBacklogDraft({
      title: 'A feature', detail: 'A rough brief', kind: 'feature', priority: 3,
    })).rejects.toThrow(/no usable grooming draft/);
  });
});
