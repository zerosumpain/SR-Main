import { describe, it, expect } from 'vitest';
import { sliceBase64 } from './sandbox';

// syncExplainerKit needs to chunk three.min.js's base64 (~893KB) into pieces
// small enough to survive as individual shell arguments (Linux caps a single
// argument at MAX_ARG_STRLEN, 128KB) when not in HOST_MODE. sliceBase64 is the
// pure slicing step behind that — this only tests that slicing and rejoining
// is lossless, not the shell round-trip itself (which needs a sandbox).
describe('sliceBase64', () => {
  it('rejoins to the original input for input larger than the slice size', () => {
    const b64 = Buffer.from('x'.repeat(200_000)).toString('base64');
    expect(b64.length).toBeGreaterThan(60_000);
    const slices = sliceBase64(b64, 60_000);
    expect(slices.length).toBeGreaterThan(1);
    expect(slices.join('')).toBe(b64);
  });

  it('produces slices no longer than the requested size', () => {
    const b64 = Buffer.from('y'.repeat(150_000)).toString('base64');
    const slices = sliceBase64(b64, 60_000);
    for (const s of slices) {
      expect(s.length).toBeLessThanOrEqual(60_000);
    }
  });

  it('returns a single slice when the input is already under the threshold', () => {
    const b64 = Buffer.from('small').toString('base64');
    const slices = sliceBase64(b64, 60_000);
    expect(slices).toEqual([b64]);
  });

  it('uses the default threshold when size is omitted', () => {
    const b64 = Buffer.from('z'.repeat(200_000)).toString('base64');
    const slices = sliceBase64(b64);
    expect(slices.join('')).toBe(b64);
    expect(slices.length).toBeGreaterThan(1);
  });
});
