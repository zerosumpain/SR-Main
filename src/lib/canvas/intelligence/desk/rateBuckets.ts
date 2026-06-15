// src/lib/canvas/intelligence/desk/rateBuckets.ts
//
// Pure helpers for the artefacts/sec ring buffer. No Svelte runes — unit-testable.
// The store owns the actual state; these are the pure mutators.

export const RATE_WINDOW = 20; // number of 1-second buckets to keep

/** Increment the current (last) bucket by 1. Returns a NEW array. */
export function incrementBucket(buckets: readonly number[]): number[] {
  if (buckets.length === 0) return [1];
  const next = [...buckets];
  next[next.length - 1] += 1;
  return next;
}

/** Roll the window: shift the oldest bucket off and append a fresh 0.
 *  Trims to RATE_WINDOW length. Returns a NEW array.
 *  Call this once per 1 Hz tick (regardless of whether arrivals happened). */
export function rollWindow(buckets: readonly number[], windowSize = RATE_WINDOW): number[] {
  // Shift oldest, push new 0, then cap.
  const shifted = [...buckets.slice(1), 0];
  if (shifted.length > windowSize) return shifted.slice(shifted.length - windowSize);
  // Zero-fill if the window was short (startup).
  while (shifted.length < windowSize) shifted.unshift(0);
  return shifted;
}

/** Return the current rate (last completed bucket before the live one). */
export function currentRate(buckets: readonly number[]): number {
  if (buckets.length < 2) return 0;
  return buckets[buckets.length - 2];
}
