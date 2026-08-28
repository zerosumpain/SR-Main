import { describe, it, expect } from 'vitest';
import { classifyStatus } from './status';

describe('classifyStatus', () => {
  it('returns no-data when observed or projected is missing', () => {
    expect(classifyStatus(null, 50, { goodIfUp: true })).toBe('no-data');
    expect(classifyStatus(46, null, { goodIfUp: true })).toBe('no-data');
    expect(classifyStatus(undefined as unknown as number, 50, { goodIfUp: true })).toBe('no-data');
  });

  it('counts beating the projection as on-track (higher-is-better)', () => {
    // attainment: projected 46, reality 48 → ahead of plan
    expect(classifyStatus(48, 46, { goodIfUp: true, tolerancePct: 3 })).toBe('on-track');
  });

  it('is on-track when reality lags within tolerance (higher-is-better)', () => {
    // 46 vs 46.5 projected → 1.1% short, inside a 3% band
    expect(classifyStatus(46, 46.5, { goodIfUp: true, tolerancePct: 3 })).toBe('on-track');
  });

  it('is off-track when reality lags beyond tolerance (higher-is-better)', () => {
    // 42 vs 46 projected → 8.7% short, outside a 3% band
    expect(classifyStatus(42, 46, { goodIfUp: true, tolerancePct: 3 })).toBe('off-track');
  });

  it('counts a lower value as on-track when lower-is-better (absence)', () => {
    // absence projected 6.5%, reality 6.0% → better than plan
    expect(classifyStatus(6.0, 6.5, { goodIfUp: false, tolerancePct: 3 })).toBe('on-track');
  });

  it('is off-track when a lower-is-better metric rises beyond tolerance', () => {
    // absence projected 6.5%, reality 7.5% → worse, >3%
    expect(classifyStatus(7.5, 6.5, { goodIfUp: false, tolerancePct: 3 })).toBe('off-track');
  });

  it('uses an explicit uncertainty band when provided (inside = on-track)', () => {
    expect(classifyStatus(47, 46, { goodIfUp: true, band: { lo: 44, hi: 49 } })).toBe('on-track');
  });

  it('uses the band: outside on the bad side is off-track, good side is on-track', () => {
    // higher-is-better: below the band is bad
    expect(classifyStatus(43, 46, { goodIfUp: true, band: { lo: 44, hi: 49 } })).toBe('off-track');
    // above the band is good → still on-track
    expect(classifyStatus(50, 46, { goodIfUp: true, band: { lo: 44, hi: 49 } })).toBe('on-track');
  });
});
