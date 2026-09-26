import { describe, expect, it } from 'vitest';
import { ago, cadence, pct, usd, when } from './engine-format';

describe('engine-format', () => {
  it('says never rather than an age for a missing timestamp', () => {
    expect(ago(null)).toBe('never');
    expect(ago('not a date')).toBe('never');
  });

  it('ages a past timestamp', () => {
    expect(ago(new Date(Date.now() - 90 * 60_000))).toBe('2h ago');
  });

  it('reads a future timestamp forwards, not as a negative age', () => {
    const soon = new Date(Date.now() + 3 * 3_600_000);
    expect(when(soon)).toBe('in 3h');
    expect(when(soon).startsWith('-')).toBe(false);
  });

  it('calls a next run that has already passed due, not overdue by a negative', () => {
    expect(when(new Date(Date.now() - 60_000))).toBe('due');
    expect(when(null)).toBe('—');
  });

  it('prints a cadence the way the schedule reads it', () => {
    expect(cadence(3600)).toBe('1h');
    expect(cadence(1800)).toBe('30m');
    expect(cadence(null)).toBe('—');
  });

  it('shows no cost at all rather than a $0.00 that looks measured', () => {
    expect(usd(0)).toBeNull();
    expect(usd(null)).toBeNull();
    expect(usd(0.0042)).toBe('$0.0042');
    expect(usd(1.5)).toBe('$1.50');
  });

  it('leaves a missing percentage as a dash', () => {
    expect(pct(null)).toBe('—');
    expect(pct(0.5)).toBe('50%');
  });
});
