import { describe, it, expect } from 'vitest';
import { formatGbp, formatTokens } from '$lib/canvas/stats/costFormat';

describe('formatGbp', () => {
  it('renders zero as £0.00', () => {
    expect(formatGbp(0)).toBe('£0.00');
  });
  it('renders null/undefined as em-dash', () => {
    expect(formatGbp(null)).toBe('—');
    expect(formatGbp(undefined)).toBe('—');
  });
  it('converts USD 1 to £0.79', () => {
    expect(formatGbp(1)).toBe('£0.79');
  });
  it('converts USD 100 to £79.00', () => {
    expect(formatGbp(100)).toBe('£79.00');
  });
  it('renders sub-penny values with 4 decimals after conversion', () => {
    // 0.001 USD * 0.79 = 0.00079 GBP → sub-cent → 4 decimals
    expect(formatGbp(0.001)).toBe('£0.0008');
    // 0.005 USD * 0.79 = 0.00395 GBP → sub-cent → 4 decimals
    expect(formatGbp(0.005)).toBe('£0.0040');
  });
  it('renders amounts >= £0.01 with 2 decimals after conversion', () => {
    // 0.02 USD * 0.79 = 0.0158 → sub-cent → 4 decimals
    // 0.1 USD * 0.79 = 0.079 → sub-cent → 4 decimals
    // 0.5 USD * 0.79 = 0.395 → >= 0.01 → 2 decimals
    expect(formatGbp(0.5)).toBe('£0.40');
    expect(formatGbp(12.345)).toBe('£9.75');
  });
  it('renders large values with thousands separators', () => {
    // 1000 USD * 0.79 = 790.00
    expect(formatGbp(1000)).toBe('£790.00');
  });
});

describe('formatTokens', () => {
  it('renders null/undefined as em-dash', () => {
    expect(formatTokens(null)).toBe('—');
    expect(formatTokens(undefined)).toBe('—');
  });
  it('renders thousands separators below 10k', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(9999)).toBe('9,999');
  });
  it('renders >= 10k with k suffix', () => {
    expect(formatTokens(10_000)).toBe('10k');
    expect(formatTokens(12_345)).toBe('12k');
    expect(formatTokens(999_999)).toBe('1000k');
  });
  it('renders >= 1M with m suffix', () => {
    expect(formatTokens(1_000_000)).toBe('1.0m');
    expect(formatTokens(2_500_000)).toBe('2.5m');
  });
});
