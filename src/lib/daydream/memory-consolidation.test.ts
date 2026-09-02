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
            guidance:
              'When sleep and readiness diverge, consider alcohol as one possible modifier without assuming it was the cause.',
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
        themes: [
          {
            existingThemeId: null,
            kind: 'lesson',
            title: 'Alcohol and readiness',
            statement: 'Alcohol may reduce readiness after otherwise strong sleep.',
            guidance: 'Consider it as a possible contextual factor when those signals diverge.',
            confidence: 'medium',
            sourceMemoryIds: ['beer'],
          },
        ],
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
        themes: [
          {
            existingThemeId: null,
            kind: 'lesson',
            title: 'Alcohol and readiness',
            statement: 'Alcohol may reduce readiness after otherwise strong sleep.',
            guidance: 'Consider it as a possible contextual factor when those signals diverge.',
            confidence: 'medium',
            sourceMemoryIds: ['invented'],
          },
        ],
        ignoredMemoryIds: ['beer', 'review'],
      }),
      pending,
      existing,
    );
    expect(unknownSource.error).toContain('unknown memory');

    const unknownKind = parseConsolidationPlan(
      JSON.stringify({
        themes: [
          {
            existingThemeId: null,
            kind: 'anecdote',
            title: 'Alcohol and readiness',
            statement: 'Alcohol may reduce readiness after otherwise strong sleep.',
            guidance: 'Consider it as a possible contextual factor when those signals diverge.',
            confidence: 'medium',
            sourceMemoryIds: ['beer', 'review'],
          },
        ],
        ignoredMemoryIds: [],
      }),
      pending,
      existing,
    );
    expect(unknownKind.error).toContain('unknown theme kind');
  });

  it('maps short model references back to database ids', () => {
    const plan = parseConsolidationPlan(
      JSON.stringify({
        themes: [
          {
            existingThemeRef: 'T001',
            kind: 'lesson',
            title: 'Readiness has contextual modifiers',
            statement: 'Alcohol can lower readiness even when the preceding sleep looks strong.',
            guidance: 'Consider alcohol as one possible modifier without treating it as the only explanation.',
            confidence: 'high',
            sourceMemoryRefs: ['M001'],
          },
        ],
        ignoredMemoryRefs: ['M002'],
      }),
      pending,
      existing,
      {
        references: {
          memoryRefs: { M001: 'beer', M002: 'review' },
          themeRefs: { T001: 'health-context' },
        },
      },
    );

    expect(plan.error).toBeNull();
    expect(plan.themes[0]).toMatchObject({
      existingThemeId: 'health-context',
      sourceMemoryIds: ['beer'],
    });
    expect(plan.ignoredMemoryIds).toEqual(['review']);
  });

  it('salvages valid evidence and defers unresolved memories after a failed repair', () => {
    const invented = 'a6f4dcc1-2c76-400e-8fc2-9bfc24937ddc';
    const raw = JSON.stringify({
      themes: [
        {
          existingThemeRef: null,
          kind: 'value',
          title: 'Preserve capability in trusted personal systems',
          statement: 'Trusted personal systems should preserve capabilities that remain useful to their owner.',
          guidance: 'Avoid removing an established capability without considering why the owner still relies on it.',
          confidence: 'medium',
          sourceMemoryRefs: ['M001', invented],
        },
      ],
      ignoredMemoryRefs: [],
    });
    const references = {
      memoryRefs: { M001: 'beer', M002: 'review' },
      themeRefs: {},
    };

    const strict = parseConsolidationPlan(raw, pending, existing, {
      references,
    });
    expect(strict.error).toContain(`unknown memory reference ${invented}`);

    const partial = parseConsolidationPlan(raw, pending, existing, {
      references,
      allowPartial: true,
    });
    expect(partial.error).toBeNull();
    expect(partial.themes[0].sourceMemoryIds).toEqual(['beer']);
    expect(partial.deferredMemoryIds).toEqual(['review']);
    expect(partial.warnings.join(' ')).toContain(invented);
  });
});
describe('themeSlug', () => {
  it('makes punctuation and case converge on one natural key', () => {
    expect(themeSlug('Readiness: Context & Modifiers')).toBe('readiness-context-modifiers');
  });
});
