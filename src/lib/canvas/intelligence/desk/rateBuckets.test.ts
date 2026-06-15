// src/lib/canvas/intelligence/desk/rateBuckets.test.ts
import { describe, it, expect } from 'vitest';
import { incrementBucket, rollWindow, currentRate, RATE_WINDOW } from './rateBuckets';

describe('incrementBucket', () => {
  it('increments the last (current) bucket', () => {
    const result = incrementBucket([0, 0, 0]);
    expect(result[result.length - 1]).toBe(1);
  });

  it('does not mutate the input array', () => {
    const orig = [0, 3, 5];
    const result = incrementBucket(orig);
    expect(orig).toEqual([0, 3, 5]); // unchanged
    expect(result).not.toBe(orig);
  });

  it('increments from a non-zero value', () => {
    const result = incrementBucket([1, 2, 4]);
    expect(result[result.length - 1]).toBe(5);
  });

  it('handles empty array by creating a bucket with 1', () => {
    const result = incrementBucket([]);
    expect(result).toEqual([1]);
  });

  it('does not affect earlier buckets', () => {
    const result = incrementBucket([10, 20, 5]);
    expect(result[0]).toBe(10);
    expect(result[1]).toBe(20);
  });
});

describe('rollWindow', () => {
  it('shifts oldest bucket off and appends a 0', () => {
    const result = rollWindow([1, 2, 3, 4], 4);
    expect(result).toEqual([2, 3, 4, 0]);
  });

  it('returns a new array (does not mutate)', () => {
    const orig = [1, 2, 3];
    const result = rollWindow(orig, 3);
    expect(orig).toEqual([1, 2, 3]);
    expect(result).not.toBe(orig);
  });

  it('maintains the window size', () => {
    const buckets = Array.from({ length: RATE_WINDOW }, (_, i) => i);
    const result = rollWindow(buckets);
    expect(result.length).toBe(RATE_WINDOW);
  });

  it('zero-fills when shorter than window', () => {
    // rollWindow([5, 3], 4):
    //   shifted = [3, 0]  (drop 5, append fresh 0)
    //   zero-fill left: [0, 0, 3, 0]
    const result = rollWindow([5, 3], 4);
    expect(result.length).toBe(4);
    expect(result).toEqual([0, 0, 3, 0]);
  });

  it('caps to windowSize if somehow overfilled', () => {
    const over = Array.from({ length: 25 }, () => 1);
    const result = rollWindow(over, RATE_WINDOW);
    expect(result.length).toBe(RATE_WINDOW);
  });

  it('a fully-zero window rolls to another zero window', () => {
    const zeros = Array.from({ length: RATE_WINDOW }, () => 0);
    const result = rollWindow(zeros);
    expect(result.every(v => v === 0)).toBe(true);
  });

  it('idle: many rolls after activity decays the window to zero', () => {
    let b = [0, 0, 10, 0]; // one burst bucket
    for (let i = 0; i < 4; i++) b = rollWindow(b, 4);
    expect(b.every(v => v === 0)).toBe(true);
  });
});

describe('currentRate', () => {
  it('returns the second-to-last bucket (last completed)', () => {
    expect(currentRate([0, 0, 7, 3])).toBe(7);
  });

  it('returns 0 for < 2 buckets', () => {
    expect(currentRate([])).toBe(0);
    expect(currentRate([5])).toBe(0);
  });
});
