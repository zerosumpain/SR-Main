import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ groom: vi.fn() }));
vi.mock('$lib/db', () => ({ db: { select: () => { throw new Error('no database in a unit test'); } } }));
vi.mock('./development-state.server', () => ({ mutateDelivery: vi.fn(), relevantLessons: vi.fn() }));
vi.mock('./development-review.server', () => ({ developmentAssessor: vi.fn(async () => { throw new Error('no model'); }) }));
vi.mock('./log-emitter', () => ({ emitLog: vi.fn() }));
vi.mock('./development-grooming.server', () => ({ groomBacklogBrief: h.groom, groomDevelopmentBrief: vi.fn() }));

import { groomBacklogItem } from './development-brief.server';
import { normaliseGrooming } from './development-brief';

describe('backlog grooming is checked as a development brief', () => {
  it('attaches the lane rule and criteria findings to the groomed draft', async () => {
    const grooming = normaliseGrooming({
      outcome: 'A marble run in the blog sidebar', acceptanceCriteria: ['It is intuitive'], routes: ['/blog'],
      lane: { lane: 'site', reason: 'model says so' },
    }, { modelId: 'm', revision: 2 });
    h.groom.mockResolvedValue({ assistantMessage: 'ok', suggestions: {}, grooming, model: 'm' });
    const result = await groomBacklogItem({ title: 'Marble', detail: '', kind: 'feature', priority: 3 }, []);
    expect(h.groom).toHaveBeenCalledWith(expect.objectContaining({ title: 'Marble' }), []);
    const lint = result.grooming.lint!;
    // The deterministic rule beats the model's lane: Marble Run is its own repository.
    expect(lint.lane).toMatchObject({ lane: 'other-repo', source: 'rule', repo: 'zerosumpain/marble-run' });
    expect(lint.revision).toBe(2);
    expect(lint.by).toBe('owner');
    // No manifest in a unit test: routes are reported unchecked, never passed.
    expect(lint.routesChecked).toBe(false);
  });

  it('reports subjective criteria the way the delivery check does', async () => {
    const grooming = normaliseGrooming({ outcome: 'Better blog', acceptanceCriteria: ['It is intuitive'], routes: ['/blog'], lane: { lane: 'site', reason: 'r' } }, { modelId: 'm' });
    h.groom.mockResolvedValue({ assistantMessage: 'ok', suggestions: {}, grooming, model: 'm' });
    const result = await groomBacklogItem({ title: 'Blog', detail: '', kind: 'feature', priority: 3 }, []);
    expect(result.grooming.lint!.findings).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'criterion', severity: 'block' })]));
  });
});
