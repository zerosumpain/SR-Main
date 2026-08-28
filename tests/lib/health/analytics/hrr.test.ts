// tests/lib/health/analytics/hrr.test.ts
import { describe, it, expect } from 'vitest';
import { hrrCurve, hrr60 } from '$lib/health/analytics/hrr';

// The raw shape seen in production activities.metadata.heartRateRecovery.
function rawSample(secondsAfter: number, bpm: number) {
  const base = new Date(Date.UTC(2026, 7, 15, 10, 4, 30));
  const d = new Date(base.getTime() + secondsAfter * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
  return { Avg: bpm, Max: bpm, Min: bpm, date, units: 'bpm', source: 'Watch' };
}

describe('hrrCurve', () => {
  it('normalises HAE samples to seconds-from-start', () => {
    const curve = hrrCurve([rawSample(0, 170), rawSample(30, 150), rawSample(60, 138)])!;
    expect(curve).toEqual([
      [0, 170],
      [30, 150],
      [60, 138],
    ]);
  });

  it('rejects unusable input', () => {
    expect(hrrCurve(null)).toBeNull();
    expect(hrrCurve([])).toBeNull();
    expect(hrrCurve([{ date: 'not a date' }])).toBeNull();
  });
});

describe('hrr60', () => {
  it('computes the 60-second drop, interpolating between samples', () => {
    const curve = hrrCurve([
      rawSample(0, 170),
      rawSample(40, 150),
      rawSample(80, 130), // at t=60 → 140
    ])!;
    expect(hrr60(curve)).toBe(30);
  });

  it('refuses a rising curve — a late-started recording must not render as "−-N bpm"', () => {
    const curve = hrrCurve([rawSample(0, 120), rawSample(40, 130), rawSample(80, 140)])!;
    expect(hrr60(curve)).toBeNull();
  });

  it('refuses a curve shorter than a minute — truncated data must not read as poor fitness', () => {
    const curve = hrrCurve([rawSample(0, 170), rawSample(45, 150)])!;
    expect(hrr60(curve)).toBeNull();
  });
});
