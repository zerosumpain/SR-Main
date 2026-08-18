// tests/lib/health/whoop-scale.test.ts
import { describe, it, expect } from 'vitest';
import { realStrain } from '$lib/health/whoop';

describe('realStrain', () => {
  it('passes genuine 0–21 strains through untouched', () => {
    expect(realStrain(0)).toBe(0);
    expect(realStrain(14.7)).toBe(14.7);
    expect(realStrain(21)).toBe(21);
  });

  it('unscales the legacy ×100 rows', () => {
    expect(realStrain(635)).toBe(6.35);
    expect(realStrain(1401)).toBe(14.01);
    expect(realStrain(431)).toBe(4.31);
  });
});
