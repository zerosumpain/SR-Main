// tests/lib/biome/actions.test.ts
import { describe, it, expect } from 'vitest';
import { computeWindSkew } from '$lib/biome/actions';

describe('computeWindSkew', () => {
  it('returns 0 for calm wind', () => {
    expect(computeWindSkew(0, 0)).toBe(0);
  });

  it('returns 0 for northerly wind (no east-west component)', () => {
    expect(computeWindSkew(0, 20)).toBeCloseTo(0, 5);
  });

  it('returns 0 for southerly wind (no east-west component)', () => {
    expect(computeWindSkew(180, 20)).toBeCloseTo(0, 3);
  });

  it('returns negative skew for easterly wind (90deg)', () => {
    const skew = computeWindSkew(90, 30);
    expect(skew).toBeLessThan(0);
    expect(Math.abs(skew)).toBeCloseTo(3, 0);
  });

  it('returns positive skew for westerly wind (270deg)', () => {
    const skew = computeWindSkew(270, 30);
    expect(skew).toBeGreaterThan(0);
    expect(Math.abs(skew)).toBeCloseTo(3, 0);
  });

  it('clamps speed at 30 km/h — higher speed does not increase skew', () => {
    const at30 = computeWindSkew(90, 30);
    const at50 = computeWindSkew(90, 50);
    expect(at30).toBeCloseTo(at50, 5);
  });

  it('scales linearly with speed below 30', () => {
    const at15 = computeWindSkew(90, 15);
    const at30 = computeWindSkew(90, 30);
    expect(at15).toBeCloseTo(at30 / 2, 1);
  });
});
