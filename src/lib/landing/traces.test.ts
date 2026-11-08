import { describe, expect, it } from 'vitest';
import { BPM_MAX, BPM_MIN, clampBpm, ecgTrace, heartLine, HEART_PX_PER_SECOND, rulerNow, rulerTicks, spikeTrace, stepsTrace, TRACE_H, TRACE_W } from './traces';
import { binSteps, STEP_BINS } from './steps';
import { ago, until } from './live-vitals.svelte';

/** Every coordinate pair in a path, Q control points included. */
function points(d: string): Array<[number, number]> {
  return [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

const ALL = {
  ecg: ecgTrace(72),
  ecgFast: ecgTrace(180),
  ruler: rulerTicks(),
  spikes: spikeTrace([0, 3, 6, 1, 9, 0, 2]),
  steps: stepsTrace(Array.from({ length: 96 }, (_, i) => (i % 7) * 40), 60),
  releases: spikeTrace(Array.from({ length: 90 }, (_, i) => i % 5), 90),
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
    // The exact rate, not the nearest ten: 72 bpm fits a seventh beat at 5.0s.
    expect(peaks(ecgTrace(72))).toBe(7);
    expect(peaks(ecgTrace(64))).toBe(6);
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
    expect(spikeTrace([1, 4, 2])).toBe(spikeTrace([1, 4, 2]));
    expect(heartLine(72, 1440, 72).d).toBe(heartLine(72, 1440, 72).d);
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
  it('rules the day with a tick an hour, taller every six', () => {
    const ticks = points(rulerTicks()).filter(([, y]) => y < TRACE_H);
    expect(ticks).toHaveLength(25);
    expect(ticks.filter(([, y]) => y === TRACE_H - 6).map(([x]) => x)).toEqual([0, 250, 500, 750, 1000]);
  });
  it('puts now at the end of the quarter-hour in progress, and the pending rest after it', () => {
    expect(rulerNow(0)).toBe(10.4);
    expect(rulerNow(47)).toBe(500);
    expect(rulerNow(95)).toBe(1000);
    // Out-of-range bins stay on the ruler.
    expect(rulerNow(-3)).toBe(10.4);
    expect(rulerNow(400)).toBe(1000);
    // Every bar drawn sits left of now: the pending stretch is empty.
    const bins = Array.from({ length: 96 }, () => 50);
    const bars = points(stepsTrace(bins, 40)).filter(([, y]) => y < 54).map(([x]) => x);
    expect(Math.max(...bars)).toBeLessThan(rulerNow(40));
  });
});

describe('the hero heartbeat line', () => {
  /** x of every R peak: the highest point of each complex. */
  const peaks = (d: string) => points(d).filter(([, y]) => y === Math.min(...points(d).map(([, v]) => v)));

  it('lies flat with no fresh reading, and beats with one', () => {
    expect(heartLine(null, 1440, 72)).toEqual({ d: 'M0,47.5 L1440,47.5', beats: 0, peak: 0 });
    expect(heartLine(0, 1440, 72).beats).toBe(0);
    expect(heartLine(52, 1440, 72).beats).toBeGreaterThan(0);
  });

  it('draws a whole number of beats at a fixed paper speed, so spacing is the rate', () => {
    // 1440px at 170px a second is an 8.5s strip: 52 bpm fits seven beats, 104 fits fifteen.
    const slow = heartLine(52, 1440, 72);
    const fast = heartLine(104, 1440, 72);
    expect(slow.beats).toBe(Math.round(1440 / HEART_PX_PER_SECOND / (60 / 52)));
    expect(fast.beats).toBe(15);
    expect(peaks(slow.d)).toHaveLength(slow.beats);
    expect(peaks(fast.d)).toHaveLength(fast.beats);
    // Evenly spaced: every gap between R peaks is the same to a pixel.
    const xs = peaks(slow.d).map(([x]) => x);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    for (const g of gaps) expect(Math.abs(g - 1440 / slow.beats)).toBeLessThanOrEqual(0.2);
  });

  it('stays inside its box at every width and rate, end to end', () => {
    for (const [bpm, w, h] of [[40, 390, 56], [52, 1440, 72], [160, 2560, 72], [999, 300, 10]] as const) {
      const { d } = heartLine(bpm, w, h);
      const pts = points(d);
      expect(pts[0]).toEqual([0, pts[0][1]]);
      expect(pts.at(-1)![0]).toBe(w);
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(w);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(Math.max(24, h));
      }
    }
  });

  it('draws every rate the watch has sent at that rate, and only clamps the implausible', () => {
    // On record: 36 to 189 bpm. Both draw as themselves, not as a clamped 40 or 160.
    expect(heartLine(36, 1440, 72)).not.toEqual(heartLine(40, 1440, 72));
    expect(heartLine(189, 1440, 72)).not.toEqual(heartLine(160, 1440, 72));
    expect(heartLine(189, 1440, 72).beats).toBe(Math.round(1440 / HEART_PX_PER_SECOND / (60 / 189)));
    expect(heartLine(250, 1440, 72)).toEqual(heartLine(BPM_MAX, 1440, 72));
    expect(heartLine(10, 1440, 72)).toEqual(heartLine(BPM_MIN, 1440, 72));
    expect(clampBpm(36)).toBe(36);
    expect(clampBpm(189)).toBe(189);
  });

  it('keeps every complex whole and apart at the fastest rate it draws', () => {
    const { d, beats } = heartLine(BPM_MAX, 390, 56);
    const xs = points(d).map(([x]) => x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
    expect(beats).toBeGreaterThan(0);
    // The six-second footnote strip draws one complex per beat: 20 at 200 bpm.
    expect(points(ecgTrace(BPM_MAX)).filter(([, y]) => y === 6).length).toBe(20);
  });

  it('reports where the R wave falls along each beat, for things that pulse with the sweep', () => {
    const { peak } = heartLine(60, 1440, 72);
    expect(peak).toBeGreaterThan(0.2);
    expect(peak).toBeLessThan(0.6);
    expect(heartLine(60, 1440, 72)).toEqual(heartLine(60, 1440, 72));
  });
});

describe('releases per day', () => {
  it('draws one spike per non-empty day across the whole window', () => {
    const counts = Array.from({ length: 90 }, (_, i) => (i % 3 === 0 ? 0 : 2));
    const tops = points(spikeTrace(counts, 90)).filter(([, y]) => y < 50);
    expect(tops).toHaveLength(60);
    // The default window stays the Ship channel's forty days.
    expect(points(spikeTrace(counts)).filter(([, y]) => y < 50).length).toBeLessThanOrEqual(40);
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
