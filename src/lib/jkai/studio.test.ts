import { describe, it, expect } from 'vitest';
import { STUDIO_BUDGET } from './studio';

describe('studio budget', () => {
  it('allows a chapter-sized iteration without triggering the hourly cooldown', () => {
    // budget.ts counts every iteration in the window, failed ones included.
    // A chapter is a big unit; at the app default of 1M/hour a single 800k
    // chapter would sleep the build for the rest of the hour.
    expect(STUDIO_BUDGET.maxTokensPerHour).toBeGreaterThanOrEqual(3_000_000);
  });

  it('leaves headroom for the skeleton, repairs and a polish pass over 10 chapters', () => {
    expect(STUDIO_BUDGET.maxIterations).toBeGreaterThanOrEqual(20);
  });

  it('caps a single runaway iteration', () => {
    expect(STUDIO_BUDGET.maxTokensPerIteration).toBeGreaterThan(0);
  });

  it('caps total spend in the unit a human reasons about', () => {
    expect(STUDIO_BUDGET.maxCostUsd).toBeGreaterThan(0);
  });

  it('stops an agent that re-verifies forever', () => {
    expect(STUDIO_BUDGET.maxIdleIterations).toBeGreaterThan(0);
  });
});
