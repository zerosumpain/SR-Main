import { describe, it, expect } from 'vitest';
import { computeForecast, FORECAST_ZERO, MIN_FORECAST_POINTS, type ForecastTrend } from './forecast';
import type { DayPoint } from './rolling';

/** Days from a fixed origin, so every fixture is deterministic. */
function day(offset: number): string {
  const t = Date.parse('2026-06-01T00:00:00Z') + offset * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function series(n: number, at: (i: number) => number, from = 0): DayPoint[] {
  return Array.from({ length: n }, (_, i) => ({ date: day(from + i), value: at(i) }));
}

/** A TrendSeries-shaped input; `daily` defaults to the same points as rolling7. */
function trend(over: Partial<ForecastTrend> & { rolling7: DayPoint[] }): ForecastTrend {
  const rolling7 = over.rolling7;
  return {
    daily: over.daily ?? rolling7,
    rolling7,
    latest7: over.latest7 ?? (rolling7.at(-1)?.value ?? null),
    baseline28: over.baseline28 ?? null,
    lastDate: over.lastDate ?? (rolling7.at(-1)?.date ?? null),
  };
}

describe('computeForecast — sufficiency', () => {
  it('refuses a series thinner than the floor, and still carries a full zero struct', () => {
    const r = computeForecast(trend({ rolling7: series(MIN_FORECAST_POINTS - 1, () => 7) }));
    expect(r.sufficiency).toBe('insufficient');
    expect(r.value).toEqual(FORECAST_ZERO);
    // The zero struct is POPULATED, never null — every reader can index it.
    expect(r.value.projection).toEqual([]);
    expect(r.value.cone).toEqual([]);
    expect(r.value.confidence).toBe(0);
  });

  it('refuses an empty series', () => {
    expect(computeForecast(trend({ rolling7: [] })).sufficiency).toBe('insufficient');
  });

  it('reads partial under a full window and ok at or over it', () => {
    expect(computeForecast(trend({ rolling7: series(10, (i) => 40 + i * 0.1) })).sufficiency).toBe('partial');
    expect(computeForecast(trend({ rolling7: series(28, (i) => 40 + i * 0.1) })).sufficiency).toBe('ok');
  });
});

describe('computeForecast — the projection', () => {
  const rising = trend({ rolling7: series(28, (i) => 40 + i * 0.1) });

  it('extends the fitted line, so a +0.1/day series gains ~3 a month', () => {
    const { value } = computeForecast(rising);
    expect(value.slopePerMonth).toBeCloseTo(3, 1);
  });

  it('joins the solid line: the first projected point IS today', () => {
    const { value } = computeForecast(rising);
    expect(value.projection[0].date).toBe(day(27));
    expect(value.projection[0].value).toBeCloseTo(value.now, 6);
    expect(value.now).toBeCloseTo(42.7, 1);
  });

  it('lands `then` on the horizon date and matches the last projected point', () => {
    const { value } = computeForecast(rising, { horizonDays: 90 });
    const last = value.projection.at(-1)!;
    expect(last.date).toBe(day(27 + 90));
    expect(value.then).toBeCloseTo(last.value, 6);
    expect(value.then).toBeCloseTo(42.7 + 9, 1);
  });

  it('ships the recorded window as history, oldest first', () => {
    const { value } = computeForecast(rising, { windowDays: 28 });
    expect(value.history).toHaveLength(28);
    expect(value.history[0].date).toBe(day(0));
    expect(value.history.at(-1)!.date).toBe(day(27));
  });

  it('only fits the window, so ancient history cannot bend the forecast', () => {
    const long = series(60, (i) => (i < 32 ? 100 : 40 + (i - 32) * 0.1));
    const { value } = computeForecast(trend({ rolling7: long }), { windowDays: 28 });
    expect(value.history).toHaveLength(28);
    expect(value.slopePerMonth).toBeCloseTo(3, 1);
  });
});

describe('computeForecast — the cone', () => {
  const noisy = trend({
    rolling7: series(28, () => 42),
    // Daily swings ±6 around a flat 7-day mean: real spread, no trend.
    daily: series(28, (i) => 42 + (i % 2 === 0 ? 6 : -6)),
  });

  it('starts closed at today and widens with distance', () => {
    const { value } = computeForecast(noisy, { horizonDays: 90 });
    const width = (k: number) => value.cone[k].upper - value.cone[k].lower;
    expect(width(0)).toBeCloseTo(0, 6);
    expect(width(1)).toBeGreaterThan(0);
    expect(width(value.cone.length - 1)).toBeGreaterThan(width(1));
  });

  it('is centred on the projection', () => {
    const { value } = computeForecast(noisy);
    for (let k = 0; k < value.cone.length; k++) {
      const mid = (value.cone[k].upper + value.cone[k].lower) / 2;
      expect(mid).toBeCloseTo(value.projection[k].value, 6);
      expect(value.cone[k].date).toBe(value.projection[k].date);
    }
  });

  it('takes its width from the spread of daily against rolling7, not from the trend', () => {
    const clean = trend({ rolling7: series(28, () => 42) });
    const a = computeForecast(clean).value;
    const b = computeForecast(noisy).value;
    expect(a.residualSd).toBeCloseTo(0, 6);
    expect(b.residualSd).toBeGreaterThan(5);
    expect(b.cone.at(-1)!.upper - b.cone.at(-1)!.lower).toBeGreaterThan(
      a.cone.at(-1)!.upper - a.cone.at(-1)!.lower,
    );
  });

  it('respects a physical floor — an ACWR cone never dips below zero', () => {
    const acwr = trend({
      rolling7: series(28, (i) => 1.2 - i * 0.02),
      daily: series(28, (i) => 1.2 - i * 0.02 + (i % 2 ? 0.4 : -0.4)),
    });
    const { value } = computeForecast(acwr, { min: 0 });
    expect(Math.min(...value.cone.map((c) => c.lower))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...value.projection.map((p) => p.value))).toBeGreaterThanOrEqual(0);
  });
});

describe('computeForecast — confidence', () => {
  it('is a whole percent inside 0–100', () => {
    const { value } = computeForecast(trend({ rolling7: series(28, (i) => 40 + i * 0.1) }));
    expect(Number.isInteger(value.confidence)).toBe(true);
    expect(value.confidence).toBeGreaterThanOrEqual(0);
    expect(value.confidence).toBeLessThanOrEqual(100);
  });

  it('prefers the steady line to the noisy one', () => {
    const steady = computeForecast(trend({ rolling7: series(28, (i) => 41.2 - i * 0.005) })).value;
    const jumpy = computeForecast(
      trend({
        rolling7: series(28, (i) => 42 + (i % 3) * 4),
        daily: series(28, (i) => 42 + (i % 3) * 4 + (i % 2 ? 14 : -14)),
      }),
    ).value;
    expect(steady.confidence).toBeGreaterThan(jumpy.confidence);
  });

  it('docks a short window even when it is perfectly clean', () => {
    const short = computeForecast(trend({ rolling7: series(10, (i) => 40 + i * 0.1) })).value;
    const full = computeForecast(trend({ rolling7: series(28, (i) => 40 + i * 0.1) })).value;
    expect(short.confidence).toBeLessThan(full.confidence);
  });
});

describe('computeForecast — provenance', () => {
  it('stamps asOf on the last recorded day, not on the clock', () => {
    const r = computeForecast(trend({ rolling7: series(28, () => 42) }));
    expect(r.asOf).toBe(day(27));
    expect(r.sampleSize).toBe(28);
  });
});
