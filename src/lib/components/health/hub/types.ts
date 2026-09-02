// The owner payload, as the dashboard's nine sections read it.
//
// This is a STRUCTURAL restatement of what `/health/+page.server.ts` returns in
// owner mode, not a second source of truth: the page passes its own narrowed
// `data` straight into `<HealthDashboard>`, so TypeScript checks the two shapes
// against each other on every build. If the loader drops a field, this file is
// where the error lands.
//
// It exists because the alternative — reaching into `../../../routes/health/
// $types` from `$lib` — points a UI module at a route, which is the one
// direction the module-boundary gate forbids.
import type { MetricResult } from '$lib/health/analytics/types';
import type { ACWRResult } from '$lib/health/analytics/acwr';
import type { MonotonyResult } from '$lib/health/analytics/monotony';
import type { PolarisedResult } from '$lib/health/analytics/polarised';
import type { CircadianResult } from '$lib/health/analytics/circadian';
import type { AutonomicResult } from '$lib/health/analytics/autonomic-balance';
import type { RecoveryDebtResult } from '$lib/health/analytics/recovery-debt';
import type { VO2Result } from '$lib/health/analytics/vo2max-percentile';
import type { ForecastResult } from '$lib/health/analytics/forecast';
import type { HealthDay } from '$lib/health/series-30d-service';
import type { ReadinessResponse } from '$lib/health/types';
import type { TrailsDashboard } from '$lib/trails/physio-service';
import type { SegmentChain } from '$lib/trails/highlights-service';
import type { DailyPlan } from '$lib/trails/coach-service';
import type { Move } from '$lib/health/moves';
import type { Tripwire } from '$lib/health/tripwires';
import type { Experiment } from '$lib/health/experiments';
import type { Verdict } from '$lib/health/verdict';

/** The four forecast cards in section C, each `null` when its series is empty. */
export interface ForecastSet {
  sleep: MetricResult<ForecastResult> | null;
  hrv: MetricResult<ForecastResult> | null;
  vo2max: MetricResult<ForecastResult> | null;
  acwr: MetricResult<ForecastResult> | null;
}

/** One row of the gettable board — a record that is genuinely in range. */
export interface GettableRow {
  id: number;
  name: string;
  activityType: string;
  gapPct: number;
  daysSincePb: number | null;
  effortCount: number;
}

/** Section F: the form taxonomy tiles, and the board behind the headline. */
export interface SegmentForms {
  gettable: number;
  improving: number;
  withForm: number;
  nearest: { name: string; gapPct: number } | null;
  taxonomy: {
    improving: number;
    holding: number;
    slipping: number;
    noRead: number;
    total: number;
  };
  board: GettableRow[];
}

/**
 * The dashboard's view of `TrailsDashboard`.
 *
 * Identical to it apart from the workouts, which are narrowed to the one field
 * section A reads — a per-week session count. A full `TrailsDashboard` is
 * assignable to this, so the owner path passes its own struct through
 * unchanged; the anonymous path passes `publicDashboard()`'s projection, which
 * has dropped the `id`, `name` and `startDate` that would name an outing and
 * the ground it covered. Widening the type here is what makes that projection
 * type-check instead of needing a cast.
 */
export type DashboardRead = Omit<TrailsDashboard, 'workouts'> & {
  workouts: Array<{ day: string }>;
};

export interface WeeklyVolumeRead {
  weekKm: number;
  medianKm: number;
  weekStart: string;
}

export interface OwnerHealthData {
  /** When the server finished assembling the values displayed on this page. */
  dashboardUpdatedAt: string;

  /**
   * Where the numbers came from, straight off `getHealthSeries30d`.
   *
   * `seriesIsMock` is the one flag on this payload that changes what the page
   * MEANS: with no real day in the window, the whole 30-day series, the
   * workouts and the rings are replaced by a deterministic fake so the page
   * still renders on a cold start or through a sync outage. It is plausible and
   * indistinguishable from real without this flag, so the dashboard says so out
   * loud rather than presenting fabricated figures as measurements.
   */
  provenance: { seriesIsMock: boolean; correlationsAreIllustrative: boolean };

  // ——— section A ————————————————————————————————————————————————
  today: HealthDay | null;
  series: HealthDay[];
  rhrBaseline: number;
  todayDeltas: { recDelta: number; hrvDeltaPct: number; rhrDelta: number; sleepDelta: number } | null;
  syncedAgoSeconds: number;
  readiness: ReadinessResponse | null;
  volume: WeeklyVolumeRead | null;

  // ——— section B ————————————————————————————————————————————————
  dashboard: DashboardRead | null;
  acwr: MetricResult<ACWRResult> | null;
  monotony: MetricResult<MonotonyResult> | null;
  polarised: MetricResult<PolarisedResult> | null;
  sleepRegularity: MetricResult<number> | null;
  circadian: MetricResult<CircadianResult> | null;
  autonomic: MetricResult<AutonomicResult> | null;
  recoveryDebt: MetricResult<RecoveryDebtResult> | null;
  vo2max: MetricResult<VO2Result> | null;

  // ——— sections C–I ——————————————————————————————————————————————
  forecast: ForecastSet;
  moves: Move[];
  tripwires: Tripwire[];
  experiments: Experiment[];
  verdict: Verdict | null;
  segmentForms: SegmentForms | null;
  segments: { totals: { segments: number; efforts: number } } | null;
  chains: SegmentChain[];
  coach: DailyPlan | null;
}


/**
 * What an anonymous visitor's /health is built from — the same document, minus
 * the ground.
 *
 * Structurally a subset of `OwnerHealthData`, and deliberately expressed as its
 * own type rather than as `Partial<OwnerHealthData>`: which fields are absent
 * is the privacy contract, so it is written down where a reviewer will see it
 * change. What is missing, and why:
 *
 *  * `coach` — section G is not rendered at all. Its route cards are FIXED
 *    editorial copy naming real corridors near where he lives, so passing null
 *    would not have hidden them; and `getDailyPlan` spends an
 *    openrouteservice call against a daily quota, which has no business on a
 *    page crawlers hit.
 *  * `chains` and `segments` — an ordered segment pair and the corpus roster
 *    are both names on the ground. Section F keeps only its four count tiles.
 *  * `segmentForms.board` / `.nearest` — present as a type, empty by
 *    construction: `publicSegmentForms()` strips them, so the gettable board
 *    and the tripwire's "closest is …" clause have nothing to print.
 *  * `narrative`, `annotations`, `featuredActivities`, `stats`, `rings`,
 *    `headline`, `strap`, `trainingLoad` — furniture of the retired public
 *    document. Nothing in the nine sections reads them.
 */
export interface PublicHealthData
  extends Pick<
    OwnerHealthData,
    | 'dashboardUpdatedAt'
    | 'provenance'
    | 'today'
    | 'series'
    | 'rhrBaseline'
    | 'todayDeltas'
    | 'syncedAgoSeconds'
    | 'readiness'
    | 'volume'
    | 'dashboard'
    | 'acwr'
    | 'monotony'
    | 'polarised'
    | 'sleepRegularity'
    | 'circadian'
    | 'autonomic'
    | 'recoveryDebt'
    | 'vo2max'
    | 'forecast'
    | 'moves'
    | 'tripwires'
    | 'experiments'
    | 'verdict'
    | 'segmentForms'
  > {
  segments: null;
  chains: [];
  coach: null;
}

/**
 * Who the document is being drawn for. It gates the two sections that carry
 * ground, the header nav into the owner-only children, and the section
 * lettering — not the data, which the loader has already decided.
 */
export type HealthAudience = 'owner' | 'public';
