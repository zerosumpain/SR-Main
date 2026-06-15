import { describe, it, expect } from 'vitest';
import { samePos } from './samePos';

describe('samePos', () => {
  it('treats identical coordinates as the same', () => {
    expect(samePos({ x: 20, y: 40 }, { x: 20, y: 40 })).toBe(true);
  });

  it('detects a moved x', () => {
    expect(samePos({ x: 20, y: 40 }, { x: 21, y: 40 })).toBe(false);
  });

  it('detects a moved y', () => {
    expect(samePos({ x: 20, y: 40 }, { x: 20, y: 41 })).toBe(false);
  });

  it('treats a missing previous position as "not moved" (new card)', () => {
    expect(samePos(undefined, { x: 20, y: 40 })).toBe(true);
    expect(samePos({ x: 20, y: 40 }, undefined)).toBe(true);
    expect(samePos(undefined, undefined)).toBe(true);
  });

  it('does not treat (0,0) as absent', () => {
    expect(samePos({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(true);
    expect(samePos({ x: 0, y: 0 }, { x: 0, y: 20 })).toBe(false);
  });
});
