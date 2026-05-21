import { describe, it, expect } from 'vitest';
import {
  snapBucket,
  snapToBuckets,
  enumerateGrid,
  fillStrap,
  HR_BUCKETS,
  STEPS_BUCKETS,
  TEMP_BUCKETS,
} from './hero-titles-buckets';

describe('snapBucket', () => {
  it('picks the nearest centroid index', () => {
    expect(snapBucket(55, HR_BUCKETS.centroids)).toBe(0); // 50 closer than 62
    expect(snapBucket(57, HR_BUCKETS.centroids)).toBe(1); // 62 closer than 50
  });
  it('clamps values beyond the ends to the end buckets', () => {
    expect(snapBucket(200, HR_BUCKETS.centroids)).toBe(4);
    expect(snapBucket(10, HR_BUCKETS.centroids)).toBe(0);
  });
  it('breaks ties toward the lower index', () => {
    expect(snapBucket(56, HR_BUCKETS.centroids)).toBe(0); // equidistant 50/62
  });
});

describe('snapToBuckets', () => {
  it('snaps each axis independently', () => {
    expect(snapToBuckets(62, 200, 15)).toEqual({
      hrBucket: 1,
      stepsBucket: 0,
      tempBucket: 3,
    });
  });
});

describe('enumerateGrid', () => {
  it('produces exactly 150 unique grid points', () => {
    const grid = enumerateGrid();
    expect(grid).toHaveLength(150);
    const keys = new Set(
      grid.map((p) => `${p.hrBucket}-${p.stepsBucket}-${p.tempBucket}`),
    );
    expect(keys.size).toBe(150);
  });
  it('carries centroid and state for each axis', () => {
    const p = enumerateGrid()[0];
    expect(p.hrCentroid).toBe(HR_BUCKETS.centroids[0]);
    expect(p.tempState).toBe(TEMP_BUCKETS.states[0]);
  });
});

describe('fillStrap', () => {
  it('replaces every known token with a live value', () => {
    const out = fillStrap('{bpm} beats, {steps} steps, {temp} of {sky} sky', {
      bpm: 62.4,
      steps: 9400,
      temp: 14.6,
      sky: 'CLOUDY',
    });
    expect(out).toBe('62 beats, 9,400 steps, 15° of cloudy sky');
  });
  it('leaves unknown tokens untouched', () => {
    expect(fillStrap('a {wat} b', { bpm: 1, steps: 1, temp: 1, sky: 'x' })).toBe(
      'a {wat} b',
    );
  });
});
