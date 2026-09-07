// One place that knows what each figure on /health IS.
//
// The hub renders roughly thirty numbers across nine sections, and every one of
// them is already correct — the gap this closes is that a reader who does not
// already know what "monotony 100.0" or "SRI 71" means has nowhere to find out
// without leaving the page. So each figure gets a descriptor: the sentence that
// says what it measures, the direction that counts as good, the ladder of bands
// it sits on, and the id of the METHODOLOGY entry carrying the formula and the
// citation.
//
// Four rules, and each one is here because the alternative is a page that lies
// politely:
//
//  1. A DESCRIPTOR IS NOT A READING. Nothing in this file holds a value. It
//     describes the SHAPE of a metric — units, bands, meaning — and the caller
//     supplies today's number. That is what keeps a hover card over an
//     insufficient metric saying "needs 28 days" instead of drawing a band
//     ladder round a zero struct, which is exactly how `MetricResult` fails.
//
//  2. BANDS COME FROM THE ANALYTIC'S OWN CONSTANTS. `ACWR_BANDS`, `SRI_TARGET`,
//     `POLARISED_EASY_PCT` and the rest are imported, never retyped. A ladder
//     drawn here from remembered numbers would drift from the one the verdict
//     and the tripwires apply, and the two would disagree on the same screen.
//
//  3. THE DIRECTION IS EXPLICIT. Half of these metrics are better when they go
//     DOWN — resting heart rate, monotony, beats per kilometre, circadian
//     drift. A generic "up is good" arrow put on all of them is worse than no
//     arrow, so `higherIsBetter` is a required field and there is no default.
//
//  4. EVERY DESCRIPTOR NAMES ITS METHODOLOGY ENTRY OR ADMITS IT HAS NONE.
//     `methodologyId` is `string | null`, and the test asserts that every
//     non-null one actually resolves. A drill that offers "how this is
//     computed" and opens an empty drawer is worse than one that does not
//     offer it.
import { ACWR_BANDS } from './analytics/acwr';
import { SRI_TARGET } from './analytics/sri';
import { POLARISED_EASY_PCT, POLARISED_HARD_PCT } from './analytics/polarised';
import { SLEEP_BALANCE_SHORTFALL_MIN } from './analytics/recovery-debt';
import { getMethodologyEntry } from './methodology';

/**
 * Where a figure lives on the page. Used to group the drill's "related" list —
 * a reader who opens ACWR is far more likely to want monotony than sleep.
 */
export type MetricFamily = 'readiness' | 'load' | 'sleep' | 'autonomic' | 'fitness' | 'ground';

export interface MetricBand {
  /** The band's name, in the words the analytic itself uses. */
  label: string;
  /** Inclusive lower edge. Null means "everything below the next band". */
  from: number | null;
  /** Exclusive upper edge. Null means open-ended. */
  to: number | null;
  /** How this band should read: the thing you want, tolerable, or a warning. */
  tone: 'good' | 'plain' | 'warn';
}

export interface MetricDescriptor {
  id: string;
  /** The label as the page prints it. */
  label: string;
  unit: string;
  family: MetricFamily;
  /** One sentence: what this number measures. Plain English, no jargon. */
  what: string;
  /** One sentence: what moves it. This is the half a reader actually acts on. */
  moves: string;
  /** The sample the metric needs before its band means anything. */
  window: string;
  /** True when a bigger number is the better one. No default — see rule 3. */
  higherIsBetter: boolean;
  /** The ladder, low to high. Empty when the metric has no banding. */
  bands: MetricBand[];
  /** The METHODOLOGY entry with the formula and the citation, when there is one. */
  methodologyId: string | null;
  /** Decimal places the drill prints the value to. */
  dp: number;
}

const DESCRIPTORS: MetricDescriptor[] = [
  // ——— A · state of play ————————————————————————————————————————
  {
    id: 'readiness',
    label: 'Readiness',
    unit: '/100',
    family: 'readiness',
    what: 'A composite of recovery, HRV trend, sleep quality and load balance, weighted 40/20/20/20.',
    moves: 'Sleep and the day before it. The lowest of the four factors usually sets the band.',
    window: 'today',
    higherIsBetter: true,
    bands: [
      { label: 'Low — walk substitutes for a run', from: null, to: 40, tone: 'warn' },
      { label: 'Moderate — easy or skill-focused work', from: 40, to: 55, tone: 'plain' },
      { label: 'Good — a run is authorised', from: 55, to: null, tone: 'good' },
    ],
    methodologyId: 'readiness',
    dp: 0,
  },
  {
    id: 'recovery',
    label: 'Recovery',
    unit: '%',
    family: 'readiness',
    what: "Whoop's own morning recovery score, from HRV, resting heart rate and sleep.",
    moves: 'Sleep duration and quality, alcohol, illness, and the previous day’s strain.',
    window: 'today',
    higherIsBetter: true,
    bands: [
      { label: 'Red', from: null, to: 34, tone: 'warn' },
      { label: 'Yellow', from: 34, to: 67, tone: 'plain' },
      { label: 'Green', from: 67, to: null, tone: 'good' },
    ],
    methodologyId: null,
    dp: 0,
  },
  {
    id: 'hrv',
    label: 'HRV rmssd',
    unit: 'ms',
    family: 'autonomic',
    what: 'Beat-to-beat variation during the last slow-wave sleep, in milliseconds.',
    moves: 'Sleep, alcohol, illness and accumulated load. Read the trend, never one morning.',
    window: 'today vs 28d baseline',
    higherIsBetter: true,
    bands: [],
    methodologyId: 'autonomic-balance',
    dp: 0,
  },
  {
    id: 'rhr',
    label: 'Resting HR',
    unit: 'bpm',
    family: 'autonomic',
    what: 'Lowest sustained heart rate of the night.',
    moves: 'Fitness pushes it down over months; illness, alcohol and heat push it up within a day.',
    window: 'today vs 28d baseline',
    higherIsBetter: false,
    bands: [],
    methodologyId: 'autonomic-balance',
    dp: 0,
  },
  {
    id: 'sleep',
    label: 'Sleep',
    unit: 'h',
    family: 'sleep',
    what: 'Hours actually asleep last night, not hours in bed.',
    moves: 'Bedtime, mostly. Wake time is usually fixed, so the window is decided the night before.',
    window: 'today vs 30d mean',
    higherIsBetter: true,
    bands: [],
    methodologyId: null,
    dp: 1,
  },
  {
    id: 'volume',
    label: 'Week volume',
    unit: 'km',
    family: 'load',
    what: 'Distance in the last COMPLETE week — a week whose Sunday has passed.',
    moves: 'One long day moves this more than three short ones.',
    window: 'last complete week vs 12wk median',
    higherIsBetter: true,
    bands: [],
    methodologyId: null,
    dp: 1,
  },
  {
    id: 'vo2max',
    label: 'VO₂max',
    unit: '',
    family: 'fitness',
    what: 'Estimated maximal oxygen uptake, from pace against heart rate on steady efforts.',
    moves: 'Hard efforts build it; a fortnight off starts taking it back. The slope matters, the rank does not.',
    window: '90d regression',
    higherIsBetter: true,
    bands: [],
    methodologyId: 'vo2max',
    dp: 1,
  },

  // ——— B · the instrument deck ——————————————————————————————————
  {
    id: 'acwr',
    label: 'ACWR · EWMA',
    unit: '',
    family: 'load',
    what: 'This week’s training load against the last month’s, as a ratio. One means "the same as usual".',
    moves: 'Adding or dropping sessions. It is a ratio, so a quiet week raises it later by lowering the base.',
    window: '28d',
    higherIsBetter: true,
    bands: [
      { label: 'Detraining — the base is going backwards', from: null, to: ACWR_BANDS.detraining, tone: 'warn' },
      { label: 'Undertraining — room to add', from: ACWR_BANDS.detraining, to: ACWR_BANDS.undertraining, tone: 'plain' },
      { label: 'Optimal — fitness builds', from: ACWR_BANDS.undertraining, to: ACWR_BANDS.optimal, tone: 'good' },
      { label: 'Caution', from: ACWR_BANDS.optimal, to: ACWR_BANDS.caution, tone: 'plain' },
      { label: 'Danger — the injury band', from: ACWR_BANDS.caution, to: null, tone: 'warn' },
    ],
    methodologyId: 'acwr',
    dp: 2,
  },
  {
    id: 'monotony',
    label: 'Monotony · strain',
    unit: '',
    family: 'load',
    what: 'Mean daily load divided by its standard deviation. High means every day looks the same.',
    moves: 'Sameness, not volume. One genuinely easy day and one genuinely hard one lowers it.',
    window: '7d',
    higherIsBetter: false,
    bands: [
      { label: 'Varied', from: null, to: 1.5, tone: 'good' },
      { label: 'Moderate', from: 1.5, to: 2, tone: 'plain' },
      { label: 'High — the reading that precedes a stale block', from: 2, to: null, tone: 'warn' },
    ],
    methodologyId: 'monotony',
    dp: 1,
  },
  {
    id: 'polarised',
    label: 'Intensity mix',
    unit: '% easy',
    family: 'load',
    what: 'How the month split between easy, middle and hard heart-rate zones.',
    moves: `Easy days genuinely easy. A polarised verdict wants ${POLARISED_EASY_PCT}% easy and ${POLARISED_HARD_PCT}% hard, with little in between.`,
    window: '28d',
    higherIsBetter: true,
    bands: [
      { label: 'Not yet polarised — too much of the week in the middle', from: null, to: POLARISED_EASY_PCT, tone: 'plain' },
      { label: `Polarised — ${POLARISED_EASY_PCT}% easy or more`, from: POLARISED_EASY_PCT, to: null, tone: 'good' },
    ],
    methodologyId: 'polarised',
    dp: 0,
  },
  {
    id: 'sri',
    label: 'Sleep regularity · SRI',
    unit: '',
    family: 'sleep',
    what: 'The chance of being in the same sleep or wake state at the same clock minute on any two days.',
    moves: 'Going to bed and getting up at the same time. It counts BOTH ends, so a fixed bedtime alone fails it.',
    window: '30d',
    higherIsBetter: true,
    bands: [
      { label: 'Irregular', from: null, to: 60, tone: 'warn' },
      { label: 'Workable', from: 60, to: SRI_TARGET, tone: 'plain' },
      { label: `Regular — the ${SRI_TARGET} target`, from: SRI_TARGET, to: null, tone: 'good' },
    ],
    methodologyId: 'sri',
    dp: 0,
  },
  {
    id: 'circadian',
    label: 'Circadian drift',
    unit: 'h',
    family: 'sleep',
    what: 'How far the middle of the night has moved against its own three-week baseline.',
    moves: 'Late nights at weekends. An hour is the flag, and it is measured on the midpoint, not the bedtime.',
    window: '21d',
    higherIsBetter: false,
    bands: [
      { label: 'Aligned', from: null, to: 1, tone: 'good' },
      { label: 'Drifting', from: 1, to: null, tone: 'warn' },
    ],
    methodologyId: 'circadian-alignment',
    dp: 1,
  },
  {
    id: 'autonomic',
    label: 'Autonomic balance',
    unit: '',
    family: 'autonomic',
    what: 'HRV and resting heart rate together, each as a z-score against its own 28-day baseline.',
    moves: 'Everything recovery does, but read over a week — it is the early-warning composite, not a daily one.',
    window: '28d',
    higherIsBetter: true,
    bands: [
      { label: 'Early warning — investigate sleep, illness, alcohol, stress', from: null, to: 30, tone: 'warn' },
      { label: 'Settled', from: 30, to: 70, tone: 'plain' },
      { label: 'Strong', from: 70, to: null, tone: 'good' },
    ],
    methodologyId: 'autonomic-balance',
    dp: 0,
  },
  {
    id: 'balance',
    label: 'Sleep balance',
    unit: 'min/night',
    family: 'sleep',
    what: 'Sleep actually taken minus sleep needed, averaged over seven nights.',
    moves: `Bedtime. Past ${SLEEP_BALANCE_SHORTFALL_MIN} minutes short a night it becomes the action line.`,
    window: '7 nights',
    higherIsBetter: true,
    bands: [
      { label: 'Short — the action line', from: null, to: -SLEEP_BALANCE_SHORTFALL_MIN, tone: 'warn' },
      { label: 'Close to even', from: -SLEEP_BALANCE_SHORTFALL_MIN, to: 0, tone: 'plain' },
      { label: 'Met', from: 0, to: null, tone: 'good' },
    ],
    methodologyId: 'recovery-debt',
    dp: 0,
  },
  // ——— Measured, and until now drawn nowhere ————————————————————
  //
  // Four signals the loader already ships to the browser and no section
  // renders. They are not new tiles — the deck's eight panels and section A's
  // six are the document's shape and adding to them would change it — they are
  // reachable through `relatedMetrics`, so a reader who opens HRV is offered
  // the OTHER HRV, and one who opens the intensity mix is offered the zones the
  // mix was computed from.
  {
    id: 'hrv-sdnn',
    label: 'HRV SDNN · Apple',
    unit: 'ms',
    family: 'autonomic',
    what: 'Apple’s own HRV measure, taken across the whole day rather than during sleep.',
    moves: 'The same things that move the Whoop figure — but it is a DIFFERENT statistic on a different window, so the two are not comparable and only their directions are.',
    window: 'daily medians',
    higherIsBetter: true,
    bands: [],
    methodologyId: 'autonomic-balance',
    dp: 0,
  },
  {
    id: 'strain',
    label: 'Strain · Whoop',
    unit: '',
    family: 'load',
    what: 'Whoop’s own 0–21 cardiovascular load score for the day.',
    moves: 'Time spent at raised heart rate, whether or not it was a workout. A hot commute counts.',
    window: 'today',
    higherIsBetter: true,
    bands: [
      { label: 'Light', from: null, to: 10, tone: 'plain' },
      { label: 'Moderate', from: 10, to: 14, tone: 'good' },
      { label: 'Strenuous', from: 14, to: 18, tone: 'plain' },
      { label: 'All out', from: 18, to: null, tone: 'warn' },
    ],
    methodologyId: 'trimp',
    dp: 1,
  },
  {
    id: 'steps',
    label: 'Steps',
    unit: '',
    family: 'load',
    what: 'Steps taken, from Apple Health.',
    moves: 'Everything that is not a session. It is the base the training sits on rather than part of it.',
    window: 'today vs 30d',
    higherIsBetter: true,
    bands: [],
    methodologyId: null,
    dp: 0,
  },
  {
    id: 'weight',
    label: 'Weight',
    unit: 'kg',
    family: 'fitness',
    what: 'Body mass, from Apple Health.',
    moves: 'Slowly, and mostly not by training. Read the month, never the morning — a kilo of it is water.',
    window: 'today vs 30d',
    higherIsBetter: false,
    bands: [],
    methodologyId: null,
    dp: 1,
  },
  {
    id: 'efficiency',
    label: 'Efficiency · beats/km',
    unit: 'b/km',
    family: 'fitness',
    what: 'Heartbeats spent per kilometre covered. The cheapest single measure of aerobic fitness there is.',
    moves: 'Easy volume, over months. Heat, hills and fatigue all push it up on the day.',
    window: '5 outings',
    higherIsBetter: false,
    bands: [],
    methodologyId: 'efficiency-factor',
    dp: 0,
  },
];

const BY_ID = new Map(DESCRIPTORS.map((d) => [d.id, d]));

export function metricDescriptor(id: string): MetricDescriptor | null {
  return BY_ID.get(id) ?? null;
}

export function allMetricDescriptors(): MetricDescriptor[] {
  return DESCRIPTORS;
}

/** The other figures in the same family — what a drill offers as "next". */
export function relatedMetrics(id: string): MetricDescriptor[] {
  const self = BY_ID.get(id);
  if (!self) return [];
  return DESCRIPTORS.filter((d) => d.id !== id && d.family === self.family);
}

/**
 * Which band a value falls in, or null when the ladder is empty or the value
 * is not a reading. `null` in, `null` out — an insufficient metric must not be
 * handed a band, which is the whole zero-struct trap.
 */
export function bandFor(descriptor: MetricDescriptor, value: number | null): MetricBand | null {
  if (value == null || !Number.isFinite(value) || !descriptor.bands.length) return null;
  for (const band of descriptor.bands) {
    const overFrom = band.from == null || value >= band.from;
    const underTo = band.to == null || value < band.to;
    if (overFrom && underTo) return band;
  }
  return null;
}

/** The formula and the citation, when the descriptor names an entry that exists. */
export function methodologyFor(descriptor: MetricDescriptor) {
  return descriptor.methodologyId ? (getMethodologyEntry(descriptor.methodologyId) ?? null) : null;
}
