import { describe, expect, it } from 'vitest';
import { canonicalCpu, parseCpu } from './cpu';
import { compareRows } from './value';
import type { WishCriteria, WishOffer } from './types';

const offer = (key: string, title: string, pounds: number, extra: Partial<WishOffer> = {}): WishOffer => ({
  itemId: 'w_1', key, source: 'retailer', title, description: '', url: `https://example.com/${key}`, merchant: null,
  pricePence: pounds * 100, inStock: true, verdict: 'match', results: [], firstSeenAt: '', lastSeenAt: '', history: [], alertedPence: null, ...extra,
});
const PC: WishCriteria = { maxPricePence: null, nearMissPct: 10, constraints: [{ field: 'gpu', op: 'rank_gte', value: 'RTX 5060' }] };
const row = (rows: ReturnType<typeof compareRows>, key: string) => rows.find((r) => r.key === key)!;

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

describe('value index — a PC (the GPU fallback model)', () => {
  it('ranks performance per pound with the best at 100', () => {
    const rows = compareRows([
      offer('ref', 'Ryzen 5 7600, RTX 5060, 16GB DDR5 RAM, 1TB NVMe SSD', 1000),
      offer('cheap', 'Ryzen 5 7600, RTX 5060, 16GB DDR5 RAM, 1TB NVMe SSD', 800),
    ], PC);
    expect(row(rows, 'cheap')).toMatchObject({ value: 100, perf: 1, coverage: 1 });
    expect(row(rows, 'ref').value).toBe(80);
    expect(row(rows, 'cheap').factors.map((f) => f.shown)).toEqual(['RTX 5060', 'Ryzen 7600', '16GB', '1TB']);
  });

  it('caps a factor at twice the reference', () => {
    const [big] = compareRows([offer('big', 'Ryzen 5 7600, RTX 5060, 64GB DDR5 RAM, 4TB NVMe SSD', 1000)], PC);
    expect(big.perf).toBe(1.25); // 0.55 + 0.2 + 0.15×2 + 0.1×2
  });

  it('never lets hiding the CPU beat naming a good one at the same price', () => {
    const rows = compareRows([
      offer('hides', 'Gaming PC RTX 5060 16GB DDR5 RAM 1TB SSD', 900),
      offer('names', 'Gaming PC Ryzen 5 7600 RTX 5060 16GB DDR5 RAM 1TB SSD', 900),
    ], PC);
    expect(row(rows, 'names').value).toBe(100);
    expect(row(rows, 'hides').value!).toBeLessThan(100);
    expect(row(rows, 'hides').coverage).toBe(0.8);
  });

  it('scores a PC on the PC model even when the ask carried a different one', () => {
    const odd: WishCriteria = { ...PC, value: [{ label: 'Storage', measure: 'storage_gb', weight: 1, ref: 1000, better: 'higher' }] };
    const [r] = compareRows([offer('x', 'Ryzen 5 7600, RTX 5060, 16GB DDR5 RAM, 1TB NVMe SSD', 900)], odd);
    expect(r.factors.map((f) => f.label)).toEqual(['GPU', 'CPU', 'RAM', 'Storage']);
  });

  it('gives no index when the heaviest factor is unstated', () => {
    const [r] = compareRows([offer('nogpu', 'Ryzen 5 7600 16GB DDR5 RAM', 500)], PC);
    expect(r.value).toBeNull();
  });
});

describe('value index — anything else', () => {
  it('a TV, scored on its own factors', () => {
    const tv: WishCriteria = { maxPricePence: null, nearMissPct: 10, constraints: [], value: [
      { label: 'Screen', measure: 'inch', weight: 0.7, ref: 55, better: 'higher' },
      { label: 'Refresh', measure: 'hz', weight: 0.3, ref: 100, better: 'higher' },
    ] };
    const rows = compareRows([
      offer('a', 'Samsung 65" QLED 4K 120Hz Smart TV', 900),
      offer('b', 'Hisense 55 inch 4K 60Hz TV', 400),
    ], tv);
    expect(row(rows, 'a').factors.map((f) => f.shown)).toEqual(['65in', '120Hz']);
    expect(row(rows, 'b').value).toBe(100); // much cheaper per unit of screen
    expect(row(rows, 'a').value).toBeLessThan(100);
  });

  it('a holiday priced per person, compared at the party total', () => {
    const hol: WishCriteria = { maxPricePence: 200_000, nearMissPct: 10, constraints: [], price: { per: 'total', party: 4 }, value: [
      { label: 'Nights', measure: 'nights', weight: 0.6, ref: 7, better: 'higher' },
      { label: 'Hotel', measure: 'stars', weight: 0.4, ref: 4, better: 'higher' },
    ] };
    const rows = compareRows([
      offer('week', '4⭐ Tenerife family holiday', 300, { description: 'a 7-night stay from £300', perPerson: true }),
      offer('short', '5-star Lisbon city break, 3 nights', 1000),
    ], hol);
    expect(row(rows, 'week')).toMatchObject({ comparePence: 120_000, priceNote: '(£300pp × 4)' });
    expect(row(rows, 'week').factors.map((f) => f.shown)).toEqual(['7 nights', '4★']);
    expect(row(rows, 'week').value).toBe(100);
  });

  it('with no factors, the cheapest is best', () => {
    const lego: WishCriteria = { maxPricePence: null, nearMissPct: 10, constraints: [] };
    const rows = compareRows([offer('x', 'LEGO 10316 Rivendell', 400), offer('y', 'LEGO 10316 Rivendell', 380)], lego);
    expect(row(rows, 'y').value).toBe(100);
    expect(row(rows, 'x').value).toBe(95);
  });
});
