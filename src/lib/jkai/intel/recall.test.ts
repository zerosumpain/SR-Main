import { describe, it, expect } from 'vitest';
import { recallScope } from './recall';

describe('recallScope', () => {
  it("a member's note recalls from their space and the household's", () => {
    expect([...recallScope('u_x')]).toEqual(['u_x', 'household']);
    expect([...recallScope('owner')]).toEqual(['owner', 'household']);
  });

  it('a household note recalls from the household only', () => {
    expect([...recallScope('household')]).toEqual(['household']);
  });
});
