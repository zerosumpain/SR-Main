import { describe, expect, it } from 'vitest';
import { stableActivityId } from './ids';

describe('stableActivityId', () => {
  it('is deterministic and does not expose provider ids', () => {
    const one = stableActivityId('aevt', ['connection-secret', 'provider-object', 1]);
    const two = stableActivityId('aevt', ['connection-secret', 'provider-object', 1]);
    expect(one).toBe(two);
    expect(one).toMatch(/^aevt_[a-f0-9]{32}$/);
    expect(one).not.toContain('provider-object');
  });

  it('frames parts so ambiguous concatenations do not collide', () => {
    expect(stableActivityId('id', ['ab', 'c'])).not.toBe(stableActivityId('id', ['a', 'bc']));
  });
});
