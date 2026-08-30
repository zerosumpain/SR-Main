// Where a line goes if nothing changes.
//
// Every other module in this directory reads what HAS happened. This one is the
// only forward-looking thing on /health, which makes it the one most able to
// lie, so the method is deliberately the dullest defensible one and the output
// carries its own uncertainty rather than a single confident number.
//
// The method, in full:
//
//  1. Fit an ordinary least-squares line to the ROLLING-7 series over the last
//     `windowDays` days. The rolling mean, not the daily series: a forecast off
//     raw dailies is a forecast of yesterday's weather.
//  2. Extend that line from the last recorded rolling-7 point ("today") to
//     `horizonDays` ahead, sampled every `stepDays`.
//  3. Widen a cone around it. The half-width at k days out is
//     `residualSd * sqrt(k / 7)`, where `residualSd` is the spread of the DAILY
//     series about its own rolling mean inside the window. That makes the cone
//     exactly one residual SD wide at a week out and grow like a random walk
//     after — it is an honest picture of the noise, not a formal prediction
//     interval, and the label on the chart says so.
//  4. Report a confidence percent built from three things a reader can check:
//     how much of the window actually has data, how quiet the signal is against
//     its own mean, and how well a straight line explains it.
//
// Same two rules as ledes.ts: an `insufficient` result carries a fully
// populated ZERO struct rather than a null, and thin data produces a WIDE cone
// and a low confidence rather than a confident guess.

import type { MetricResult } from './types';
import type { DayPoint } from './rolling';

/**
 * Structurally a `TrendSeries` (`$lib/trails/physio-service`). Restated here so
 * the module stays pure — nothing in `analytics/` should reach the database,
 * even transitively through a type import.
 */
export interface ForecastTrend {
  daily: DayPoint[];
  rolling7: DayPoint[];
  latest7: number | null;
  baseline28: number | null;
  lastDate: string | null;
}

export interface ForecastOptions {
  /** How far ahead to project. The Forecast section is a 90-day read. */
  horizonDays?: number;
  /** How far back the fit looks. 28 days is the baseline everything else uses. */
  windowDays?: number;
  /** Spacing of the projected points — 7 gives 13 vertices over 90 days. */
  stepDays?: number;
  /** Physical floor, e.g. 0 for an ACWR or a duration. Clamps cone and line. */
  min?: number;
  /** Physical ceiling, e.g. 100 for a percentage. */
  max?: number;
}

export interface ConePoint {
  date: string;
  lower: number;
  upper: number;
}

export interface ForecastResult {
  /** Recorded rolling-7 inside the window, oldest first — the solid line. */
  history: DayPoint[];
  /** The fitted line from today to the horizon — the dashed line. Starts AT
   *  today's value so the two polylines join with no step. */
  projection: DayPoint[];
  /** Same dates as `projection`, so the cone fills straight off the pair. */
  cone: ConePoint[];
  /** Today's fitted value, and where the line puts it at the horizon. */
  now: number;
  then: number;
  /** Change per 30 days in the series' own units — the readable slope. */
  slopePerMonth: number;
  /** 0–100, whole. What the header prints as "72% CONF". */
  confidence: number;
  /** Spread of daily about rolling-7 inside the window. The cone's unit. */
  residualSd: number;
  /** Echoed so a caller rendering an axis does not have to re-derive it. */
  horizonDays: number;
}

/** Below this many rolling-7 points a straight line through them means nothing. */
export const MIN_FORECAST_POINTS = 7;

const DEFAULT_HORIZON_DAYS = 90;
const DEFAULT_WINDOW_DAYS = 28;
const DEFAULT_STEP_DAYS = 7;

/** The fully-populated zero an `insufficient` result carries. */
export const FORECAST_ZERO: ForecastResult = {
  history: [],
  projection: [],
  cone: [],
  now: 0,
  then: 0,
  slopePerMonth: 0,
  confidence: 0,
  residualSd: 0,
  horizonDays: DEFAULT_HORIZON_DAYS,
};

export function computeForecast(
  trend: ForecastTrend,
  opts: ForecastOptions = {},
): MetricResult<ForecastResult> {
  const horizonDays = opts.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const stepDays = opts.stepDays ?? DEFAULT_STEP_DAYS;

  const rolling = [...(trend.rolling7 ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const anchor = rolling.at(-1);
  if (!anchor) return insufficient({ ...FORECAST_ZERO, horizonDays }, 0, trend.lastDate);

  const endDay = dayNumber(anchor.date);
  const startDay = endDay - windowDays + 1;
  const history = rolling.filter((p) => dayNumber(p.date) >= startDay);

  if (history.length < MIN_FORECAST_POINTS) {
    return insufficient({ ...FORECAST_ZERO, horizonDays }, history.length, anchor.date);
  }

  // ——— 1. the fit ———————————————————————————————————————————————
  // x is DAYS from the window's first point, not the array index: these series
  // have real gaps, and an index-based fit reads a fortnight of silence as a
  // fortnight of steady progress.
  const x0 = dayNumber(history[0].date);
  const xs = history.map((p) => dayNumber(p.date) - x0);
  const ys = history.map((p) => p.value);
  const { slope, intercept, r2 } = leastSquares(xs, ys);

  const clamp = (v: number) => {
    let out = v;
    if (opts.min != null) out = Math.max(opts.min, out);
    if (opts.max != null) out = Math.min(opts.max, out);
    return out;
  };

  const xNow = endDay - x0;
  const now = clamp(intercept + slope * xNow);

  // ——— 2. the projection ————————————————————————————————————————
  const projection: DayPoint[] = [];
  for (let k = 0; k <= horizonDays; k += stepDays) {
    projection.push({ date: isoDay(endDay + k), value: round(clamp(intercept + slope * (xNow + k))) });
  }
  // A horizon that is not a whole number of steps still ends ON the horizon —
  // a chart whose dashed line stops 6 days short of its own axis is a bug the
  // reader can see.
  if ((projection.at(-1) as DayPoint).date !== isoDay(endDay + horizonDays)) {
    projection.push({
      date: isoDay(endDay + horizonDays),
      value: round(clamp(intercept + slope * (xNow + horizonDays))),
    });
  }
  // The line must LEAVE from the recorded point, or the chart shows a step at
  // today that no reading justifies.
  projection[0] = { date: anchor.date, value: round(now) };

  // ——— 3. the cone ——————————————————————————————————————————————
  const residualSd = residualSpread(trend.daily ?? [], rolling, startDay, endDay);
  const cone: ConePoint[] = projection.map((p) => {
    const k = dayNumber(p.date) - endDay;
    const half = residualSd * Math.sqrt(k / 7);
    return {
      date: p.date,
      lower: round(clamp(p.value - half)),
      upper: round(clamp(p.value + half)),
    };
  });

  // ——— 4. the confidence ————————————————————————————————————————
  const scale = Math.abs(mean(ys));
  const coverage = Math.min(1, history.length / windowDays);
  const steadiness = scale > 0 ? Math.max(0, 1 - residualSd / scale) : residualSd === 0 ? 1 : 0;
  const confidence = Math.round(100 * (0.45 * coverage + 0.35 * steadiness + 0.2 * r2));

  return {
    value: {
      history,
      projection,
      cone,
      now: round(now),
      then: round(projection.at(-1)!.value),
      slopePerMonth: round(slope * 30),
      confidence: Math.max(0, Math.min(100, confidence)),
      residualSd: round(residualSd),
      horizonDays,
    },
    sufficiency: history.length >= windowDays ? 'ok' : 'partial',
    // Stamped on the last DAY THAT HAS DATA, never on the clock: a forecast
    // drawn off a feed that died a fortnight ago must date itself to the feed.
    asOf: anchor.date,
    sampleSize: history.length,
  };
}

// ——— helpers ————————————————————————————————————————————————————

function insufficient(
  zero: ForecastResult,
  sampleSize: number,
  asOf: string | null,
): MetricResult<ForecastResult> {
  return {
    value: zero,
    sufficiency: 'insufficient',
    asOf: asOf ?? new Date().toISOString().slice(0, 10),
    sampleSize,
  };
}

/**
 * Spread of the daily series about its own rolling mean, inside the window.
 *
 * This is the number the cone is made of, and it is deliberately NOT the
 * regression's residual: what a reader wants to know is how far a single day
 * strays from the trend they are being shown, which is a property of the signal
 * rather than of the fit.
 */
function residualSpread(
  daily: DayPoint[],
  rolling: DayPoint[],
  startDay: number,
  endDay: number,
): number {
  const smooth = new Map(rolling.map((p) => [p.date, p.value]));
  const residuals: number[] = [];
  for (const p of daily) {
    const d = dayNumber(p.date);
    if (d < startDay || d > endDay) continue;
    const s = smooth.get(p.date);
    if (s == null) continue;
    residuals.push(p.value - s);
  }
  if (residuals.length < 2) return 0;
  const m = mean(residuals);
  return Math.sqrt(residuals.reduce((a, b) => a + (b - m) ** 2, 0) / residuals.length);
}

function leastSquares(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;

  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (ys[i] - my) ** 2;
    ssRes += (ys[i] - (intercept + slope * xs[i])) ** 2;
  }
  // A flat series has no variance to explain. Calling that r2 = 0 would punish
  // the steadiest line on the page, so a perfect flat fit reads as 1.
  const r2 = ssTot === 0 ? 1 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));
  return { slope, intercept, r2 };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function dayNumber(date: string): number {
  return Math.floor(Date.parse(date + 'T00:00:00Z') / 86_400_000);
}

function isoDay(dayNum: number): string {
  return new Date(dayNum * 86_400_000).toISOString().slice(0, 10);
}
