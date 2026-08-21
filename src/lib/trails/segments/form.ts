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
  /** Days between the PB and the most recent effort. */
  daysSincePb: number | null;
  /**
   * How far the best of the recent window sits behind the all-time PB, as a
   * fraction of the PB. 0 means the PB is in that window; 0.04 means four
   * percent off it.
   */
  gapPct: number | null;
}

/** Below this the window medians are just two numbers. */
export const MIN_EFFORTS_FOR_FORM = 4;
/** How many recent efforts make "now". */
const RECENT_WINDOW = 3;
/** How many efforts before that make "then". */
const EARLIER_WINDOW = 6;
/** Inside this band the change is noise, not a direction. */
const HOLDING_BAND_PCT = 2;
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

export function segmentForm(efforts: FormEffort[]): SegmentForm {
  const usable = efforts.filter((e) => Number.isFinite(e.durationS) && e.durationS > 0);
  if (!usable.length) return UNKNOWN_FORM;

  const chronological = [...usable].sort((a, b) => a.startedAt - b.startedAt);
  const durations = chronological.map((e) => e.durationS);
  const pbDurationS = Math.min(...durations);
  const pbEffort = chronological.find((e) => e.durationS === pbDurationS)!;
  const latest = chronological[chronological.length - 1];
  const daysSincePb = Math.max(0, Math.round((latest.startedAt - pbEffort.startedAt) / 86_400));

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
  if (now == null || then == null || then <= 0) {
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
