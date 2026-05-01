import { describe, it, expect } from 'vitest';
import { pulsePeakIndex } from '$lib/components/health/v2/utils';

describe('pulsePeakIndex', () => {
  it('picks the max for higher-is-better metrics', () => {
    // HRV: 90 wins outright over 88 — proves we no longer clamp at 75ms.
    expect(pulsePeakIndex('hrv', [60, 90, 88, 75])).toBe(1);
  });

  it('picks the min for RHR (lower is better)', () => {
    expect(pulsePeakIndex('rhr', [55, 48, 52, 50])).toBe(1);
  });

  it('returns -1 when all values are zero/missing', () => {
    expect(pulsePeakIndex('hrv', [0, 0, 0])).toBe(-1);
  });

  it('skips zero entries when ranking', () => {
    expect(pulsePeakIndex('rhr', [0, 0, 60])).toBe(2);
  });

  it('lets today (last index) win the ring', () => {
    expect(pulsePeakIndex('hrv', [70, 75, 80, 95])).toBe(3);
  });

  it('keeps first-occurrence on real ties', () => {
    expect(pulsePeakIndex('hrv', [85, 85, 70])).toBe(0);
  });

  it('handles steps without saturating', () => {
    expect(pulsePeakIndex('steps', [12000, 18000, 20500, 16000])).toBe(2);
  });
});
