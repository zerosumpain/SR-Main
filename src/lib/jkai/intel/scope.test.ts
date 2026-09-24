import { describe, it, expect } from 'vitest';
import { OWNER_INTEL_SCOPE, scopeKey, narrowScope } from './scope';

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
});
