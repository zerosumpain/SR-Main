import { describe, expect, it } from 'vitest';
import { GATE_PITCH, dialHand, dialWedge, inkHeart, inkHook, inkLine, inkRing, inkRuler, inkTally, rng, rulerHours } from './notes-ink';
import { HEART_PX_PER_SECOND, heartLine } from './traces';

/** Every coordinate pair in a path, Bézier control points included. */
function points(d: string): Array<[number, number]> {
  return [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}
/** Separate strokes in a path (one per M). */
const strokes = (d: string) => (d.match(/M/g) ?? []).length;

describe('the pen', () => {
  it('is seeded: the same seed draws the same stroke, another seed a different one', () => {
    expect(inkLine(rng(4), 0, 0, 100, 0)).toBe(inkLine(rng(4), 0, 0, 100, 0));
    expect(inkLine(rng(4), 0, 0, 100, 0)).not.toBe(inkLine(rng(5), 0, 0, 100, 0));
  });

  it('three takes of the ring differ, and each stays near its box', () => {
    const takes = [1, 2, 3].map((s) => inkRing(rng(s), 60, 50, 54, 44));
    expect(new Set(takes).size).toBe(3);
    for (const d of takes)
      for (const [x, y] of points(d)) {
        expect(Math.abs(x - 60)).toBeLessThanOrEqual(54 * 1.2);
        expect(Math.abs(y - 50)).toBeLessThanOrEqual(44 * 1.2);
      }
  });
});

describe('inkHeart', () => {
  it('draws a flat line, with no beats, without a reading', () => {
    for (const bpm of [null, 0, -3]) {
      const h = inkHeart(bpm, 800, 64);
      expect(h.beats).toBe(0);
      const ys = points(h.d).map(([, y]) => y);
      // A hand's wobble, never a spike.
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(3);
    }
  });

  it('keeps the same whole-beat strip as the sentence line, so the sweep crosses one beat per real beat', () => {
    for (const [bpm, w] of [
      [52, 880],
      [36, 880],
      [72, 1400],
      [189, 600],
      [60, 240],
    ] as const) {
      const ink = inkHeart(bpm, w, 64);
      expect(ink.beats).toBe(heartLine(bpm, w, 64).beats);
      // One R wave per beat: the points near the top of the box.
      expect(points(ink.d).filter(([, y]) => y < 64 * 0.12).length).toBe(ink.beats);
    }
  });

  it('spaces the beats at the real rate: a slower heart, fewer beats in the same width', () => {
    const w = 170 * 6; // six seconds of paper
    expect(w / HEART_PX_PER_SECOND).toBe(6);
    expect(inkHeart(40, w, 64).beats).toBe(4);
    expect(inkHeart(60, w, 64).beats).toBe(6);
    expect(inkHeart(120, w, 64).beats).toBe(12);
  });

  it('stays inside its box and spans the width', () => {
    const ink = inkHeart(52, 900, 64);
    const pts = points(ink.d);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(x).toBeLessThanOrEqual(901);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(64);
    }
    expect(pts[0][0]).toBe(0);
    expect(pts.at(-1)![0]).toBe(900);
  });

  it('puts the R wave early in each beat, where the ring redraws', () => {
    const { peak } = inkHeart(52, 900, 64);
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThan(0.6);
  });

  it('is the same on the server and in the browser', () => {
    expect(inkHeart(52, 900, 64).d).toBe(inkHeart(52, 900, 64).d);
    expect(inkHook(36, 64)).toBe(inkHook(36, 64));
  });
});

describe('inkRuler', () => {
  const bins = Array.from({ length: 96 }, (_, i) => (i >= 28 && i % 3 === 0 ? 40 + i : 0));

  it('draws nothing after now', () => {
    const r = inkRuler(480, 60, bins, 40);
    const xs = points(`${r.quiet} ${r.busy}`).map(([x]) => x);
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(r.now);
  });

  it('hatches exactly the part of the day still to come', () => {
    const r = inkRuler(480, 60, bins, 40);
    const xs = points(r.hatch).map(([x]) => x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(r.now - 0.5);
    expect(Math.max(...xs)).toBeLessThanOrEqual(r.x1 + 0.5);
    // The last quarter-hour of the day: no hatch is left to draw.
    expect(inkRuler(480, 60, bins, 95).hatch).toBe('');
  });

  it('places now at the far edge of the quarter-hour in progress', () => {
    const r = inkRuler(486, 60, null, 47);
    // 48 of 96 bins are past or in progress: halfway along the inside of the ruler.
    expect(r.now).toBeCloseTo((r.x0 + r.x1) / 2, 0);
  });

  it('leaves the ruler empty when no steps have arrived, and when they are all zero', () => {
    for (const b of [null, new Array(96).fill(0)]) {
      const r = inkRuler(480, 60, b, 50);
      expect(r.quiet).toBe('');
      expect(r.busy).toBe('');
      expect(r.hatch).not.toBe('');
    }
  });

  it('inks the busy quarter-hours apart, and scales to the busiest so far', () => {
    const b = new Array(96).fill(0);
    b[30] = 100;
    b[31] = 20;
    b[60] = 900; // the future: neither drawn nor counted in the scale
    const r = inkRuler(480, 60, b, 40);
    expect(strokes(r.busy)).toBe(1);
    expect(strokes(r.quiet)).toBe(1);
  });

  it('keeps its top edge flat, for the rambler to sit on', () => {
    const r = inkRuler(480, 60, bins, 40);
    const top = points(r.frame.split(' M')[0]);
    for (const [, y] of top) expect(Math.abs(y - 1.5)).toBeLessThan(1);
  });

  it('labels the hours that stay clear of "now-ish"', () => {
    const r = inkRuler(480, 60, bins, 47);
    const hours = rulerHours(r.x0, r.x1, r.now).map((l) => l.h);
    expect(hours).toEqual([0, 6, 18, 24]);
    expect(rulerHours(0, 480, 1000).map((l) => l.h)).toEqual([0, 6, 12, 18, 24]);
  });
});

describe('inkTally', () => {
  it('draws one stroke per deploy, gates of five as four uprights and a slash', () => {
    for (const c of [0, 1, 4, 5, 7, 10, 13]) {
      const t = inkTally(c, 48, 13, c);
      expect(strokes(t.d)).toBe(c);
      expect(t.more).toBe(0);
    }
  });

  it('keeps every stroke inside its cell', () => {
    const t = inkTally(15, 48, 13, 1);
    for (const [x, y] of points(t.d)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(48);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(13);
    }
  });

  it('never squeezes strokes past counting: a crowded day says "+n" for the rest', () => {
    const w = 48;
    const fit = Math.floor((w + 4) / GATE_PITCH);
    expect(fit).toBe(3);
    const t = inkTally(23, w, 13, 2);
    // Two gates drawn (10), and the other 13 said in figures.
    expect(strokes(t.d)).toBe(10);
    expect(t.more).toBe(13);
    expect(t.moreX).toBe(2 * GATE_PITCH);
  });
});

describe('the dial', () => {
  it('shades nothing at zero or without a wait', () => {
    expect(dialWedge(30, 30, 20, 0)).toBeNull();
    expect(dialWedge(30, 30, 20, null)).toBeNull();
  });

  it('shades a quarter as a quarter, from twelve clockwise', () => {
    const d = dialWedge(30, 30, 20, 0.25)!;
    expect(d).toContain('M30,30 L30,10');
    // Ends at three o'clock.
    expect(d).toMatch(/50,30 Z$/);
    expect(d).toContain(' 0 0 1 ');
    expect(dialWedge(30, 30, 20, 0.75)).toContain(' 0 1 1 ');
  });

  it('shades a whole wait as the whole face, and caps anything longer', () => {
    expect(dialWedge(30, 30, 20, 1)).toBe(dialWedge(30, 30, 20, 3));
    expect(dialWedge(30, 30, 20, 1)).toContain('A20,20 0 1 1 30,50');
  });

  it('points the hand where the wedge ends', () => {
    const end = points(dialHand(30, 30, 20, 0.25)).at(-1)!;
    expect(end[0]).toBeGreaterThan(48);
    expect(Math.abs(end[1] - 30)).toBeLessThan(2);
  });
});
