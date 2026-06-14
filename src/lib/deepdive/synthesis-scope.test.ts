import { describe, it, expect } from 'vitest';
import { buildScopePlan } from './synthesis-scope';

describe('buildScopePlan', () => {
  it('factIds scope: matches only the listed ids, ignores category/pinned', () => {
    const plan = buildScopePlan('sess-1', { factIds: ['f1', 'f2', 'f3'] });
    expect(plan.mode).toBe('ids');
    expect(plan.factIds).toEqual(['f1', 'f2', 'f3']);
  });

  it('empty factIds array falls through to broad scope (treated as no id filter)', () => {
    const plan = buildScopePlan('sess-1', { factIds: [] });
    expect(plan.mode).not.toBe('ids');
  });

  it('category scope: filters by deskCategory', () => {
    const plan = buildScopePlan('sess-1', { category: 'Economics' });
    expect(plan.mode).toBe('category');
    expect(plan.category).toBe('Economics');
  });

  it('pinnedOnly scope: only pinned, non-counterfactual facts', () => {
    const plan = buildScopePlan('sess-1', { pinnedOnly: true });
    expect(plan.mode).toBe('pinned');
    expect(plan.pinnedOnly).toBe(true);
  });

  it('empty scope: whole-session, non-counterfactual facts', () => {
    const plan = buildScopePlan('sess-1', {});
    expect(plan.mode).toBe('session');
    expect(plan.sessionId).toBe('sess-1');
  });

  it('factIds take precedence over category and pinnedOnly when all present', () => {
    const plan = buildScopePlan('sess-1', { factIds: ['f1'], category: 'X', pinnedOnly: true });
    expect(plan.mode).toBe('ids');
  });

  it('caps id list at 500 to bound the prompt', () => {
    const many = Array.from({ length: 800 }, (_, i) => `f${i}`);
    const plan = buildScopePlan('sess-1', { factIds: many });
    expect(plan.factIds!.length).toBe(500);
  });
});
