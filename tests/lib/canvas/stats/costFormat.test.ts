import { describe, it, expect } from 'vitest';
import { formatUsd, formatTokens } from '$lib/canvas/stats/costFormat';

describe('formatUsd', () => {
  it('renders zero as $0.00', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });
  it('renders sub-cent values with 4 decimals', () => {
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(0.0001)).toBe('$0.0001');
  });
  it('renders cents with 2 decimals when under $1', () => {
    expect(formatUsd(0.42)).toBe('$0.42');
    expect(formatUsd(0.99)).toBe('$0.99');
  });
  it('renders dollars with 2 decimals when >= $1', () => {
    expect(formatUsd(1)).toBe('$1.00');
    expect(formatUsd(12.345)).toBe('$12.35');
    expect(formatUsd(1234)).toBe('$1,234.00');
  });
  it('renders null/undefined as em-dash', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(undefined)).toBe('—');
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
