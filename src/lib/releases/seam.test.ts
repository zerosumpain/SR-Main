import { describe, it, expect } from 'vitest';
import {
  buildSeamField,
  columnAtFraction,
  envelopePoints,
  shortDate,
  HORIZON,
  VIEW_W,
  VIEW_H,
} from './seam';
import type { CadenceDay } from './public';

function cadence(spec: [string, number, number][]): CadenceDay[] {
  return spec.map(([date, count, shipped]) => ({ date, count, shipped }));
}

describe('buildSeamField', () => {
  it('survives an empty history without dividing by zero', () => {
    const f = buildSeamField([]);
    expect(f.days).toBe(0);
    expect(f.columns).toEqual([]);
    expect(envelopePoints(f)).toBe('');
  });

  it('spans the full logical width regardless of day count', () => {
    for (const n of [1, 7, 133, 400]) {
      const days = cadence(
        Array.from({ length: n }, (_, i) => [`2026-03-${String((i % 28) + 1).padStart(2, '0')}`, 1, 1] as [string, number, number]),
      );
      const f = buildSeamField(days);
      expect(f.columns[0].cx).toBeGreaterThan(0);
      expect(f.columns[f.columns.length - 1].cx).toBeLessThan(VIEW_W);
      expect(f.columns.length).toBe(n);
    }
  });

  it('keeps every mark inside the viewBox', () => {
    const f = buildSeamField(
      cadence([
        ['2026-03-19', 12, 9],
        ['2026-03-20', 1, 0],
        ['2026-03-21', 0, 0],
        ['2026-03-22', 5, 14],
      ]),
    );
    for (const c of f.columns) {
      expect(c.upY).toBeGreaterThanOrEqual(0);
      expect(c.upY).toBeLessThanOrEqual(HORIZON);
      expect(c.downY).toBeGreaterThanOrEqual(HORIZON);
      expect(c.downY).toBeLessThanOrEqual(VIEW_H);
    }
  });

  it('draws nothing above or below the line on a silent day', () => {
    const f = buildSeamField(cadence([['2026-03-19', 0, 0], ['2026-03-20', 4, 4]]));
    expect(f.columns[0].upY).toBe(HORIZON);
    expect(f.columns[0].downY).toBe(HORIZON);
    expect(f.columns[1].upY).toBeLessThan(HORIZON);
  });

  it('gives a busy day a taller bar than a quiet one', () => {
    const f = buildSeamField(cadence([['2026-03-19', 1, 1], ['2026-03-20', 12, 1]]));
    const quiet = HORIZON - f.columns[0].upY;
    const busy = HORIZON - f.columns[1].upY;
    expect(busy).toBeGreaterThan(quiet);
  });

  it('compresses the peak so the median day stays visible', () => {
    // Linear scaling would render the 1-deploy day at 1/12th of the peak.
    // log1p must keep it materially taller than that.
    const f = buildSeamField(cadence([['2026-03-19', 1, 0], ['2026-03-20', 12, 0]]));
    const ratio = (HORIZON - f.columns[0].upY) / (HORIZON - f.columns[1].upY);
    expect(ratio).toBeGreaterThan(1 / 6);
  });

  it('caps yield at 1 when a day ships more items than deploys', () => {
    const f = buildSeamField(cadence([['2026-03-19', 1, 9]]));
    expect(f.columns[0].yield).toBe(1);
  });

  it('reports zero yield for a day that shipped nothing describable', () => {
    const f = buildSeamField(cadence([['2026-03-19', 3, 0]]));
    expect(f.columns[0].yield).toBe(0);
  });

  it('marks one tick per month, in order', () => {
    const f = buildSeamField(
      cadence([
        ['2026-03-30', 1, 1],
        ['2026-03-31', 1, 1],
        ['2026-04-01', 1, 1],
        ['2026-04-02', 1, 1],
        ['2026-05-01', 1, 1],
      ]),
    );
    expect(f.ticks.map((t) => t.label)).toEqual(['Mar', 'Apr', 'May']);
    expect(f.ticks.map((t) => t.i)).toEqual([0, 2, 4]);
  });
});

describe('columnAtFraction', () => {
  const f = buildSeamField(
    cadence(Array.from({ length: 10 }, (_, i) => [`2026-03-${String(i + 1).padStart(2, '0')}`, 1, 1])),
  );

  it('maps the extremes to the first and last column', () => {
    expect(columnAtFraction(f, 0)).toBe(0);
    expect(columnAtFraction(f, 1)).toBe(9);
  });

  it('clamps out-of-range input rather than returning a bad index', () => {
    expect(columnAtFraction(f, -3)).toBe(0);
    expect(columnAtFraction(f, 4.2)).toBe(9);
  });

  it('returns -1 for an empty field', () => {
    expect(columnAtFraction(buildSeamField([]), 0.5)).toBe(-1);
  });
});

describe('shortDate', () => {
  it('formats without a leading zero', () => {
    expect(shortDate('2026-03-19')).toBe('19 Mar');
    expect(shortDate('2026-07-01')).toBe('1 Jul');
  });
});
