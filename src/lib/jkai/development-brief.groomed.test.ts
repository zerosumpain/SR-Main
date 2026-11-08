import { describe, expect, it } from 'vitest';
import {
  acceptGrooming,
  autopilotBriefDecision,
  calculateReadiness,
  deliveryBriefFrom,
  lintBrief,
  type GroomedBrief,
  normaliseGrooming,
  renderBacklogBrief,
  stringList,
} from './development-brief';
import type { BacklogItemData } from '$lib/selfimprove/types';
import { newDelivery } from './development';

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

describe('one brief: a groomed backlog item is a development brief', () => {
  const groomed = (over: Record<string, unknown> = {}) => acceptGrooming({
    problem: 'Owners cannot see the rail status.', outcome: 'The /news page shows a rail status card.',
    acceptanceCriteria: ['The /news page shows a rail card listing each line', ' '], validation: ['A route test renders the card'],
    constraints: ['Owner only'], nonGoals: ['No push alerts'], dependencies: ['Rail feed'], implementationNotes: ['Reuse the news shell'],
    assumptions: ['Sample data is enough'], openQuestions: [], decisions: [],
    routes: ['/news/', '//evil.example', 'news'], newRoutes: ['/news/rail'],
    lane: { lane: 'site', reason: 'Reads site data' }, modelId: 'm', revision: 3, groomedAt: '2026-10-01T09:00:00.000Z', ...over,
  }, '2026-10-01T10:00:00.000Z');

  it('keeps the development fields — routes, new routes and lane — normalised to local paths', () => {
    const g = groomed();
    expect(g.routes).toEqual(['/news']);
    expect(g.newRoutes).toEqual(['/news/rail']);
    expect(g.lane).toEqual({ lane: 'site', reason: 'Reads site data' });
    expect(renderBacklogBrief({ title: 'Rail', detail: '', grooming: g })).toContain('Target routes:\n- /news');
  });

  it('keeps a stored brief check only when it is shaped like one', () => {
    const lint = { revision: 3, at: 'x', routesChecked: true, lane: { lane: 'site', reason: 'r', source: 'grooming' }, findings: [{ kind: 'route', severity: 'warn', subject: '', message: 'm', source: 'rule' }] };
    expect(groomed({ lint }).lint).toMatchObject({ revision: 3, lane: { lane: 'site' }, findings: [{ kind: 'route', severity: 'warn' }] });
    expect(groomed({ lint: { lane: { lane: 'nowhere' }, findings: [] } }).lint).toBeUndefined();
  });

  it('reads a brief stored before the models were one exactly as it was stored', () => {
    const old = { ...groomed(), routes: undefined, newRoutes: undefined, lane: undefined, lint: undefined } as unknown as GroomedBrief;
    const fields = deliveryBriefFrom(old);
    expect(fields.brief).not.toHaveProperty('routes');
    expect(fields.brief).not.toHaveProperty('lane');
    // No lane means it was never asked where it belongs: its delivery grooms it.
    expect(fields.grooming).toBeUndefined();
    expect(renderBacklogBrief({ title: 'Rail', detail: '', grooming: old })).not.toContain('Target routes');
  });

  it('hands a delivery the same brief, already groomed, so autopilot checks it rather than grooming it again', () => {
    const fields = deliveryBriefFrom(groomed());
    expect(fields.criteria).toEqual(['The /news page shows a rail card listing each line']);
    expect(fields.brief).toEqual({
      constraints: '- Owner only\n- Not in scope: No push alerts', dependencies: '- Rail feed', assumptions: '- Sample data is enough',
      validation: '- A route test renders the card', questions: '', routes: ['/news'], newRoutes: ['/news/rail'], lane: { lane: 'site', reason: 'Reads site data' },
    });
    expect(fields.grooming).toEqual({ model: 'm', at: '2026-10-01T10:00:00.000Z', summary: '', by: 'owner' });

    const state = newDelivery('Rail', 'Platform', fields.criteria, { autopilot: true });
    state.autopilot!.startedAt = '2026-10-01T10:00:00.000Z';
    Object.assign(state.brief, fields.brief);
    state.grooming = fields.grooming;
    expect(autopilotBriefDecision(state, Date.parse('2026-10-02T03:00:00Z'))).toEqual({ action: 'lint' });
    const lint = lintBrief({ outcome: 'Rail', criteria: fields.criteria, routes: state.brief.routes, newRoutes: state.brief.newRoutes, lane: state.brief.lane }, ['/news'], state.brief.revision);
    expect(lint.lane).toMatchObject({ lane: 'site', source: 'grooming' });
  });

  it('has nothing to hand over for an ungroomed item', () => {
    expect(deliveryBriefFrom(undefined)).toEqual({ criteria: [], brief: {} });
  });
});
