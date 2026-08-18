// src/lib/health/analytics/trimp.ts
// Banister training impulse (TRIMP): HR-weighted session load.
// TRIMP = Σ dt_min × HRr × a × e^(b·HRr), HRr = (HR − rest) / (max − rest).
// Banister 1991; sex coefficients from Morton/Banister (male a=0.64 b=1.92,
// female a=0.86 b=1.67).

import { eachInterval, type HrSample } from './series-intervals';

export type { HrSample };

export type Sex = 'male' | 'female';

export interface HrProfile {
  hrRest: number;
  hrMax: number;
  sex: Sex;
}

function weight(hrr: number, sex: Sex): number {
  return sex === 'female' ? 0.86 * Math.exp(1.67 * hrr) : 0.64 * Math.exp(1.92 * hrr);
}

function reserveFraction(hr: number, p: HrProfile): number {
  if (p.hrMax <= p.hrRest) return 0;
  const hrr = (hr - p.hrRest) / (p.hrMax - p.hrRest);
  return Math.min(1, Math.max(0, hrr));
}

/**
 * TRIMP from a heart-rate time series, step-integrated over the shared
 * interval walk (dropout gaps clamped there). Returns null when the series
 * can't carry a load estimate.
 */
export function trimpFromSamples(samples: HrSample[], profile: HrProfile): number | null {
  let total = 0;
  const ok = eachInterval(samples, (dt, hr) => {
    const hrr = reserveFraction(hr, profile);
    total += (dt / 60) * hrr * weight(hrr, profile.sex);
  });
  if (!ok) return null;
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
