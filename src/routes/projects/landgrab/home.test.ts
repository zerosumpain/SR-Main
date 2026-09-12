import { describe, expect, it } from 'vitest';
import { HOME_BOX, homeBoxAreaM2, inHomeBox } from './identity';

describe('HOME_BOX', () => {
  it('is roughly fifty square kilometres', () => {
    const km2 = homeBoxAreaM2() / 1e6;
    expect(km2).toBeGreaterThan(45);
    expect(km2).toBeLessThan(55);
  });
  it('contains the market square and not the coast', () => {
    expect(inHomeBox(54.5253, -1.5535)).toBe(true);
    expect(inHomeBox(54.62, -1.2)).toBe(false);
  });
});
