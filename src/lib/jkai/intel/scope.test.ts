import { describe, it, expect } from 'vitest';
import { OWNER_INTEL_SCOPE, scopeKey, narrowScope, writeSpace, isOwnerScope } from './scope';

describe('scope', () => {
  it('owner scope is own space plus household', () => {
    expect([...OWNER_INTEL_SCOPE]).toEqual(['owner', 'household']);
  });

  it('scopeKey is order-independent', () => {
    expect(scopeKey(['household', 'owner'])).toBe(scopeKey(['owner', 'household']));
  });

  it('an empty request means everything allowed', () => {
    expect([...narrowScope(OWNER_INTEL_SCOPE, [])]).toEqual(['owner', 'household']);
  });

  it('a request can narrow but never widen', () => {
    expect([...narrowScope(OWNER_INTEL_SCOPE, ['household'])]).toEqual(['household']);
    expect([...narrowScope(OWNER_INTEL_SCOPE, ['u_abc'])]).toEqual([]);
    expect([...narrowScope(OWNER_INTEL_SCOPE, ['owner', 'u_abc'])]).toEqual(['owner']);
  });

  it("a write lands in the reader's own space, the head of its scope", () => {
    expect(writeSpace(OWNER_INTEL_SCOPE)).toBe('owner');
    expect(writeSpace(['u_x', 'household'])).toBe('u_x');
  });

  it('an empty scope has nowhere to write', () => {
    expect(() => writeSpace([])).toThrow(/empty scope/);
  });

  it('only the whole owner scope may run an every-space operation', () => {
    expect(isOwnerScope(OWNER_INTEL_SCOPE)).toBe(true);
    expect(isOwnerScope(['household', 'owner'])).toBe(true);
    // A member's scope, and a narrowed owner view, are not the owner.
    expect(isOwnerScope(['u_x', 'household'])).toBe(false);
    expect(isOwnerScope(['owner'])).toBe(false);
    expect(isOwnerScope([])).toBe(false);
  });
});
