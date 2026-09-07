// Today's number, and the history behind it, for every figure the registry
// describes.
//
// `metric-registry.ts` says what a metric IS and never holds a value. This is
// the other half: it takes the payload the loader already built and pulls out,
// for each metric id, the reading and the series behind it. Together they are
// what a hover card and a drill need, and neither component then has to know
// where in a nine-section payload `dashboard.efficiency.bkm.rolling7` lives.
//
// Why a separate pure module rather than a `$derived` in the dashboard: this is
// where the honesty lives, and honesty wants tests.
//
//  * `readable` IS `MetricResult.sufficiency !== 'insufficient'` — never
//    "is the number non-zero". Every analytic returns a fully populated ZERO
//    struct when it has not got the sample, so `ratio: 0` and `band: 'low'`
//    come back looking exactly like a measurement. A card that reads the value
//    without the flag prints "detraining" over nothing at all.
//
//  * A `HealthDay` carries NO nulls — 0 is its missing sentinel — so a series
//    built from one is filtered to positive values before it is a series.
//    Otherwise a fortnight with no sync draws a cliff to zero and then a climb
//    back, which is a shape, and shapes get read.
//
//  * FIVE OF THOSE FIELDS ARE ALREADY CARRY-FORWARD BACKFILLED upstream.
//    `series-30d-service` copies the prior day into any zero `rec`, `hrv`,
//    `rhr`, `slept` or `strain`, so a flat run in one of those series may be a
//    day nothing synced rather than a day nothing changed. The 26px sparkline
//    on the tile could get away with not saying so; a 600px trace with dates
//    on it, which is what the drill draws, cannot. `CARRIED_FORWARD` marks
//    them and the series label says it out loud. `steps` and `weight` are NOT
//    backfilled, which is why the zero filter above still has work to do.
//
//  * A series of one is not a series. Anything under two real points comes back
//    empty so the drill draws its empty state instead of a line between a point
//    and itself.
import type { HealthDay } from './series-30d-service';
import type { MetricResult } from './analytics/types';
import type { DayPoint } from './analytics/rolling';

/** The minimum a line may be drawn from. Under this, the drill says so. */
export const MIN_SERIES_POINTS = 2;

export interface MetricReading {
  id: string;
  /** Today's value, or null when the metric has no readable one. */
  value: number | null;
  /** The analytic's own sufficiency verdict. Never inferred from the value. */
  readable: boolean;
  /** What the metric needs before its band means anything, when it has not got it. */
  needs: string | null;
  /** The history, oldest first. Empty when there is not enough to draw. */
  series: DayPoint[];
  /** What the series is — "30 days", "7-day mean", "last 12 weeks". */
  seriesLabel: string;
  /** The baseline the value should be read against, when one exists. */
  baseline: number | null;
  baselineLabel: string | null;
}

type Result<T> = MetricResult<T> | null | undefined;

function readable<T>(r: Result<T>): r is MetricResult<T> {
  return !!r && r.sufficiency !== 'insufficient';
}

/** A `MetricResult`'s value through a projection, or null when unreadable. */
function valueOf<T>(r: Result<T>, pick: (v: T) => number | null): number | null {
  if (!readable(r)) return null;
  const v = pick(r.value);
  return v != null && Number.isFinite(v) ? v : null;
}

/** Series of one is not a series — see the module comment. */
function series(points: DayPoint[] | null | undefined): DayPoint[] {
  const kept = (points ?? []).filter((p) => p && Number.isFinite(p.value));
  return kept.length >= MIN_SERIES_POINTS ? kept : [];
}

/**
 * The `HealthDay` fields `series-30d-service` carry-forward backfills, and the
 * suffix that says so wherever one of them is plotted.
 */
const CARRIED_SUFFIX = ' · gaps carried forward';

/** A `HealthDay` field as a series, with 0 treated as the absence it is. */
function fromDays(days: readonly HealthDay[], pick: (d: HealthDay) => number): DayPoint[] {
  return series(
    days
      .map((d) => ({ date: d.date, value: pick(d) }))
      .filter((p) => Number.isFinite(p.value) && p.value > 0),
  );
}

/** Shape of the slice of the loader's payload this module reads. */
export interface ReadingsInput {
  series: readonly HealthDay[];
  today: HealthDay | null;
  rhrBaseline: number;
  readiness: { score: number } | null;
  volume: { weekKm: number; medianKm: number } | null;
  acwr: Result<{ ratio: number }>;
  monotony: Result<{ monotony: number }>;
  polarised: Result<{ easyPct: number }>;
  sleepRegularity: Result<number>;
  circadian: Result<{ driftHours: number }>;
  autonomic: Result<{ score: number }>;
  /**
   * `RecoveryDebtResult.series` is `{ date, balanceMin }` — NOT a `DayPoint`.
   * Typed structurally here and got wrong: the drill would have plotted
   * `undefined` for every night. Spelled out so the compiler checks it.
   */
  recoveryDebt: Result<{ averageBalanceMin: number; series?: Array<{ date: string; balanceMin: number }> }>;
  vo2max: Result<{ current: number }>;
  dashboard: {
    vo2?: { series?: DayPoint[] } | null;
    hrv?: { daily?: DayPoint[]; rolling7?: DayPoint[]; baseline28?: number | null } | null;
    /** Apple SDNN daily medians — a DIFFERENT statistic from the Whoop RMSSD. */
    hrvSdnn?: { daily?: DayPoint[]; latest7?: number | null; baseline28?: number | null } | null;
    rhr?: { daily?: DayPoint[]; baseline28?: number | null } | null;
    recovery?: DayPoint[] | null;
    /** `WeekVolume` — metres, not kilometres, and there is no `km` on it. */
    weeks?: Array<{ weekStart: string; totalDistanceM: number }> | null;
    load?: { days?: Array<{ date: string; load: number }> | null } | null;
    efficiency?: { bkm?: { rolling7?: DayPoint[]; latest7?: number | null; baseline28?: number | null } | null } | null;
  } | null;
}

/**
 * Everything the hover card and the drill need, keyed by the registry's ids.
 *
 * Metrics the payload cannot answer for are still PRESENT, with `readable:
 * false` and a `needs` line — an absent key would make the card fall back to
 * "unknown metric", which reads as a bug rather than as an honest gap.
 */
export function buildReadings(input: ReadingsInput): Record<string, MetricReading> {
  const days = input.series ?? [];
  const d = input.dashboard ?? null;
  const out: Record<string, MetricReading> = {};

  const add = (r: MetricReading) => {
    out[r.id] = r;
  };
  const blank = (id: string, needs: string): MetricReading => ({
    id,
    value: null,
    readable: false,
    needs,
    series: [],
    seriesLabel: '',
    baseline: null,
    baselineLabel: null,
  });

  // ——— A · state of play ————————————————————————————————————————
  add({
    ...blank('readiness', 'Needs a scored morning.'),
    value: input.readiness ? Math.round(input.readiness.score) : null,
    readable: input.readiness != null,
    needs: input.readiness ? null : 'Readiness has not scored yet.',
  });

  add({
    ...blank('recovery', 'Needs a Whoop recovery score.'),
    value: input.today && input.today.rec > 0 ? input.today.rec : null,
    readable: !!input.today && input.today.rec > 0,
    needs: input.today && input.today.rec > 0 ? null : 'No recovery score has synced.',
    series: fromDays(days, (x) => x.rec),
    seriesLabel: `Last 30 days${CARRIED_SUFFIX}`,
  });

  const hrvSeries = fromDays(days, (x) => x.hrv);
  add({
    ...blank('hrv', 'Needs a night of scored sleep.'),
    value: input.today && input.today.hrv > 0 ? input.today.hrv : null,
    readable: !!input.today && input.today.hrv > 0,
    needs: input.today && input.today.hrv > 0 ? null : 'No HRV reading has synced.',
    series: hrvSeries.length ? hrvSeries : series(d?.hrv?.daily),
    seriesLabel: `Last 30 days${hrvSeries.length ? CARRIED_SUFFIX : ''}`,
    baseline: d?.hrv?.baseline28 ?? null,
    baselineLabel: d?.hrv?.baseline28 != null ? '28-day mean' : null,
  });

  const rhrSeries = fromDays(days, (x) => x.rhr);
  add({
    ...blank('rhr', 'Needs a night of scored sleep.'),
    value: input.today && input.today.rhr > 0 ? input.today.rhr : null,
    readable: !!input.today && input.today.rhr > 0,
    needs: input.today && input.today.rhr > 0 ? null : 'No resting heart rate has synced.',
    series: rhrSeries.length ? rhrSeries : series(d?.rhr?.daily),
    seriesLabel: `Last 30 days${rhrSeries.length ? CARRIED_SUFFIX : ''}`,
    baseline: input.rhrBaseline > 0 ? input.rhrBaseline : (d?.rhr?.baseline28 ?? null),
    baselineLabel: 'own baseline',
  });

  const sleptSeries = fromDays(days, (x) => x.slept);
  const sleptMean = sleptSeries.length
    ? sleptSeries.reduce((a, p) => a + p.value, 0) / sleptSeries.length
    : null;
  add({
    ...blank('sleep', 'Needs a scored sleep.'),
    value: input.today && input.today.slept > 0 ? input.today.slept : null,
    readable: !!input.today && input.today.slept > 0,
    needs: input.today && input.today.slept > 0 ? null : 'No sleep has been recorded.',
    series: sleptSeries,
    seriesLabel: `Last 30 days${CARRIED_SUFFIX}`,
    baseline: sleptMean,
    baselineLabel: sleptMean != null ? '30-day mean' : null,
  });

  // Metres on the wire, kilometres on the page — `WeekVolume.totalDistanceM`
  // is the field, and the tile above it prints km.
  const weeks = (d?.weeks ?? []).map((w) => ({
    date: w.weekStart,
    value: w.totalDistanceM / 1000,
  }));
  add({
    ...blank('volume', 'Needs a completed week with distance on it.'),
    value: input.volume?.weekKm ?? null,
    readable: input.volume != null,
    needs: input.volume ? null : 'No completed week yet.',
    series: series(weeks),
    seriesLabel: 'Last 12 weeks',
    baseline: input.volume?.medianKm ?? null,
    baselineLabel: input.volume ? '12-week median' : null,
  });

  add({
    ...blank('vo2max', 'Needs 90 days of estimates.'),
    value: valueOf(input.vo2max, (v) => v.current),
    readable: readable(input.vo2max),
    needs: readable(input.vo2max) ? null : 'Needs 90 days of estimates.',
    series: series(d?.vo2?.series),
    seriesLabel: '90-day estimates',
  });

  // ——— B · the instrument deck ——————————————————————————————————
  add({
    ...blank('acwr', 'Needs 28 days of load.'),
    value: valueOf(input.acwr, (v) => v.ratio),
    readable: readable(input.acwr),
    needs: readable(input.acwr) ? null : 'Needs 28 days of load.',
    // The daily load series, which is what the ACWR is computed FROM. The ratio
    // series itself is section C's business; here the reader wants to see the
    // training that produced the number.
    series: series((d?.load?.days ?? []).map((x) => ({ date: x.date, value: x.load }))),
    seriesLabel: 'Daily load, last 28 days',
  });

  add({
    ...blank('monotony', 'Needs seven days of load.'),
    value: valueOf(input.monotony, (v) => v.monotony),
    readable: readable(input.monotony),
    needs: readable(input.monotony) ? null : 'Needs seven days of load.',
    series: series((d?.load?.days ?? []).slice(-7).map((x) => ({ date: x.date, value: x.load }))),
    seriesLabel: 'Daily load, last 7 days',
  });

  add({
    ...blank('polarised', 'Needs a month of heart-rate-carrying workouts.'),
    value: valueOf(input.polarised, (v) => v.easyPct),
    readable: readable(input.polarised),
    needs: readable(input.polarised) ? null : 'Needs a month of heart-rate-carrying workouts.',
  });

  add({
    ...blank('sri', 'Needs thirty nights of recorded sleep.'),
    value: valueOf(input.sleepRegularity, (v) => v),
    readable: readable(input.sleepRegularity),
    needs: readable(input.sleepRegularity) ? null : 'Needs thirty nights of recorded sleep.',
  });

  add({
    ...blank('circadian', 'Needs a fortnight of sleep intervals.'),
    value: valueOf(input.circadian, (v) => v.driftHours),
    readable: readable(input.circadian),
    needs: readable(input.circadian) ? null : 'Needs a fortnight of sleep intervals.',
  });

  add({
    ...blank('autonomic', 'Needs a fortnight of paired HRV and resting-HR mornings.'),
    value: valueOf(input.autonomic, (v) => v.score),
    readable: readable(input.autonomic),
    needs: readable(input.autonomic)
      ? null
      : 'Needs a fortnight of paired HRV and resting-HR mornings.',
  });

  add({
    ...blank('balance', 'Needs seven complete nights of scored sleep.'),
    value: valueOf(input.recoveryDebt, (v) => v.averageBalanceMin),
    readable: readable(input.recoveryDebt),
    needs: readable(input.recoveryDebt) ? null : 'Needs seven complete nights of scored sleep.',
    series: readable(input.recoveryDebt)
      ? series((input.recoveryDebt.value.series ?? []).map((n) => ({ date: n.date, value: n.balanceMin })))
      : [],
    seriesLabel: 'Nightly balance',
  });

  // ——— the four that were measured and drawn nowhere ————————————
  const sdnn = d?.hrvSdnn ?? null;
  add({
    ...blank('hrv-sdnn', 'Needs Apple Health HRV samples.'),
    value: sdnn?.latest7 ?? null,
    readable: sdnn?.latest7 != null,
    needs: sdnn?.latest7 != null ? null : 'No Apple HRV has synced.',
    series: series(sdnn?.daily),
    seriesLabel: 'Daily medians',
    baseline: sdnn?.baseline28 ?? null,
    baselineLabel: sdnn?.baseline28 != null ? '28-day mean' : null,
  });

  // `HealthDay.strain` is already normalised through `realStrain()` in
  // series-30d-service — the column held two scales at once for four months
  // and the reader-side fix lives there, not here.
  const strainSeries = fromDays(days, (x) => x.strain);
  add({
    ...blank('strain', 'Needs a scored day.'),
    value: input.today && input.today.strain > 0 ? input.today.strain : null,
    readable: !!input.today && input.today.strain > 0,
    needs: input.today && input.today.strain > 0 ? null : 'No strain score has synced.',
    series: strainSeries,
    seriesLabel: `Last 30 days${CARRIED_SUFFIX}`,
  });

  const stepSeries = fromDays(days, (x) => x.steps);
  const stepMean = stepSeries.length
    ? stepSeries.reduce((a, p) => a + p.value, 0) / stepSeries.length
    : null;
  add({
    ...blank('steps', 'Needs Apple Health step counts.'),
    value: input.today && input.today.steps > 0 ? input.today.steps : null,
    readable: !!input.today && input.today.steps > 0,
    needs: input.today && input.today.steps > 0 ? null : 'No step count has synced.',
    series: stepSeries,
    seriesLabel: 'Last 30 days',
    baseline: stepMean,
    baselineLabel: stepMean != null ? '30-day mean' : null,
  });

  const weightSeries = fromDays(days, (x) => x.weight);
  const weightMean = weightSeries.length
    ? weightSeries.reduce((a, p) => a + p.value, 0) / weightSeries.length
    : null;
  add({
    ...blank('weight', 'Needs a weight reading.'),
    value: input.today && input.today.weight > 0 ? input.today.weight : null,
    readable: !!input.today && input.today.weight > 0,
    needs: input.today && input.today.weight > 0 ? null : 'No weight has synced.',
    series: weightSeries,
    seriesLabel: 'Last 30 days',
    baseline: weightMean,
    baselineLabel: weightMean != null ? '30-day mean' : null,
  });

  const bkm = d?.efficiency?.bkm ?? null;
  add({
    ...blank('efficiency', 'Needs four weeks of pace-sport outings carrying heart rate.'),
    value: bkm?.latest7 ?? null,
    readable: bkm?.latest7 != null,
    needs: bkm?.latest7 != null ? null : 'Needs four weeks of pace-sport outings carrying heart rate.',
    series: series(bkm?.rolling7),
    seriesLabel: '7-day mean',
    baseline: bkm?.baseline28 ?? null,
    baselineLabel: bkm?.baseline28 != null ? '28-day baseline' : null,
  });

  return out;
}
