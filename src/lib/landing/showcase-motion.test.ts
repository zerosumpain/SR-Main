import { afterEach, describe, expect, it, vi } from 'vitest';
import { COUNT_MS, MINUS, SEEN_RATIO, beatFor, easeOut, firstView, formatFigure, onScreen, tweenValue } from './showcase-motion';

describe('easeOut', () => {
  it('runs 0 to 1, fast away and gentle at the end', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeCloseTo(0.875);
    expect(easeOut(0.25)).toBeGreaterThan(0.25);
  });
  it('clamps outside 0..1', () => {
    expect(easeOut(-1)).toBe(0);
    expect(easeOut(2)).toBe(1);
  });
});

describe('formatFigure', () => {
  it('groups en-GB', () => {
    expect(formatFigure(1234567)).toBe('1,234,567');
  });
  it('keeps the asked decimals', () => {
    expect(formatFigure(7.25, 1)).toBe('7.3');
    expect(formatFigure(7, 1)).toBe('7.0');
  });
  it('uses the real minus sign', () => {
    expect(formatFigure(-12)).toBe(`${MINUS}12`);
  });
  it('never prints -0', () => {
    expect(formatFigure(-0)).toBe('0');
    expect(formatFigure(-0.01, 1)).toBe('0.0');
  });
});

describe('tweenValue', () => {
  it('starts at zero and lands exactly on the figure', () => {
    expect(tweenValue(4321, 0)).toBe(0);
    expect(tweenValue(4321, COUNT_MS)).toBe(4321);
    expect(tweenValue(4321, COUNT_MS * 3)).toBe(4321);
  });
  it('climbs without passing the figure', () => {
    let last = -1;
    for (let t = 0; t <= COUNT_MS; t += 30) {
      const v = tweenValue(4321, t);
      expect(v).toBeGreaterThanOrEqual(last);
      expect(v).toBeLessThanOrEqual(4321);
      last = v;
    }
  });
  it('rounds to the figure’s own decimals', () => {
    const v = tweenValue(7.4, COUNT_MS / 3, COUNT_MS, 1);
    expect(Math.round(v * 10) / 10).toBe(v);
    expect(Number.isInteger(tweenValue(999, 123))).toBe(true);
  });
  it('a zero duration is the figure at once', () => {
    expect(tweenValue(50, 0, 0)).toBe(50);
  });
});

describe('beatFor', () => {
  it('beats only for a fresh pulse', () => {
    expect(beatFor({ state: 'fresh', bpm: 60, at: '2026-10-10T10:00:00Z' })).toBe('1s');
    expect(beatFor({ state: 'fresh', bpm: 72, at: '2026-10-10T10:00:00Z' })).toBe('0.833s');
    expect(beatFor({ state: 'stale', at: '2026-10-10T01:00:00Z' })).toBeNull();
    expect(beatFor({ state: 'none' })).toBeNull();
    expect(beatFor(null)).toBeNull();
  });
  it('clamps an implausible rate to the drawable range', () => {
    expect(beatFor({ state: 'fresh', bpm: 400, at: 'x' })).toBe('0.3s');
    expect(beatFor({ state: 'fresh', bpm: 10, at: 'x' })).toBe('2s');
  });
  it('never beats on a zero reading', () => {
    expect(beatFor({ state: 'fresh', bpm: 0, at: 'x' })).toBeNull();
  });
});

/* A stand-in IntersectionObserver the tests drive by hand. */
type Entry = { isIntersecting: boolean; intersectionRatio: number };
class FakeIO {
  static last: FakeIO | null = null;
  cb: (e: Entry[]) => void;
  opts: unknown;
  observed = 0;
  disconnected = false;
  constructor(cb: (e: Entry[]) => void, opts?: unknown) {
    this.cb = cb;
    this.opts = opts;
    FakeIO.last = this;
  }
  observe() {
    this.observed++;
  }
  disconnect() {
    this.disconnected = true;
  }
  fire(isIntersecting: boolean, intersectionRatio = isIntersecting ? 1 : 0) {
    this.cb([{ isIntersecting, intersectionRatio }]);
  }
}

const node = {} as Element;

describe('firstView', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeIO.last = null;
  });

  it('fires at once with no IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const cb = vi.fn();
    firstView(node, cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires once, only when enough of it shows', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO);
    const cb = vi.fn();
    firstView(node, cb);
    const io = FakeIO.last!;
    expect(io.opts).toEqual({ threshold: [SEEN_RATIO] });
    io.fire(true, SEEN_RATIO / 2);
    expect(cb).not.toHaveBeenCalled();
    io.fire(true, 0.6);
    io.fire(true, 1);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(io.disconnected).toBe(true);
  });

  it('stops watching when destroyed', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO);
    const a = firstView(node, () => {});
    a.destroy();
    expect(FakeIO.last!.disconnected).toBe(true);
  });
});

describe('onScreen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeIO.last = null;
  });

  it('reports changes only, and counts a hidden tab as away', () => {
    const listeners = new Map<string, () => void>();
    const doc = {
      hidden: false,
      addEventListener: (k: string, f: () => void) => listeners.set(k, f),
      removeEventListener: (k: string) => listeners.delete(k),
    };
    vi.stubGlobal('IntersectionObserver', FakeIO);
    vi.stubGlobal('document', doc);
    const seen: boolean[] = [];
    const a = onScreen(node, (v) => seen.push(v));
    const io = FakeIO.last!;
    io.fire(true);
    io.fire(true);
    doc.hidden = true;
    listeners.get('visibilitychange')!();
    doc.hidden = false;
    listeners.get('visibilitychange')!();
    io.fire(false);
    expect(seen).toEqual([true, false, true, false]);
    a.destroy();
    expect(io.disconnected).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it('counts as on screen with no IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const seen: boolean[] = [];
    onScreen(node, (v) => seen.push(v)).destroy();
    expect(seen).toEqual([true]);
  });
});
