// Which way a segment is going.
//
// A leaderboard says what your best ever was; it says nothing about whether you
// are getting faster on that ground or slowly losing it. This is the pure
// computation behind the Form column on the segments explorer and the "gettable"
// judgement the coach makes — one implementation, so the two can never disagree
// about whether a stretch is improving.
//
// Deliberately median-based rather than mean-based: one effort spent waiting at
// a gate is a 40% outlier on a 500 m segment, and a mean would call that a
// collapse in form.

export type FormDirection = 'improving' | 'holding' | 'slipping' | 'unknown';

export interface FormEffort {
  durationS: number;
  /** Absolute unix seconds — `activity.startDate + startS`, not the effort offset. */
  startedAt: number;
  efficiencyFactor?: number | null;
}

export interface SegmentForm {
  direction: FormDirection;
  /**
   * Change in the recent window's median time against the earlier window's,
   * as a percentage. NEGATIVE is quicker, because the underlying number is a
   * duration — the sign trips people up, so the label always says which.
   */
  deltaPct: number | null;
  /** Efforts in the recent window. */
  sample: number;
  /** Durations oldest-first for a sparkline, capped at SPARK_MAX. */
  spark: number[];
  /** All-time best duration over the efforts given. */
  pbDurationS: number | null;
  /**
   * Days from the PB to NOW — not to the most recent effort.
   *
   * The coach reads this as staleness ("an old record is catchable"), and
   * measuring it to the last effort made a three-year-old PB on a segment
   * nobody has run since read as brand new.
   */
  daysSincePb: number | null;
  /**
   * How far the best of the recent window sits behind the all-time PB, as a
   * fraction of the PB. 0 means the PB is in that window; 0.04 means four
   * percent off it.
   */
  gapPct: number | null;
}

/**
 * Below this the window medians are just two numbers.
 *
 * Six, not four: the recent window is three, so at four the "earlier" median is
 * a single effort — and one effort spent waiting at a gate would then set the
 * direction for the whole segment, which is the exact failure the medians are
 * here to prevent.
 */
export const MIN_EFFORTS_FOR_FORM = 6;
/** The earlier window needs this many before its median means anything. */
const MIN_EARLIER = 3;
/** How many recent efforts make "now". */
const RECENT_WINDOW = 3;
/** How many efforts before that make "then". */
const EARLIER_WINDOW = 6;
/** Inside this band the change is noise, not a direction. */
export const HOLDING_BAND_PCT = 2;
/**
 * How close the recent best has to sit to the all-time PB before the record is
 * worth an attempt, as a fraction. The same 0.03 `gapScore` in coach.ts
 * inflects at — the coach's scoring curve and the dashboard's "gettable"
 * judgement have to mean the same thing by the same number.
 */
export const GETTABLE_GAP_PCT = 0.03;
const SPARK_MAX = 12;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const UNKNOWN_FORM: SegmentForm = {
  direction: 'unknown',
  deltaPct: null,
  sample: 0,
  spark: [],
  pbDurationS: null,
  daysSincePb: null,
  gapPct: null,
};

export function segmentForm(
  efforts: FormEffort[],
  opts: { now?: number } = {},
): SegmentForm {
  // Injected so the value is testable; unix SECONDS, matching `startedAt`.
  const asOf = opts.now ?? Math.floor(Date.now() / 1000);
  const usable = efforts.filter((e) => Number.isFinite(e.durationS) && e.durationS > 0);
  if (!usable.length) return UNKNOWN_FORM;

  const chronological = [...usable].sort((a, b) => a.startedAt - b.startedAt);
  const durations = chronological.map((e) => e.durationS);
  const pbDurationS = Math.min(...durations);
  const pbEffort = chronological.find((e) => e.durationS === pbDurationS)!;
  const daysSincePb = Math.max(0, Math.round((asOf - pbEffort.startedAt) / 86_400));

  const recent = chronological.slice(-RECENT_WINDOW);
  const recentBest = Math.min(...recent.map((e) => e.durationS));
  const gapPct = pbDurationS > 0 ? (recentBest - pbDurationS) / pbDurationS : null;

  const spark = durations.slice(-SPARK_MAX);

  if (chronological.length < MIN_EFFORTS_FOR_FORM) {
    return { ...UNKNOWN_FORM, spark, pbDurationS, daysSincePb, gapPct, sample: recent.length };
  }

  const earlier = chronological.slice(
    Math.max(0, chronological.length - RECENT_WINDOW - EARLIER_WINDOW),
    chronological.length - RECENT_WINDOW,
  );
  const now = median(recent.map((e) => e.durationS));
  const then = median(earlier.map((e) => e.durationS));
  if (earlier.length < MIN_EARLIER || now == null || then == null || then <= 0) {
    return { ...UNKNOWN_FORM, spark, pbDurationS, daysSincePb, gapPct, sample: recent.length };
  }

  const deltaPct = Math.round(((now - then) / then) * 1000) / 10;
  const direction: FormDirection =
    Math.abs(deltaPct) < HOLDING_BAND_PCT ? 'holding' : deltaPct < 0 ? 'improving' : 'slipping';

  return { direction, deltaPct, sample: recent.length, spark, pbDurationS, daysSincePb, gapPct };
}

/** "3.4% quicker over the last 3" — the sign explained, every time. */
export function formLabel(form: SegmentForm): string {
  if (form.direction === 'unknown' || form.deltaPct == null) {
    return form.sample > 0 ? 'Not enough efforts yet' : 'No efforts';
  }
  if (form.direction === 'holding') return `Holding, within ${HOLDING_BAND_PCT}%`;
  const magnitude = Math.abs(form.deltaPct).toFixed(1);
  return form.direction === 'improving'
    ? `${magnitude}% quicker over the last ${form.sample}`
    : `${magnitude}% slower over the last ${form.sample}`;
}
