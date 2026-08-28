// src/lib/health/analytics/series-intervals.ts
// The one step-integration walk shared by every consumer of an HR time series.
// Each sample's value is charged for the interval until the next sample, with
// dropout gaps clamped — a watch losing contact for 30 minutes must not have
// the whole gap charged at the last-seen heart rate. TRIMP and time-in-zone
// both integrate this way; sharing the walk keeps their clamps in lockstep.

/** [secondsFromStart, value] — the activity_series sample shape. */
export type HrSample = [number, number];

export const MAX_INTERVAL_S = 300;

/**
 * Visit each (dtSeconds, value) interval of a sorted copy of the series.
 * Returns false when the series can't support integration (< 2 samples).
 */
export function eachInterval(
  samples: HrSample[],
  visit: (dtSeconds: number, value: number) => void,
): boolean {
  if (samples.length < 2) return false;
  const sorted = [...samples].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < sorted.length - 1; i++) {
    const [t, value] = sorted[i];
    const dt = Math.min(sorted[i + 1][0] - t, MAX_INTERVAL_S);
    if (dt <= 0) continue;
    visit(dt, value);
  }
  return true;
}
