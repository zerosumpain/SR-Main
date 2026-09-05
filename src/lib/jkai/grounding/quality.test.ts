import { it, expect, vi } from 'vitest';
vi.mock('$lib/db', () => ({ db: {} }));
import { compareQuality } from './quality.server';
const baseline = [{ taskClass: 'detailed', samples: 30, support: 0.98, completion: 0.98 }];
it('rejects incomplete or unsupported answers regardless of fewer calls', () => {
 expect(compareQuality(baseline, [{ ...baseline[0], completion: 0.8 }])).toBe('regressed');
 expect(compareQuality(baseline, [{ ...baseline[0], support: 0.8 }])).toBe('regressed');
 expect(compareQuality(baseline, baseline)).toBe('pass');
 expect(compareQuality(baseline, [{ ...baseline[0], samples: 2 }])).toBe('insufficient');
 expect(compareQuality([], baseline)).toBe('insufficient');
});
