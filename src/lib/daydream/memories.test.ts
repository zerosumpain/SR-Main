import { describe, it, expect } from 'vitest';
import {
  CATEGORY_ORDER,
  MEMORY_THEMES_PER_PACK,
  groupByCategory,
  groupThemesByKind,
  memoryUse,
} from './memories';
import { PACK_LIMITS } from './ponder/pack';

describe('memoryUse', () => {
  it('explains that raw detail waits for consolidation', () => {
    const { lines, binding } = memoryUse({
      category: 'health', origin: 'note', verdict: null, consolidatedAt: null, themeIds: [],
    });
    expect(lines[0].toLowerCase()).toContain('awaiting tonight');
    expect(lines[0]).toContain('stays out of ponder packs');
    expect(binding).toBe(false);
  });

  it('explains that a consolidated row becomes provenance, not prompt prose', () => {
    const { lines } = memoryUse({
      category: 'health', origin: 'note', verdict: null,
      consolidatedAt: '2026-09-02T22:30:00Z', themeIds: ['theme-1'],
    });
    expect(lines[0]).toContain('source evidence');
    expect(lines[0]).toContain('broader lesson/value');
  });

  it('marks a refutation as BINDING, and nothing else', () => {
    // The distinction the Canva case cost eight repeats to learn: being carded
    // is material the proposer may ignore; the refutation block is an
    // instruction it may not.
    const rest = { category: 'situations', consolidatedAt: 'now', themeIds: [] as string[] };
    expect(memoryUse({ ...rest, origin: 'ruling', verdict: 'refuted' }).binding).toBe(true);
    expect(memoryUse({ ...rest, origin: 'ruling', verdict: 'verified' }).binding).toBe(false);
    expect(memoryUse({ ...rest, origin: 'ruling', verdict: 'uncertain' }).binding).toBe(false);
    expect(memoryUse({ ...rest, origin: 'note', verdict: null }).binding).toBe(false);
  });
});

describe('groupByCategory', () => {
  it('orders the known categories and keeps the unknown ones', () => {
    const rows = [
      { category: 'devices' },
      { category: 'wildcat' },
      { category: 'situations' },
      { category: 'places' },
    ];
    expect(groupByCategory(rows).map((g) => g.category)).toEqual([
      'situations',
      'places',
      'devices',
      'wildcat',
    ]);
  });

  it('treats an empty category as its own group rather than dropping the row', () => {
    const groups = groupByCategory([{ category: '' }, { category: 'places' }]);
    expect(groups.map((g) => g.category)).toContain('uncategorised');
    expect(groups.flatMap((g) => g.items)).toHaveLength(2);
  });

  it('keeps every row', () => {
    const rows = CATEGORY_ORDER.map((category) => ({ category }));
    expect(groupByCategory(rows).flatMap((g) => g.items)).toHaveLength(rows.length);
  });
});

describe('MEMORY_THEMES_PER_PACK', () => {
  it('agrees with the theme cap that the page describes', () => {
    expect(MEMORY_THEMES_PER_PACK).toBe(PACK_LIMITS.memoryThemes);
  });
});

describe('groupThemesByKind', () => {
  it('puts explicit values before lessons', () => {
    const groups = groupThemesByKind([{ kind: 'lesson' }, { kind: 'value' }]);
    expect(groups.map((g) => g.kind)).toEqual(['value', 'lesson']);
  });
});
