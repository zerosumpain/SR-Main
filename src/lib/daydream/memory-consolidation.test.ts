import { describe, expect, it } from 'vitest';
import { parseConsolidationPlan, themeSlug } from './memory-consolidation';

const pending = [{ id: 'beer' }, { id: 'review' }];
const existing = [{ id: 'health-context' }];

describe('parseConsolidationPlan', () => {
  it('turns two episode-specific memories into one reusable lesson', () => {
    const plan = parseConsolidationPlan(
      JSON.stringify({
        themes: [
          {
            existingThemeId: 'health-context',
            kind: 'lesson',
            title: 'Readiness has contextual modifiers',
            statement: 'Alcohol can lower readiness even when the preceding sleep looks strong.',
            guidance: 'When sleep and readiness diverge, consider alcohol as one possible modifier without assuming it was the cause.',
            confidence: 'high',
            sourceMemoryIds: ['beer', 'review'],
          },
        ],
        ignoredMemoryIds: [],
      }),
      pending,
      existing,
    );

    expect(plan.error).toBeNull();
    expect(plan.themes).toHaveLength(1);
    expect(plan.themes[0].sourceMemoryIds).toEqual(['beer', 'review']);
  });

  it('requires every input to be explicitly accounted for', () => {
    const plan = parseConsolidationPlan(
      JSON.stringify({
        themes: [{
          existingThemeId: null,
          kind: 'lesson',
          title: 'Alcohol and readiness',
          statement: 'Alcohol may reduce readiness after otherwise strong sleep.',
          guidance: 'Consider it as a possible contextual factor when those signals diverge.',
          confidence: 'medium',
          sourceMemoryIds: ['beer'],
        }],
        ignoredMemoryIds: [],
      }),
      pending,
      existing,
    );
    expect(plan.error).toContain('neither themed nor ignored');
  });

  it('refuses invented source ids and invented theme types', () => {
    const unknownSource = parseConsolidationPlan(
      JSON.stringify({
        themes: [{
          existingThemeId: null,
          kind: 'lesson',
          title: 'Alcohol and readiness',
          statement: 'Alcohol may reduce readiness after otherwise strong sleep.',
          guidance: 'Consider it as a possible contextual factor when those signals diverge.',
          confidence: 'medium',
          sourceMemoryIds: ['invented'],
        }],
        ignoredMemoryIds: ['beer', 'review'],
      }),
      pending,
      existing,
    );
    expect(unknownSource.error).toContain('unknown memory');

    const unknownKind = parseConsolidationPlan(
      JSON.stringify({
        themes: [{
          existingThemeId: null,
          kind: 'anecdote',
          title: 'Alcohol and readiness',
          statement: 'Alcohol may reduce readiness after otherwise strong sleep.',
          guidance: 'Consider it as a possible contextual factor when those signals diverge.',
          confidence: 'medium',
          sourceMemoryIds: ['beer', 'review'],
        }],
        ignoredMemoryIds: [],
      }),
      pending,
      existing,
    );
    expect(unknownKind.error).toContain('unknown theme kind');
  });
});
describe('themeSlug', () => {
  it('makes punctuation and case converge on one natural key', () => {
    expect(themeSlug('Readiness: Context & Modifiers')).toBe('readiness-context-modifiers');
  });
});
