import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => ({
  db: {
    execute: vi.fn(async () => undefined),
  },
}));

import { computeCost } from '$lib/server/models/usage';
import type { PriceSnapshot } from '$lib/server/models/types';

describe('computeCost', () => {
  it('returns 0 when snapshot is null (zai case)', () => {
    expect(computeCost({ promptTokens: 100, completionTokens: 50 }, null)).toBe(0);
  });

  it('multiplies tokens by snapshot prices', () => {
    const snap: PriceSnapshot = { promptPrice: 0.000015, completionPrice: 0.000075 };
    const cost = computeCost({ promptTokens: 1000, completionTokens: 500 }, snap);
    // 1000 * 0.000015 + 500 * 0.000075 = 0.015 + 0.0375 = 0.0525
    expect(cost).toBeCloseTo(0.0525, 6);
  });

  it('returns 0 when both prices are 0 (free model)', () => {
    const snap: PriceSnapshot = { promptPrice: 0, completionPrice: 0 };
    expect(computeCost({ promptTokens: 1_000_000, completionTokens: 1_000_000 }, snap)).toBe(0);
  });
});
