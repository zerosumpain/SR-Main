import { describe, it, expect } from 'vitest';
import { nextSlackWindows, breydonAdvice } from './tide';

describe('nextSlackWindows', () => {
  const lw = new Date('2026-06-21T06:00:00Z');

  it('returns `count` windows (default 4)', () => {
    expect(nextSlackWindows(lw).length).toBe(4);
    expect(nextSlackWindows(lw, 2).length).toBe(2);
  });

  it('first window is centred at low water + 1 hour (slack)', () => {
    const [w0] = nextSlackWindows(lw);
    expect(w0.mid.getTime()).toBe(lw.getTime() + 3_600_000);
  });

  it('window is ±90 min around the mid', () => {
    const [w0] = nextSlackWindows(lw);
    expect(w0.start.getTime()).toBe(w0.mid.getTime() - 90 * 60_000);
    expect(w0.end.getTime()).toBe(w0.mid.getTime() + 90 * 60_000);
  });

  it('consecutive mids are spaced ≈ 12 h 25 m (semidiurnal period)', () => {
    const ws = nextSlackWindows(lw, 4);
    for (let i = 1; i < ws.length; i++) {
      const gapMin = (ws[i].mid.getTime() - ws[i - 1].mid.getTime()) / 60_000;
      expect(gapMin).toBeCloseTo(745, 0); // 44700 s = 745 min = 12h25m
    }
  });
});

describe('breydonAdvice', () => {
  it('returns the fixed guidance string', () => {
    expect(breydonAdvice()).toBe(
      'Breydon Water is tidal — cross at slack water, about 1 hour after low water at Great Yarmouth. Plan ~2¼ h from Acle or ~2 h from Reedham. Keep inside the red & green posts.',
    );
  });
});
