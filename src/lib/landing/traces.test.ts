import { describe, expect, it } from 'vitest';
import { cumulativeTrace, ecgTrace, idleTrace, spikeTrace, stairTrace, stepsTrace, tickTrace, TRACE_H, TRACE_W } from './traces';
import { binSteps, STEP_BINS } from './steps';
import { ago, until } from './live-vitals.svelte';

/** Every coordinate pair in a path, Q control points included. */
function points(d: string): Array<[number, number]> {
  return [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

const ALL = {
  ecg: ecgTrace(72),
  ecgFast: ecgTrace(180),
  ticks: tickTrace(8, 10, true),
  stairs: stairTrace(3),
  spikes: spikeTrace([0, 3, 6, 1, 9, 0, 2]),
  idle: idleTrace(0),
  busy: idleTrace(4),
  steps: stepsTrace(Array.from({ length: 96 }, (_, i) => (i % 7) * 40), 60),
  releases: cumulativeTrace([2, 0, 5, 7, 1], 1300),
};

describe('landing traces', () => {
  it.each(Object.entries(ALL))('%s stays inside the 1000×60 box and spans its width', (_, d) => {
    const pts = points(d);
    expect(pts.length).toBeGreaterThan(2);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(-5);
      expect(x).toBeLessThanOrEqual(TRACE_W + 5);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(TRACE_H);
    }
    expect(pts[0][0]).toBe(0);
    // Spans the full strip (a multi-stroke trace may not END on the right edge).
    expect(Math.max(...pts.map(([x]) => x))).toBeGreaterThanOrEqual(TRACE_W - 1);
  });

  it('draws one R peak per beat in a six-second strip', () => {
    const peaks = (d: string) => points(d).filter(([, y]) => y === 6).length;
    expect(peaks(ecgTrace(60))).toBe(6);
    expect(peaks(ecgTrace(90))).toBe(9);
    // No live heart rate still draws a calm, plausible trace.
    expect(peaks(ecgTrace(null))).toBe(6);
  });

  it('scales deploy spikes to the busiest day and skips empty days', () => {
    const d = spikeTrace([0, 5, 10]);
    const tops = points(d).filter(([, y]) => y < 50).map(([, y]) => y);
    expect(tops).toHaveLength(2);
    expect(Math.min(...tops)).toBe(4); // the peak day reaches 4 + 42 above the floor
    expect(spikeTrace([])).toBe('M0,50 L1000,50');
  });

  it('is deterministic, so SSR and hydration draw the same path', () => {
    expect(ecgTrace(72)).toBe(ecgTrace(72));
    expect(idleTrace(2)).toBe(idleTrace(2));
  });

  it('lifts the assistant trace only while work is in flight', () => {
    const spread = (d: string) => {
      const ys = points(d).map(([, y]) => y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(spread(idleTrace(0))).toBeLessThan(6);
    expect(spread(idleTrace(3))).toBeGreaterThan(15);
  });
});

describe('steps strip', () => {
  const bounds = { start: 1_000_000, end: 1_000_000 + 86_400 };
  it('bins samples by quarter-hour from local midnight', () => {
    const r = binSteps(
      [
        { date: bounds.start + 60, steps: 100 }, // 00:01
        { date: bounds.start + 12 * 3600 + 5 * 60, steps: 250 }, // 12:05
        { date: bounds.start + 12 * 3600 + 14 * 60, steps: 50 }, // 12:14, same bin
        { date: bounds.end + 10, steps: 999 }, // tomorrow: dropped
      ],
      bounds,
      bounds.start + 13 * 3600,
    );
    expect(r.bins).toHaveLength(STEP_BINS);
    expect(r.bins[0]).toBe(100);
    expect(r.bins[48]).toBe(300);
    expect(r.total).toBe(400);
    expect(r.nowBin).toBe(52);
  });
  it('tells no samples apart from a recorded zero', () => {
    expect(binSteps([], bounds, bounds.start).total).toBeNull();
    expect(binSteps([{ date: bounds.start, steps: 0 }], bounds, bounds.start).total).toBe(0);
  });
  it('draws nothing after now', () => {
    const bins = new Array(96).fill(10);
    const strokes = (d: string) => (d.match(/M/g) ?? []).length - 1;
    expect(strokes(stepsTrace(bins, 9))).toBe(10);
  });
});

describe('releases climb', () => {
  it('rises monotonically from the left edge to the right', () => {
    const ys = points(cumulativeTrace([1, 2, 0, 4], 100)).map(([, y]) => y);
    expect(ys[0]).toBeGreaterThan(ys.at(-1)!);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThanOrEqual(ys[i - 1]);
  });
});

describe('relative times', () => {
  const ref = Date.parse('2026-10-03T12:00:00Z');
  it('ago', () => {
    expect(ago('2026-10-03T11:59:30Z', ref)).toBe('just now');
    expect(ago('2026-10-03T11:33:00Z', ref)).toBe('27m ago');
    expect(ago('2026-10-03T09:00:00Z', ref)).toBe('3h ago');
    expect(ago(null, ref)).toBe('');
    expect(ago('not a date', ref)).toBe('');
  });
  it('until', () => {
    expect(until('2026-10-03T12:18:00Z', ref)).toBe('in 18m');
    expect(until('2026-10-03T11:58:00Z', ref)).toBe('due now');
    expect(until('2026-10-03T14:00:00Z', ref)).toBe('in 2h');
    expect(until(undefined, ref)).toBe('');
  });
});
