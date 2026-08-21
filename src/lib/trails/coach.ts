// What to do today, and which piece of ground to do it on.
//
// Two pure decisions live here, both deliberately away from the database so
// they can be argued with in a test rather than in production:
//
//   applyProgression()      the base proposal, bent by what the body is
//                           actually carrying — load, sameness, intensity mix
//   rankGettableSegments()  which of your own records is realistically
//                           beatable TODAY, and what time to aim for
//
// THE ZERO-STRUCT TRAP. Every analytic in $lib/health/analytics returns a
// `MetricResult<T>` whose `value` is NEVER null. An `insufficient` result
// carries a fully-populated ZERO struct: `computeACWR` hands back
// `{ ratio: 0, zone: 'detraining' }` and `computeMonotony` hands back
// `{ monotony: 0, band: 'low' }`. Read either without checking `sufficiency`
// first and the coach confidently prescribes a build week off no data at all.
// Every threshold in this file checks sufficiency BEFORE it looks at a number.

import { ACTIVITY_TYPES, type ActivityTypeName } from './activity-meta';
import { isPaceSport } from './format';
import type { ACWRResult } from '$lib/health/analytics/acwr';
import type { MonotonyResult } from '$lib/health/analytics/monotony';
import type { PolarisedResult } from '$lib/health/analytics/polarised';
import type { MetricResult } from '$lib/health/analytics/types';

// ---------------------------------------------------------------------------
// Shapes

/**
 * The sport the coach may suggest.
 *
 * Deliberately the full eight of `ACTIVITY_TYPES`, not the six of
 * `ORS_PROFILES`. `proposeSession()` returns a `PlannerSport` because its job
 * ends at "what can be routed" — a fortnight of nothing but swimming still
 * yields `'run'` from it. The brief here is an activity TYPE, so a swim has to
 * be sayable; whether it can also be drawn on a map is a separate question the
 * shell answers, and the honest answer is sometimes no.
 */
export type CoachSport = ActivityTypeName;

export type Intensity = 'recovery' | 'easy' | 'steady' | 'threshold' | 'intervals';

export const INTENSITIES: readonly Intensity[] = [
  'recovery',
  'easy',
  'steady',
  'threshold',
  'intervals',
] as const;

export const INTENSITY_LABELS: Record<Intensity, string> = {
  recovery: 'Recovery',
  easy: 'Easy',
  steady: 'Steady',
  threshold: 'Threshold',
  intervals: 'Intervals',
};

/** Counts of each activity type over a window, keyed by effective type. */
export type SportCounts = Record<string, number>;

export interface TrainingState {
  /**
   * ACWR as EWMA over daily TRIMP — `getTrailsDashboard().load.trimpAcwr`.
   * Null when the dashboard could not be read at all; an insufficient result
   * is passed through as-is and guarded here.
   */
  acwr: MetricResult<ACWRResult> | null;
  monotony: MetricResult<MonotonyResult> | null;
  polarised: MetricResult<PolarisedResult> | null;
  /** How hard yesterday was, where it can be told. Null when it cannot. */
  yesterdayIntensity: Intensity | null;
  /** Outings per effective type over the last 8 weeks, and the last 2. */
  last8Weeks: SportCounts;
  last2Weeks: SportCounts;
}

export interface BaseProposal {
  sport: CoachSport;
  targetDistanceM: number;
}

export interface Progression {
  sport: CoachSport;
  intensity: Intensity;
  targetDistanceM: number;
  /** Estimated moving time for this sport at this intensity and distance. */
  targetMinutes: number;
  /** One plain-English line per rule that fired, in the order they fired. */
  why: string[];
  /**
   * WHICH acwr. Four implementations of this ratio disagree in this repo —
   * EWMA against sum-of-7, a 0.5 detraining boundary against 0.6 — and the
   * card has to say which one it acted on or the number is unfalsifiable.
   */
  acwrSource: string;
}

// ---------------------------------------------------------------------------
// Sufficiency guards
//
// One helper each, so no threshold in this file can accidentally read a zero
// struct. `suff()` is the whole trap in one line.

function suff<T>(m: MetricResult<T> | null | undefined): m is MetricResult<T> {
  return !!m && m.sufficiency !== 'insufficient';
}

/**
 * A usable ACWR ratio, or null.
 *
 * `ratio: 0` is what an insufficient result carries AND what a genuine
 * zero-chronic-load computes to, so both are refused: a ratio of exactly zero
 * is never a signal to act on.
 */
export function usableAcwr(m: MetricResult<ACWRResult> | null | undefined): number | null {
  if (!suff(m)) return null;
  const ratio = m.value?.ratio;
  return typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

/**
 * A usable monotony band, or null.
 *
 * `getMonotony()` can NEVER report `insufficient` — the service zero-fills
 * seven calendar days before calling `computeMonotony`, so the length check
 * inside it always passes and a week with no Whoop data at all comes back
 * `{ mean: 0, sd: 0, monotony: 100, band: 'high' }`. That is the maximum
 * possible sameness reported off no data, which would force an intensity
 * change every single day. The gate the /health page already uses is
 * `sufficiency !== 'insufficient' && mean > 0 && sd > 0`; it is replicated
 * here rather than trusted from over there.
 */
export function usableMonotony(
  m: MetricResult<MonotonyResult> | null | undefined,
): MonotonyResult | null {
  if (!suff(m)) return null;
  const v = m.value;
  if (!v || !(v.mean > 0) || !(v.sd > 0)) return null;
  return v;
}

export function usablePolarised(
  m: MetricResult<PolarisedResult> | null | undefined,
): PolarisedResult | null {
  if (!suff(m)) return null;
  const v = m.value;
  if (!v || v.verdict === 'insufficient-volume' || !(v.totalMinutes > 0)) return null;
  return v;
}

// ---------------------------------------------------------------------------
// Progression

/** ACWR above this is more load than the base can absorb. */
export const ACWR_OVERREACHED = 1.4;
/** ACWR below this is room to grow into. */
export const ACWR_UNDERLOADED = 0.8;
/** Share of Z3 above which the week is middle-heavy — the grey-zone rut. */
export const MID_HEAVY_PCT = 40;
/** Outings in the last 8 weeks that make a sport "real history" rather than a one-off. */
export const SPORT_HISTORY_MIN = 2;

/** What the coach falls back to when there is no history for a sport. */
export const DEFAULT_DISTANCE_M: Record<CoachSport, number> = {
  run: 8000,
  trail_run: 10_000,
  walk: 6000,
  hike: 12_000,
  ride: 30_000,
  mtb: 20_000,
  swim: 1500,
  other: 6000,
};

/**
 * Moving speed in km/h per sport at STEADY.
 *
 * Its own table rather than `field/nav`'s: that one covers the six routable
 * sports and silently falls back to walking pace for anything else, which
 * would price a 1.5 km swim at eighteen minutes.
 */
const STEADY_KMH: Record<CoachSport, number> = {
  run: 10,
  trail_run: 8.5,
  walk: 5,
  hike: 4.5,
  ride: 22,
  mtb: 14,
  swim: 3,
  other: 6,
};

/** Speed against STEADY. Intervals cover less ground per minute than threshold
 *  because the recoveries are part of the session. */
const INTENSITY_SPEED: Record<Intensity, number> = {
  recovery: 0.82,
  easy: 0.9,
  steady: 1,
  threshold: 1.1,
  intervals: 0.95,
};

/** How far a recovery day is allowed to be, against the base proposal. */
const RECOVERY_DISTANCE_FACTOR = 0.6;
/** And an absolute ceiling, so a recovery run off a marathon block is still short. */
const RECOVERY_CAP_M: Record<CoachSport, number> = {
  run: 6000,
  trail_run: 6000,
  walk: 6000,
  hike: 8000,
  ride: 20_000,
  mtb: 14_000,
  swim: 1200,
  other: 5000,
};

export function estimateMinutes(
  distanceM: number,
  sport: CoachSport,
  intensity: Intensity,
): number {
  if (!(distanceM > 0)) return 0;
  const kmh = (STEADY_KMH[sport] ?? STEADY_KMH.other) * INTENSITY_SPEED[intensity];
  return Math.round((distanceM / 1000 / kmh) * 60);
}

function isCoachSport(s: string): s is CoachSport {
  return (ACTIVITY_TYPES as readonly string[]).includes(s);
}

/** An intensity that is not yesterday's, staying as close to the intent as possible. */
function differentFrom(wanted: Intensity, yesterday: Intensity): Intensity {
  if (wanted !== yesterday) return wanted;
  // Step away from yesterday along the ladder, preferring the easier side —
  // "do something different" is not licence to stack two hard days.
  const i = INTENSITIES.indexOf(yesterday);
  if (i > 0) return INTENSITIES[i - 1];
  return INTENSITIES[i + 1];
}

/**
 * The base proposal, bent by the training state.
 *
 * Rules fire in a fixed precedence and each one that fires explains itself.
 * Rule 1 LOCKS: once the load says recovery, nothing below it is allowed to
 * add intensity or distance back, because every rule under it is an argument
 * for doing more and the whole point of the first is that there is no room.
 */
export function applyProgression(base: BaseProposal, state: TrainingState): Progression {
  const why: string[] = [];
  let sport: CoachSport = isCoachSport(base.sport) ? base.sport : 'run';
  let targetDistanceM = Math.max(0, Math.round(base.targetDistanceM || DEFAULT_DISTANCE_M[sport]));
  let intensity: Intensity = 'steady';
  let locked = false;

  const acwrSource =
    'EWMA acute:chronic over daily TRIMP (physio-service load.trimpAcwr, 7d/28d half-lives)';

  // --- 1. Too much load already ------------------------------------------
  const ratio = usableAcwr(state.acwr);
  if (ratio != null && ratio > ACWR_OVERREACHED) {
    intensity = 'recovery';
    locked = true;
    const capped = Math.min(
      Math.round(targetDistanceM * RECOVERY_DISTANCE_FACTOR),
      RECOVERY_CAP_M[sport],
    );
    why.push(
      `Acute load is ${ratio.toFixed(2)}× the chronic base — over the ${ACWR_OVERREACHED} line, so today is recovery and the distance is cut to ${(capped / 1000).toFixed(1)} km.`,
    );
    targetDistanceM = capped;
  } else if (ratio != null && ratio < ACWR_UNDERLOADED) {
    // --- 2. Room to build ------------------------------------------------
    intensity = 'steady';
    targetDistanceM = Math.round(targetDistanceM * 1.1);
    why.push(
      `Acute load is only ${ratio.toFixed(2)}× the base — there is room to build, so the target is 10% longer than usual.`,
    );
  } else if (ratio == null) {
    why.push(
      'Not enough load history to read an acute:chronic ratio yet, so the session is proposed off recent habit alone.',
    );
  }

  // --- 3. Same thing every day -------------------------------------------
  const monotony = usableMonotony(state.monotony);
  if (monotony?.band === 'high') {
    if (locked) {
      why.push(
        `The last seven days have been unusually samey (monotony ${monotony.monotony.toFixed(1)}), but the load ratio decides today — recovery stands.`,
      );
    } else if (state.yesterdayIntensity) {
      const changed = differentFrom(intensity, state.yesterdayIntensity);
      if (changed !== intensity) {
        why.push(
          `The last seven days have been unusually samey (monotony ${monotony.monotony.toFixed(1)}) and yesterday was ${INTENSITY_LABELS[state.yesterdayIntensity].toLowerCase()} — making today ${INTENSITY_LABELS[changed].toLowerCase()} instead.`,
        );
        intensity = changed;
      } else {
        why.push(
          `The last seven days have been unusually samey (monotony ${monotony.monotony.toFixed(1)}) — today is ${INTENSITY_LABELS[intensity].toLowerCase()}, which yesterday was not.`,
        );
      }
    } else {
      why.push(
        `The last seven days have been unusually samey (monotony ${monotony.monotony.toFixed(1)}) — vary the effort today.`,
      );
    }
  }

  // --- 4. Stuck in the middle --------------------------------------------
  const polarised = usablePolarised(state.polarised);
  if (polarised && polarised.midPct > MID_HEAVY_PCT) {
    if (locked) {
      why.push(
        `${Math.round(polarised.midPct)}% of the last week was spent in the middle zone, but the load ratio comes first — take the easy day and polarise tomorrow.`,
      );
    } else {
      // Off the fence in whichever direction the body can afford. A high-but-
      // legal ratio buys volume, not intensity.
      const goEasy = ratio != null && ratio >= 1.1;
      intensity = goEasy ? 'easy' : 'intervals';
      if (goEasy) targetDistanceM = Math.round(targetDistanceM * 1.15);
      why.push(
        `${Math.round(polarised.midPct)}% of the last week sat in the middle zone — ${
          goEasy
            ? 'go properly easy and longer today rather than adding another moderate hour'
            : 'make today properly hard rather than another moderate hour'
        }.`,
      );
    }
  }

  // --- 5. The sport you have quietly dropped ------------------------------
  const neglected = neglectedSport(state, sport);
  if (neglected && !locked) {
    const scale = DEFAULT_DISTANCE_M[neglected] / DEFAULT_DISTANCE_M[sport];
    targetDistanceM = Math.round(targetDistanceM * scale);
    why.push(
      `${label(neglected)} was a regular part of the last eight weeks (${state.last8Weeks[neglected]} outings) and has not happened in the last fortnight — today is a good day to put it back.`,
    );
    sport = neglected;
  } else if (neglected && locked) {
    why.push(
      `${label(neglected)} has dropped out of the last fortnight, but it can wait for a day with load to spare.`,
    );
  }

  return {
    sport,
    intensity,
    targetDistanceM,
    targetMinutes: estimateMinutes(targetDistanceM, sport, intensity),
    why,
    acwrSource,
  };
}

function label(sport: CoachSport): string {
  return sport === 'mtb' ? 'MTB' : sport.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * A sport with real history that has gone missing.
 *
 * "Real history" is deliberately more than one outing: a single trial ride
 * eight weeks ago is not a habit that lapsed, and nudging back toward it is
 * inventing a training history that never existed. The busiest neglected sport
 * wins, and the sport already proposed can never be its own nudge.
 */
export function neglectedSport(
  state: Pick<TrainingState, 'last8Weeks' | 'last2Weeks'>,
  proposed: CoachSport,
): CoachSport | null {
  let best: CoachSport | null = null;
  let bestCount = 0;
  for (const [type, count] of Object.entries(state.last8Weeks ?? {})) {
    if (!isCoachSport(type) || type === proposed || type === 'other') continue;
    if (count < SPORT_HISTORY_MIN) continue;
    if ((state.last2Weeks?.[type] ?? 0) > 0) continue;
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Gettable segments

export interface GettableCandidate {
  id: number;
  name: string;
  /** The sport the segment was cut from. Segments never mix types. */
  activityType: string;
  distanceM: number;
  /** All-time best duration over this ground, seconds. */
  pbDurationS: number | null;
  /** Best of the last three efforts, seconds. */
  recentBestS: number | null;
  effortCount: number;
  /** Days between the PB and the most recent effort. */
  daysSincePb: number | null;
  /**
   * Efficiency factor across the last five efforts, OLDEST FIRST, nulls kept
   * in place. Ignored entirely for non-pace sports — see `efTrendPct`.
   */
  recentEf?: Array<number | null>;
}

export interface GettableOptions {
  /** The session's target distance, for the fit term. */
  targetDistanceM: number;
  /** How many targets to return. */
  limit?: number;
  /** Minimum score to be worth naming at all. */
  minScore?: number;
}

export interface GettableTarget {
  id: number;
  name: string;
  activityType: string;
  distanceM: number;
  pbDurationS: number;
  recentBestS: number | null;
  /** Recent best against the PB, as a fraction of the PB. */
  gapPct: number | null;
  /** And in seconds, which is the number that actually motivates. */
  gapS: number | null;
  /** The time to go after today. */
  targetDurationS: number;
  effortCount: number;
  daysSincePb: number | null;
  /** Percent change in EF per effort across the last five. Pace sports only. */
  efTrendPct: number | null;
  score: number;
  components: {
    gap: number;
    trust: number;
    staleness: number;
    fit: number;
    form: number;
  };
  reason: string;
}

/** Below this an all-time best is one lucky day, not a standard. */
export const MIN_TRUSTED_EFFORTS = 4;

const WEIGHTS = { gap: 0.34, trust: 0.22, staleness: 0.18, fit: 0.16, form: 0.1 };

/**
 * Recent best against the PB.
 *
 * A SMALL non-zero gap is the sweet spot: you are demonstrably near it and
 * there is something to take. A gap of zero means the recent best IS the PB —
 * still worth going at, but there is no evidence of headroom. A huge gap means
 * either the PB was a fluke, or it was set in conditions today will not
 * reproduce, and chasing it is a wasted session.
 */
export function gapScore(gapPct: number | null): number {
  if (gapPct == null || !Number.isFinite(gapPct)) return 0;
  if (gapPct <= 0) return 0.4;
  if (gapPct <= 0.03) return 0.6 + (gapPct / 0.03) * 0.4;
  if (gapPct <= 0.06) return 1;
  return Math.max(0, 1 - (gapPct - 0.06) / 0.19);
}

/** How much the PB can be believed. Ten efforts is a standard; two is a rumour. */
export function trustScore(effortCount: number): number {
  if (!(effortCount > 1)) return 0;
  return Math.min(1, (effortCount - 1) / 9);
}

/** An old record is catchable; one set last week is the shape you are already in. */
export function stalenessScore(daysSincePb: number | null): number {
  if (daysSincePb == null || !Number.isFinite(daysSincePb)) return 0.3;
  if (daysSincePb <= 7) return 0;
  return Math.min(1, (daysSincePb - 7) / 173);
}

/** Segment length against the session. A 300 m sprint inside a 20 km ride is
 *  fine; a 9 km segment inside an 8 km run is not the session. */
export function fitScore(segmentM: number, targetM: number): number {
  if (!(targetM > 0) || !(segmentM > 0)) return 0.5;
  const r = segmentM / targetM;
  if (r < 0.02) return 0.2;
  if (r < 0.05) return 0.2 + ((r - 0.02) / 0.03) * 0.8;
  if (r <= 0.35) return 1;
  return Math.max(0, 1 - (r - 0.35) / 0.45);
}

/**
 * Percent change in efficiency factor per effort across the last five.
 *
 * PACE SPORTS ONLY, and null for everything else — not zero, null. A ride's EF
 * runs about four times a run's because the metres come so much cheaper per
 * beat, so a ride and a run in one EF comparison is not a comparison, it is a
 * list of rides. Returning null keeps a non-pace segment out of the form term
 * entirely rather than letting it win on a number that means something else.
 */
export function efTrendPct(
  activityType: string,
  recentEf: Array<number | null> | undefined,
): number | null {
  if (!isPaceSport(activityType)) return null;
  const points = (recentEf ?? [])
    .map((v, i) => ({ x: i, y: v }))
    .filter((p): p is { x: number; y: number } => p.y != null && Number.isFinite(p.y) && p.y > 0);
  if (points.length < 3) return null;

  const n = points.length;
  const meanX = points.reduce((a, p) => a + p.x, 0) / n;
  const meanY = points.reduce((a, p) => a + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  if (!(den > 0) || !(meanY > 0)) return null;
  return Math.round(((num / den / meanY) * 100) * 100) / 100;
}

/** Rising efficiency helps; falling efficiency says today is not the day. */
export function formScore(efTrend: number | null): number {
  if (efTrend == null) return 0.5;
  return Math.max(0, Math.min(1, 0.5 + efTrend / 4));
}

/**
 * Which of your own records are realistically beatable today.
 *
 * Segments are DIRECTIONAL. A climb and the descent back down it are separate
 * rows with separate leaderboards and separate PBs, and they are never merged
 * into one target here — "the hill" is two pieces of ground, and beating your
 * time up it says nothing about the way down.
 */
export function rankGettableSegments(
  segments: GettableCandidate[],
  options: GettableOptions,
): GettableTarget[] {
  const limit = options.limit ?? 3;
  const minScore = options.minScore ?? 0.25;

  const scored: GettableTarget[] = [];

  for (const s of segments ?? []) {
    const pb = s.pbDurationS;
    if (pb == null || !Number.isFinite(pb) || pb <= 0) continue;
    if (!(s.effortCount > 1)) continue;

    const recentBestS =
      s.recentBestS != null && Number.isFinite(s.recentBestS) && s.recentBestS > 0
        ? s.recentBestS
        : null;
    const gapPct = recentBestS != null ? (recentBestS - pb) / pb : null;
    const gapS = recentBestS != null ? Math.round((recentBestS - pb) * 10) / 10 : null;

    const trend = efTrendPct(s.activityType, s.recentEf);
    const components = {
      gap: gapScore(gapPct),
      trust: trustScore(s.effortCount),
      staleness: stalenessScore(s.daysSincePb),
      fit: fitScore(s.distanceM, options.targetDistanceM),
      form: formScore(trend),
    };

    let score =
      WEIGHTS.gap * components.gap +
      WEIGHTS.trust * components.trust +
      WEIGHTS.staleness * components.staleness +
      WEIGHTS.fit * components.fit +
      WEIGHTS.form * components.form;

    // A PB off three efforts is noise wearing a record's clothes. The trust
    // term already docks it; this halves whatever is left, so no combination
    // of a flattering gap and an ancient date can float it over a segment you
    // have actually run ten times.
    if (s.effortCount < MIN_TRUSTED_EFFORTS) score *= 0.5;

    // At the PB already: aim a shade under it. Otherwise the PB IS the target.
    const targetDurationS =
      gapPct == null || gapPct <= 0.01 ? Math.round(pb * 0.99) : Math.round(pb);

    scored.push({
      id: s.id,
      name: s.name,
      activityType: s.activityType,
      distanceM: s.distanceM,
      pbDurationS: pb,
      recentBestS,
      gapPct: gapPct == null ? null : Math.round(gapPct * 10000) / 10000,
      gapS,
      targetDurationS,
      effortCount: s.effortCount,
      daysSincePb: s.daysSincePb,
      efTrendPct: trend,
      score: Math.round(score * 1000) / 1000,
      components,
      reason: reasonFor({
        gapPct,
        gapS,
        effortCount: s.effortCount,
        daysSincePb: s.daysSincePb,
        efTrend: trend,
      }),
    });
  }

  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  return scored.filter((t) => t.score >= minScore).slice(0, limit);
}

function months(days: number): string {
  if (days < 60) return `${days} days`;
  const m = Math.round(days / 30);
  if (m < 18) return `${m} months`;
  return `${(days / 365).toFixed(1)} years`;
}

function seconds(s: number): string {
  const whole = Math.round(s);
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`;
}

/** The single most persuasive fact about this target, in one line. */
function reasonFor(input: {
  gapPct: number | null;
  gapS: number | null;
  effortCount: number;
  daysSincePb: number | null;
  efTrend: number | null;
}): string {
  const parts: string[] = [];

  if (input.gapPct == null) {
    parts.push('no recent effort to measure against the record');
  } else if (input.gapPct <= 0) {
    parts.push('your last run at it WAS the record');
  } else {
    parts.push(
      `${seconds(input.gapS ?? 0)} off the record, ${(input.gapPct * 100).toFixed(1)}% behind`,
    );
  }

  if (input.daysSincePb != null && input.daysSincePb > 7) {
    parts.push(`which has stood ${months(input.daysSincePb)}`);
  } else if (input.daysSincePb != null) {
    parts.push('though the record is fresh');
  }

  if (input.efTrend != null && input.efTrend > 0.2) {
    parts.push(`and efficiency is rising ${input.efTrend.toFixed(1)}% an effort`);
  } else if (input.efTrend != null && input.efTrend < -0.2) {
    parts.push(`though efficiency is drifting ${Math.abs(input.efTrend).toFixed(1)}% an effort`);
  }

  parts.push(
    input.effortCount < MIN_TRUSTED_EFFORTS
      ? `— only ${input.effortCount} efforts, so treat it lightly`
      : `over ${input.effortCount} efforts`,
  );

  const line = parts.join(', ').replace(/, —/g, ' —').replace(/, (which|though|and) /g, ' $1 ');
  return line.charAt(0).toUpperCase() + line.slice(1) + '.';
}
