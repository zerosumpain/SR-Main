import { describe, it, expect } from 'vitest';
import { chainedInto, pairKey } from './merge';

describe('pairKey', () => {
  it('is order independent', () => {
    expect(pairKey('b', 'a')).toBe(pairKey('a', 'b'));
  });
});

describe('chainedInto', () => {
  const proposed = new Set([pairKey('a', 'b'), pairKey('b', 'c')]);

  it('allows the first merge into a fresh survivor', () => {
    expect(chainedInto('b', 'a', new Map(), proposed)).toBeNull();
  });

  it('refuses the merge that would join two entities nothing matched', () => {
    // A merged into B. C also matches B — but nothing ever said A and C are
    // the same, and merging would assert exactly that.
    const absorbed = new Map([['b', ['a']]]);
    expect(chainedInto('b', 'c', absorbed, proposed)).toBe('a');
  });

  it('allows it when every member is a candidate against the newcomer', () => {
    const clique = new Set([pairKey('a', 'b'), pairKey('b', 'c'), pairKey('a', 'c')]);
    const absorbed = new Map([['b', ['a']]]);
    expect(chainedInto('b', 'c', absorbed, clique)).toBeNull();
  });

  it('checks every entity the survivor has taken, not just the last', () => {
    const wide = new Set([pairKey('b', 'a'), pairKey('b', 'c'), pairKey('b', 'd'), pairKey('a', 'd')]);
    const absorbed = new Map([['b', ['a', 'c']]]);
    // 'd' matches 'a' but not 'c'.
    expect(chainedInto('b', 'd', absorbed, wide)).toBe('c');
  });
});
