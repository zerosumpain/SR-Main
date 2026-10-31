import { describe, expect, it } from 'vitest';
import { canonicalCpu, parseCpu } from './cpu';
import { compareRows } from './value';
import type { WishOffer } from './types';

const offer = (key: string, title: string, pounds: number, description = ''): WishOffer => ({
  itemId: 'w_1', key, source: 'retailer', title, description, url: `https://example.com/${key}`, merchant: null,
  pricePence: pounds * 100, inStock: true, verdict: 'match', results: [], firstSeenAt: '', lastSeenAt: '', history: [], alertedPence: null,
});

describe('CPU', () => {
  it('names the CPU however the listing writes it', () => {
    expect(canonicalCpu('AMD Ryzen 5 7500F CPU')).toBe('RYZEN 7500F');
    expect(canonicalCpu('OcUK Gaming Mach 1.1 - Ryzen 5600 RTX 5060')).toBe('RYZEN 5600');
    expect(canonicalCpu('Ryzen 7 9800X3D')).toBe('RYZEN 9800X3D');
    expect(canonicalCpu('Intel Core i5-14400F, RTX 5060')).toBe('I5-14400');
    expect(canonicalCpu('Core Ultra 7 265KF')).toBe('ULTRA 7 265K');
    expect(canonicalCpu('Ryzen 7 7840HS laptop')).toBeNull();
  });

  it('scores a known part and names an unknown one without a score', () => {
    expect(parseCpu('Ryzen 5 7600')?.score).toBe(65);
    expect(parseCpu('Ryzen 5 1600')).toEqual({ name: 'RYZEN 1600', score: null });
  });
});

describe('value index', () => {
  it('ranks performance per pound with the best at 100', () => {
    const rows = compareRows([
      // The reference build at £1,000 …
      offer('ref', 'Ryzen 5 7600, RTX 5060, 16GB DDR5 RAM, 1TB NVMe SSD', 1000),
      // … and the same build £200 cheaper.
      offer('cheap', 'Ryzen 5 7600, RTX 5060, 16GB DDR5 RAM, 1TB NVMe SSD', 800),
    ]);
    expect(rows.find((r) => r.key === 'cheap')).toMatchObject({ value: 100, perf: 1, coverage: 1 });
    expect(rows.find((r) => r.key === 'ref')?.value).toBe(80);
  });

  it('caps RAM and storage, so 64GB is not four times better', () => {
    const [big] = compareRows([offer('big', 'Ryzen 5 7600, RTX 5060, 64GB DDR5 RAM, 4TB NVMe SSD', 1000)]);
    expect(big.perf).toBe(1.25); // 0.55 + 0.2 + 0.15×2 + 0.1×2
  });

  it('scores an unstated part as a modest one and says how much was stated', () => {
    const [r] = compareRows([offer('gpuonly', 'Gaming PC RTX 5070', 900)]);
    expect(r.coverage).toBe(0.55);
    expect(r.perf).toBeCloseTo(0.55 * (63 / 43) + 0.2 * 0.75 + 0.15 * 0.5 + 0.1 * 0.5, 2);
  });

  it('never lets hiding the CPU beat naming a good one at the same price', () => {
    const rows = compareRows([
      offer('hides', 'Gaming PC RTX 5060 16GB DDR5 RAM 1TB SSD', 900),
      offer('names', 'Gaming PC Ryzen 5 7600 RTX 5060 16GB DDR5 RAM 1TB SSD', 900),
    ]);
    expect(rows.find((r) => r.key === 'names')?.value).toBe(100);
    expect(rows.find((r) => r.key === 'hides')!.value!).toBeLessThan(100);
  });

  it('gives no index without a GPU', () => {
    const [r] = compareRows([offer('nogpu', 'Ryzen 5 7600 16GB DDR5 RAM', 500)]);
    expect(r.value).toBeNull();
    expect(r.cpu).toBe('RYZEN 7600');
  });
});
