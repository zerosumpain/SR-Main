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
  dashboard: TrailsDashboard | null;
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
