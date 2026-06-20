// Shared ECG signal model.
//
// This is the *pure maths* of the heartbeat trace — the PQRST morphology, the
// breathing-driven baseline wobble, the heart-rate → amplitude relationship and
// the beat-to-beat variability. Both renderers consume it:
//   - Ecg.svelte       draws it as a glowing orange phosphor line on canvas.
//   - EcgAscii.svelte  draws the exact same signal as sweeping ASCII characters.
//
// Keeping the model in one place is what guarantees the two modes share an
// identical pattern, wobble and relationship to the live heart rate — the ASCII
// view is the same signal, only the pen changed.

import { clamp } from '$lib/components/health/v2/utils';

// Fixed "paper speed": seconds for the scan cursor to cross the full width.
export const SWEEP_SEC = 7;
// Phosphor lifetime (seconds): how long a drawn point lingers before it is gone.
export const LIFETIME = 1.5;
// Quadratic fade — bright for most of the lifetime, then a clean cut to nothing.
export const FADE_EXP = 2;
// Respiration frequency (Hz) ≈ 13 breaths/min. Drives both the baseline wander
// and the sinus-arrhythmia modulation of heart rate.
export const RESP_HZ = 0.22;

// PQRST morphology as a sum of Gaussians keyed on seconds-since-beat-onset.
// Placing the lobes in real time (not as a fraction of the R–R interval) keeps
// the complex a constant shape while the gap between beats stretches and shrinks
// with the heart rate — which is how an ECG actually behaves.
const gauss = (t: number, mu: number, sigma: number) =>
  Math.exp(-((t - mu) * (t - mu)) / (2 * sigma * sigma));

export function complex(tau: number): number {
  return (
    0.1 * gauss(tau, 0.09, 0.021) + // P
    -0.07 * gauss(tau, 0.205, 0.0085) + // Q
    0.95 * gauss(tau, 0.225, 0.0095) + // R
    -0.2 * gauss(tau, 0.25, 0.011) + // S
    0.28 * gauss(tau, 0.36, 0.046) // T
  );
}

// Slow, breathing-driven drift of the isoelectric line plus a tiny tremor — the
// gentle undulation you see on a real lead because the body is moving.
export function baselineDrift(t: number): number {
  return (
    0.05 * Math.sin(2 * Math.PI * RESP_HZ * t + 0.6) +
    0.018 * Math.sin(2 * Math.PI * 0.071 * t) +
    0.006 * Math.sin(2 * Math.PI * 7.3 * t) +
    0.004 * Math.sin(2 * Math.PI * 11.9 * t + 1.3)
  );
}

export const clampBpm = (v: number) => Math.max(36, Math.min(200, v));

// Dimensionless amplitude gain: a resting heart shows a modest R spike, a
// working one a taller, emphatic one (0.42× at rest → ~1.32× flat out across
// 40–160 bpm). Renderers multiply this by their own full-scale deflection.
export const ampGain = (bpm: number) => 0.42 + clamp((bpm - 40) / 120, 0, 1) * 0.9;

// Next beat's interval: mean from current HR, modulated by respiratory sinus
// arrhythmia (HR rises on inhale, falls on exhale) plus a little uncorrelated
// jitter — i.e. genuine beat-to-beat variability.
export function nextRR(bpm: number, t: number): number {
  const mean = 60 / clampBpm(bpm);
  const rsa = 0.05 * Math.sin(2 * Math.PI * RESP_HZ * t);
  const jitter = (Math.random() - 0.5) * 0.05;
  return clamp(mean * (1 + rsa + jitter), 0.34, 1.7);
}

export const nextAmp = () => 1 + (Math.random() - 0.5) * 0.12;

// Age (0..1 of LIFETIME) → quantised opacity band. Quadratic ease holds the
// trail bright for most of its life (a long tail) then falls to exactly 0 at
// LIFETIME (clean cut-off). Shared so both pens fade identically.
export const FADE_BANDS = 28;
export function fadeBand(ageFrac: number): number {
  if (ageFrac >= 1) return 0;
  return Math.round((1 - Math.pow(ageFrac, FADE_EXP)) * FADE_BANDS);
}
