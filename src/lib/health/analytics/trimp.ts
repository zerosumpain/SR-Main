// src/lib/health/analytics/trimp.ts
// Banister training impulse (TRIMP): HR-weighted session load.
// TRIMP = Σ dt_min × HRr × a × e^(b·HRr), HRr = (HR − rest) / (max − rest).
// Banister 1991; sex coefficients from Morton/Banister (male a=0.64 b=1.92,
// female a=0.86 b=1.67).

export type Sex = 'male' | 'female';

export interface HrProfile {
  hrRest: number;
  hrMax: number;
  sex: Sex;
}

/** Session samples arrive as [secondsFromStart, bpm] — the activity_series shape. */
export type HrSample = [number, number];

// A watch dropout can leave many minutes between samples; charging the whole
// gap at the last-seen HR fabricates load, so any interval longer than this is
// clamped. 5 min matches the coarsest cadence HAE has been seen to send.
const MAX_INTERVAL_S = 300;

function weight(hrr: number, sex: Sex): number {
  return sex === 'female' ? 0.86 * Math.exp(1.67 * hrr) : 0.64 * Math.exp(1.92 * hrr);
}

function reserveFraction(hr: number, p: HrProfile): number {
  if (p.hrMax <= p.hrRest) return 0;
  const hrr = (hr - p.hrRest) / (p.hrMax - p.hrRest);
  return Math.min(1, Math.max(0, hrr));
}

/**
 * TRIMP from a heart-rate time series. Each sample's HR is charged for the
 * interval until the next sample (step integration), capped per interval.
 * Returns null when the series can't carry a load estimate.
 */
export function trimpFromSamples(samples: HrSample[], profile: HrProfile): number | null {
  if (samples.length < 2) return null;
  const sorted = [...samples].sort((a, b) => a[0] - b[0]);
  let total = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const [t, hr] = sorted[i];
    const dt = Math.min(sorted[i + 1][0] - t, MAX_INTERVAL_S);
    if (dt <= 0) continue;
    const hrr = reserveFraction(hr, profile);
    total += (dt / 60) * hrr * weight(hrr, profile.sex);
  }
  return Math.round(total * 10) / 10;
}

/**
 * Fallback when no series exists — one average HR over the whole duration.
 * Systematically underestimates interval work (the exponential is convex),
 * which the methodology entry states outright.
 */
export function trimpFromAvg(
  durationS: number,
  avgHr: number,
  profile: HrProfile,
): number | null {
  if (durationS <= 0 || avgHr <= 0) return null;
  const hrr = reserveFraction(avgHr, profile);
  const total = (durationS / 60) * hrr * weight(hrr, profile.sex);
  return Math.round(total * 10) / 10;
}
