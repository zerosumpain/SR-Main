export interface AxisBuckets {
  axis: 'hr' | 'steps' | 'temp';
  states: string[];
  centroids: number[];
}

export const HR_BUCKETS: AxisBuckets = {
  axis: 'hr',
  states: ['deep rest', 'resting', 'slightly raised', 'elevated', 'working hard'],
  centroids: [50, 62, 80, 105, 140],
};

export const STEPS_BUCKETS: AxisBuckets = {
  axis: 'steps',
  states: ['barely moved', 'a slow start', 'building up', 'active', 'a big day'],
  centroids: [200, 2000, 6000, 11000, 18000],
};

export const TEMP_BUCKETS: AxisBuckets = {
  axis: 'temp',
  states: ['freezing', 'cold', 'cool', 'mild', 'warm', 'hot'],
  centroids: [-2, 5, 10, 15, 21, 28],
};

// Fail loudly at startup if a bucket axis is mis-edited — enumerateGrid
// indexes states[] by centroid index, so a length mismatch would silently
// yield "undefined" state strings in generated prompts.
for (const b of [HR_BUCKETS, STEPS_BUCKETS, TEMP_BUCKETS]) {
  if (b.states.length !== b.centroids.length) {
    throw new Error(
      `AxisBuckets '${b.axis}': states.length (${b.states.length}) !== centroids.length (${b.centroids.length})`,
    );
  }
}

/** Index of the centroid nearest to `value`. Ties resolve to the lower index. */
export function snapBucket(value: number, centroids: number[]): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < centroids.length; i++) {
    const d = Math.abs(value - centroids[i]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export interface BucketKey {
  hrBucket: number;
  stepsBucket: number;
  tempBucket: number;
}

/**
 * Snap live vitals to a bucket key. The centroids form an axis-aligned grid,
 * so the nearest grid point equals the per-axis nearest centroid.
 */
export function snapToBuckets(hr: number, steps: number, temp: number): BucketKey {
  return {
    hrBucket: snapBucket(hr, HR_BUCKETS.centroids),
    stepsBucket: snapBucket(steps, STEPS_BUCKETS.centroids),
    tempBucket: snapBucket(temp, TEMP_BUCKETS.centroids),
  };
}

export interface GridPoint {
  hrBucket: number;
  stepsBucket: number;
  tempBucket: number;
  hrCentroid: number;
  stepsCentroid: number;
  tempCentroid: number;
  hrState: string;
  stepsState: string;
  tempState: string;
}

/** Every (hr × steps × temp) combination — 5 × 5 × 6 = 150 points. */
export function enumerateGrid(): GridPoint[] {
  const out: GridPoint[] = [];
  for (let h = 0; h < HR_BUCKETS.centroids.length; h++) {
    for (let s = 0; s < STEPS_BUCKETS.centroids.length; s++) {
      for (let t = 0; t < TEMP_BUCKETS.centroids.length; t++) {
        out.push({
          hrBucket: h,
          stepsBucket: s,
          tempBucket: t,
          hrCentroid: HR_BUCKETS.centroids[h],
          stepsCentroid: STEPS_BUCKETS.centroids[s],
          tempCentroid: TEMP_BUCKETS.centroids[t],
          hrState: HR_BUCKETS.states[h],
          stepsState: STEPS_BUCKETS.states[s],
          tempState: TEMP_BUCKETS.states[t],
        });
      }
    }
  }
  return out;
}

/**
 * The full unit list for a generation run: the 150-point grid repeated once
 * per variant. A run with `variantsPerBucket = 3` yields 450 units.
 */
export function enumerateUnits(variantsPerBucket: number): GridPoint[] {
  const grid = enumerateGrid();
  const out: GridPoint[] = [];
  for (let v = 0; v < variantsPerBucket; v++) {
    out.push(...grid);
  }
  return out;
}

export interface StrapVitals {
  bpm: number;
  steps: number;
  temp: number;
  sky: string;
}

/** Fill a strap template's number-slots with live values. */
export function fillStrap(template: string, v: StrapVitals): string {
  return template
    .replace(/\{bpm\}/g, String(Math.round(v.bpm)))
    .replace(/\{steps\}/g, v.steps.toLocaleString('en-GB'))
    .replace(/\{temp\}/g, `${Math.round(v.temp)}°`)
    .replace(/\{sky\}/g, v.sky.toLowerCase());
}
