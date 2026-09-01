import { describe, it, expect } from 'vitest';
import { CATEGORY_ORDER, MEMORIES_PER_PACK, groupByCategory, memoryUse } from './memories';
import { PACK_LIMITS } from './ponder/pack';

describe('memoryUse', () => {
  it('always names the one mechanism every memory has', () => {
    const { lines, binding } = memoryUse({ category: 'health', origin: 'elsewhere', verdict: null });
    expect(lines[0]).toContain('Known (health)');
    expect(lines[0]).toContain('verbatim');
    expect(binding).toBe(false);
  });

  it('marks a refutation as BINDING, and nothing else', () => {
    // The distinction the Canva case cost eight repeats to learn: being carded
    // is material the proposer may ignore; the refutation block is an
    // instruction it may not.
    expect(memoryUse({ category: 'situations', origin: 'ruling', verdict: 'refuted' }).binding).toBe(true);
    expect(memoryUse({ category: 'situations', origin: 'ruling', verdict: 'verified' }).binding).toBe(false);
    expect(memoryUse({ category: 'situations', origin: 'ruling', verdict: 'uncertain' }).binding).toBe(false);
    expect(memoryUse({ category: 'situations', origin: 'note', verdict: null }).binding).toBe(false);
  });

  it('says what a named place additionally unlocks', () => {
    const { lines } = memoryUse({ category: 'places', origin: 'place', verdict: null });
    expect(lines.some((l) => l.includes('un-mute'))).toBe(true);
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

describe('MEMORIES_PER_PACK', () => {
  it('agrees with the pack that actually does the slicing', () => {
    // The page prints "N of M reach a pack". If this drifts from PACK_LIMITS
    // the page states a falsehood about the engine, which is the one thing
    // this hub is not allowed to do.
    expect(MEMORIES_PER_PACK).toBe(PACK_LIMITS.memories);
  });
});
