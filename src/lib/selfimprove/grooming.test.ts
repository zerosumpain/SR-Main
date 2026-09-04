import { describe, expect, it } from 'vitest';
import {
  acceptGrooming,
  calculateReadiness,
  normaliseGrooming,
  renderBacklogBrief,
  stringList,
} from './grooming';
import type { BacklogItemData } from './types';

describe('backlog grooming', () => {
  it('scores readiness from the actual contract and blocks on open questions', () => {
    const ready = calculateReadiness({
      problem: 'People cannot revise queued work.',
      outcome: 'They can revise it safely.',
      acceptanceCriteria: ['Can add', 'Can edit', 'Can remove'],
      validation: ['CRUD route tests pass'],
      implementationNotes: ['Reuse the existing owner gate'],
      openQuestions: [],
    });
    expect(ready.status).toBe('ready');
    expect(ready.score).toBeGreaterThanOrEqual(80);

    const blocked = calculateReadiness({
      problem: 'Known',
      outcome: 'Known',
      acceptanceCriteria: ['One', 'Two', 'Three'],
      validation: ['Test it'],
      implementationNotes: ['Use the existing route'],
      openQuestions: ['Should removal be reversible?'],
    });
    expect(blocked.status).toBe('needs_input');
    expect(blocked.reason).toContain('1 open question');
  });

  it('deduplicates, trims and bounds model-authored lists', () => {
    const list = stringList(['  first  ', 'first', '', ...Array.from({ length: 30 }, (_, i) => `item ${i}`)]);
    expect(list[0]).toBe('first');
    expect(list).toHaveLength(20);
  });

  it('keeps only relationships that point at a candidate supplied by the server', () => {
    const allowed = new Map([
      ['real', { slug: 'real', title: 'Real feature', kind: 'feature' as const }],
    ]);
    const result = normaliseGrooming({
      relatedItems: [
        { slug: 'invented', relation: 'duplicate', reason: 'made up' },
        { slug: 'real', relation: 'duplicate', reason: 'same user outcome' },
      ],
    }, { modelId: 'test-model', allowedRelations: allowed });

    expect(result.relatedItems).toEqual([{
      slug: 'real',
      title: 'Real feature',
      kind: 'feature',
      relation: 'duplicate',
      reason: 'same user outcome',
    }]);
  });

  it('renders the accepted structure as the builder contract', () => {
    const item = {
      title: 'Groom backlog items',
      detail: 'rough idea',
      grooming: acceptGrooming({
        problem: 'Builders receive ambiguous one-paragraph ideas.',
        outcome: 'Builders receive an explicit implementation contract.',
        acceptanceCriteria: ['The modal captures acceptance criteria'],
        validation: ['Route and persistence tests pass'],
        constraints: ['Keep the owner gate'],
        nonGoals: ['Do not auto-merge builds'],
        dependencies: [],
        implementationNotes: ['Reuse the backlog datastore record'],
        assumptions: ['The record JSON is additive'],
        openQuestions: ['Should chat history persist?'],
        decisions: ['Persist the accepted spec, not raw chat'],
        relatedItems: [],
        effort: 'medium',
        risk: 'low',
        modelId: 'test-model',
        groomedAt: '2026-09-04T10:00:00.000Z',
        revision: 1,
      }, '2026-09-04T10:05:00.000Z'),
    } satisfies Pick<BacklogItemData, 'title' | 'detail' | 'grooming'>;

    const brief = renderBacklogBrief(item);
    expect(brief).toContain('Acceptance criteria:\n- The modal captures acceptance criteria');
    expect(brief).toContain('Validation:\n- Route and persistence tests pass');
    expect(brief).toContain('Remaining open questions:\n- Should chat history persist?');
    expect(brief).toContain('Persist the accepted spec, not raw chat');
  });

  it('falls back to the original title and detail for ungroomed rows', () => {
    expect(renderBacklogBrief({ title: 'Old item', detail: 'Original brief' })).toBe('Old item\n\nOriginal brief');
  });
});
