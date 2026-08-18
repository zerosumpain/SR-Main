// src/lib/health/analytics/hrr.ts
// Heart-rate recovery from the post-workout decay curve Apple records after
// outdoor workouts (kept verbatim in activities.metadata.heartRateRecovery).
// HRR60 = HR at cooldown start minus HR 60 s later — ≤12 bpm is the abnormal
// band in Cole 1999 (NEJM); bigger drops indicate stronger vagal reactivation.

import { parseHaeDate } from '$lib/trails/hae-workouts';

/** [secondsFromCurveStart, bpm] — normalised for charting. */
export type HrrPoint = [number, number];

interface RawHrrSample {
  date?: string;
  Avg?: number;
  Max?: number;
  Min?: number;
  qty?: number;
}

/**
 * Normalise the raw metadata array into a chartable curve. Returns null when
 * the shape is unusable. Points are sorted and de-duplicated by second.
 */
export function hrrCurve(raw: unknown): HrrPoint[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const points: HrrPoint[] = [];
  let t0: number | null = null;
  for (const item of raw as RawHrrSample[]) {
    if (!item || typeof item !== 'object') continue;
    const hr = item.Avg ?? item.qty ?? item.Max;
    const ts = parseHaeDate(item.date);
    if (typeof hr !== 'number' || !Number.isFinite(hr) || ts == null) continue;
    if (t0 == null) t0 = ts;
    points.push([ts - t0, hr]);
  }
  if (points.length < 2) return null;
  points.sort((a, b) => a[0] - b[0]);
  return points.filter((p, i) => i === 0 || p[0] > points[i - 1][0]);
}

/**
 * HRR60 from a normalised curve. The reference is the curve's opening HR (the
 * watch starts the curve at exercise end); the 60 s value is interpolated.
 * Null when the curve doesn't span a full minute — a truncated curve would
 * understate the drop, which reads as bad fitness and is really missing data.
 */
export function hrr60(curve: HrrPoint[] | null): number | null {
  if (!curve || curve.length < 2) return null;
  const last = curve[curve.length - 1];
  if (last[0] < 60) return null;
  const start = curve[0][1];
  const at60 = interpolate(curve, 60);
  if (at60 == null) return null;
  return Math.round(start - at60);
}

function interpolate(curve: HrrPoint[], t: number): number | null {
  for (let i = 1; i < curve.length; i++) {
    const [t1, v1] = curve[i - 1];
    const [t2, v2] = curve[i];
    if (t >= t1 && t <= t2) {
      if (t2 === t1) return v1;
      return v1 + ((v2 - v1) * (t - t1)) / (t2 - t1);
    }
  }
  return null;
}
