import { describe, it, expect } from 'vitest';
import { isEntangled, describeSweep, SWEEP_METRICS } from './sweep';

describe('isEntangled', () => {
  // Reporting "your resting heart rate tracks your recovery score" is not a
  // discovery, it is a restatement of how Whoop computes recovery. Without this
  // list the top of every ranking is tautologies and nothing real surfaces.
  it('blocks pairs that are true by definition', () => {
    expect(isEntangled('recoveryScore', 'restingHeartRate')).toBe(true);
    expect(isEntangled('sleepMinutes', 'sleepPerformance')).toBe(true);
    expect(isEntangled('minutesAtHome', 'minutesOut')).toBe(true);
  });

  it('is order-independent', () => {
    expect(isEntangled('restingHeartRate', 'recoveryScore')).toBe(true);
  });

  // The interesting cross-domain questions must still get through.
  it('allows a genuine cross-domain question', () => {
    expect(isEntangled('sleepMinutes', 'distinctPlaces')).toBe(false);
    expect(isEntangled('strain', 'sleepPerformance')).toBe(false);
    expect(isEntangled('minutesOut', 'recoveryScore')).toBe(false);
  });
});

describe('SWEEP_METRICS', () => {
  // An explicit list rather than "every numeric column": a feature store gains
  // columns, and an automatic sweep would start testing identifiers and counts
  // of counts. It is also the m in the correction, so it has to be knowable.
  it('is an explicit, deduplicated list', () => {
    expect(new Set(SWEEP_METRICS).size).toBe(SWEEP_METRICS.length);
    expect(SWEEP_METRICS.length).toBeGreaterThan(10);
  });
});

describe('describeSweep', () => {
  // The uncorrected count is reported alongside the corrected one on purpose,
  // so the correction's effect is visible rather than asserted.
  it('says how many the correction removed', () => {
    const line = describeSweep({
      windowDays: 120,
      from: '2026-05-01',
      to: '2026-08-26',
      testsRun: 276,
      fdr: 0.1,
      naiveHits: 10,
      findings: [],
      errors: [],
    });
    expect(line).toContain('276 tests');
    expect(line).toContain('10 would pass an uncorrected');
    expect(line).toContain('0 survive');
  });

  it('leads with the reason when there was not enough data', () => {
    const line = describeSweep({
      windowDays: 120, from: '', to: '', testsRun: 0, fdr: 0.1,
      naiveHits: 0, findings: [], errors: ['only 3 days of features; needs 14'],
    });
    expect(line).toBe('only 3 days of features; needs 14');
  });
});
