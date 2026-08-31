// src/lib/daydream/features/normalise.ts
//
// One place that knows how every number is actually stored.
//
// This file exists because the storage conventions in this database are not
// uniform, are not documented in one place, and in one case are not even
// self-consistent. Every one of the rules below was established empirically
// against production rather than read off a column type — the column types
// disagree with the data in at least one case, which is exactly why the
// checking had to be empirical.
//
//   apple_health_metrics   every value is an integer scaled x100. The schema
//                          says so ("* 100 for decimals") and the data agrees:
//                          heart_rate spans 3600..18900 for 36..189 bpm.
//
//   whoop_recovery         recovery_score, resting_heart_rate and hrv_rmssd are
//                          honest doubles. NOT scaled. Mixing these with Apple
//                          values without this table is a 100x error.
//
//   whoop_sleep            durations are MILLISECONDS despite names like
//                          `total_in_bed` that read as seconds. 36,858,008 is
//                          10.2 hours, not 426 days.
//
//   whoop_cycles.strain    stored BOTH ways. 174 rows hold a raw 0..21 value
//                          and 71 hold the same thing scaled x100, and their
//                          date ranges OVERLAP (raw runs Dec 2025 to Aug 2026,
//                          scaled runs Apr 2026 to Aug 2026) — so this is two
//                          writers disagreeing, not a clean migration. There is
//                          no date that separates them and no flag on the row.
//
// The strain rule is therefore a value test, and it is safe only because of a
// wide empty gap: strain is capped at 21 by definition, the largest raw value
// on record is 18.05, and the smallest scaled one is 145. A single genuine
// value between 21 and 145 would be unclassifiable — which cannot occur while
// the cap holds, and `isAmbiguousStrain` exists so a caller can assert that
// rather than assume it.
//
// PURE. No database, no clock, no imports. Every rule here is a pinned test.

/** Apple Health stores every metric as an integer scaled by this. */
export const APPLE_SCALE = 100;

/** Strain's definitional ceiling. A value above it cannot be unscaled. */
export const STRAIN_MAX = 21;

/**
 * The top of the empty gap between the two strain conventions.
 *
 * Deliberately above STRAIN_MAX rather than equal to it: a value of exactly 21
 * is a legitimate raw maximum, and dividing it would silently produce 0.21.
 */
export const STRAIN_RAW_CEILING = 22;

/** Apple's x100 integer to the real quantity. Null in, null out. */
export function appleValue(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  return raw / APPLE_SCALE;
}

/**
 * Strain, whichever way this particular row happened to be written.
 *
 * A value test rather than a date test, because the two writers overlap in time
 * and nothing on the row says which produced it.
 */
export function strainValue(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  if (raw < 0) return null;
  return raw > STRAIN_RAW_CEILING ? raw / APPLE_SCALE : raw;
}

/**
 * Could this strain reading be read two ways?
 *
 * Always false while the 0..21 cap holds, and the point of asking is to find
 * out the moment it stops holding. A caller that starts seeing these is looking
 * at data the value test cannot classify, and should treat it as missing rather
 * than guess — a wrong guess here is a 100x error in a correlation.
 */
export function isAmbiguousStrain(raw: number | null | undefined): boolean {
  if (raw == null || !Number.isFinite(raw)) return false;
  return raw > STRAIN_MAX && raw <= STRAIN_RAW_CEILING;
}

/** Whoop's millisecond durations to minutes. */
export function msToMinutes(ms: number | null | undefined): number | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  return ms / 60_000;
}

/** Seconds to minutes, for the activities table, which is honest SI. */
export function secondsToMinutes(s: number | null | undefined): number | null {
  if (s == null || !Number.isFinite(s) || s < 0) return null;
  return s / 60;
}

/**
 * How a metric collapses to one number for one day.
 *
 * Named rather than assumed, because getting this wrong is the other documented
 * way these numbers go bad: steps must be SUMMED across the day's samples,
 * heart rate must be AVERAGED, and strain is one figure per cycle of which the
 * day takes the MAX. Summing heart rate produces a five-figure pulse; averaging
 * steps produces a step count of ninety.
 */
export type Aggregation = 'sum' | 'mean' | 'max' | 'min' | 'last';

export function aggregate(values: number[], how: Aggregation): number | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length === 0) return null;
  switch (how) {
    case 'sum':
      return xs.reduce((a, b) => a + b, 0);
    case 'mean':
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    case 'max':
      return Math.max(...xs);
    case 'min':
      return Math.min(...xs);
    case 'last':
      return xs[xs.length - 1];
  }
}

/** The aggregation each Apple metric takes. Anything absent is not collected. */
export const APPLE_AGGREGATION: Record<string, Aggregation> = {
  step_count: 'sum',
  active_energy: 'sum',
  walking_running_distance: 'sum',
  flights_climbed: 'sum',
  heart_rate: 'mean',
  heart_rate_variability: 'mean',
  resting_heart_rate: 'mean',
  respiratory_rate: 'mean',
  vo2_max: 'last',
};

/**
 * Plausibility bounds, applied AFTER normalisation.
 *
 * Not a cleanup pass — a tripwire. If a normalised value lands outside these,
 * the assumption above is wrong for that row and the honest response is to
 * record nothing rather than to feed a 100x error into a correlation and let it
 * come back as a confident finding. Silence is recoverable; a fabricated
 * relationship presented as a discovery is not.
 */
export const PLAUSIBLE: Record<string, { lo: number; hi: number }> = {
  steps: { lo: 0, hi: 100_000 },
  restingHeartRate: { lo: 25, hi: 120 },
  meanHeartRate: { lo: 30, hi: 200 },
  hrvMs: { lo: 5, hi: 300 },
  strain: { lo: 0, hi: STRAIN_MAX },
  recoveryScore: { lo: 0, hi: 100 },
  sleepMinutes: { lo: 0, hi: 1000 },
  sleepPerformance: { lo: 0, hi: 100 },
  activeMinutes: { lo: 0, hi: 1440 },
};

/** Keep the value, or drop it as impossible. */
export function plausible(key: string, value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const bounds = PLAUSIBLE[key];
  if (!bounds) return value;
  return value >= bounds.lo && value <= bounds.hi ? value : null;
}
