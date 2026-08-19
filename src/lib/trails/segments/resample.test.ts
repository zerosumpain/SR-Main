import { describe, it, expect } from 'vitest';
import { resampleTrack, spanDistanceM, spanElevation, STEP_M } from './resample';
import { makeTrack } from './fixtures';

describe('resampleTrack', () => {
  it('re-cuts an irregular trace to uniform spacing', () => {
    const track = resampleTrack(makeTrack([[0, 0], [1000, 0]], { spacingM: 3 }));
    expect(track.n).toBeGreaterThanOrEqual(100); // 0 m … 1000 m
    expect(track.n).toBeLessThanOrEqual(101);
    for (let i = 1; i < track.n; i++) {
      expect(spanDistanceM(track, i - 1, i)).toBeCloseTo(STEP_M, 1);
    }
  });

  it('survives a source decimated far coarser than the step', () => {
    const track = resampleTrack(makeTrack([[0, 0], [500, 0]], { spacingM: 47 }));
    expect(track.n).toBeGreaterThanOrEqual(50);
    expect(spanDistanceM(track, 0, track.n - 1)).toBeGreaterThan(490);
  });

  it('interpolates time along the step, not per source point', () => {
    const track = resampleTrack(makeTrack([[0, 0], [1000, 0]], { speedMps: 2, spacingM: 5 }));
    // 10 m at 2 m/s is 5 s per resampled point.
    expect(track.t[10] - track.t[0]).toBeCloseTo(50, 1);
  });

  it('never lets time run backwards', () => {
    const points = makeTrack([[0, 0], [200, 0]], { spacingM: 5 });
    points[10][3] = points[9][3] - 30; // a watch re-sending an old sample
    const track = resampleTrack(points);
    for (let i = 1; i < track.n; i++) expect(track.t[i]).toBeGreaterThanOrEqual(track.t[i - 1]);
  });

  it('keeps a missing altitude missing rather than calling it sea level', () => {
    const track = resampleTrack(makeTrack([[0, 0], [200, 0]]));
    expect(Number.isNaN(track.ele[5])).toBe(true);
    expect(spanElevation(track, 0, track.n - 1)).toEqual({ gainM: 0, lossM: 0 });
  });

  it('measures a real climb, less the threshold it has not yet committed', () => {
    const track = resampleTrack(
      makeTrack([[0, 0], [1000, 0]], { ele: (d) => 100 + d * 0.05 }),
    );
    const { gainM, lossM } = spanElevation(track, 0, track.n - 1);
    // 50 m of climb, minus at most one uncommitted threshold's worth.
    expect(gainM).toBeGreaterThan(48);
    expect(gainM).toBeLessThanOrEqual(50);
    expect(lossM).toBe(0);
  });

  it('does not turn altitude jitter on the flat into a hill', () => {
    const track = resampleTrack(
      makeTrack([[0, 0], [2000, 0]], { ele: (d) => 100 + Math.sin(d / 7) * 0.5 }),
    );
    const { gainM, lossM } = spanElevation(track, 0, track.n - 1);
    expect(gainM).toBe(0);
    expect(lossM).toBe(0);
  });

  it('points the heading the way you are travelling', () => {
    const east = resampleTrack(makeTrack([[0, 0], [500, 0]]));
    const west = resampleTrack(makeTrack([[500, 0], [0, 0]]));
    // atan2(dEast, dNorth): due east is +90°, due west is −90°.
    expect((east.heading[20] * 180) / Math.PI).toBeCloseTo(90, 0);
    expect((west.heading[20] * 180) / Math.PI).toBeCloseTo(-90, 0);
    expect(Math.cos(east.heading[20] - west.heading[20])).toBeCloseTo(-1, 2);
  });

  it('returns nothing for a trace too short to have a shape', () => {
    expect(resampleTrack([]).n).toBe(0);
    expect(resampleTrack([[0, 0, null, 0]]).n).toBe(0);
  });
});
