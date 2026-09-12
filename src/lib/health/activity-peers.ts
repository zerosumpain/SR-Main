// Where one outing sits among the ones around it.
//
// Every figure across the activity header is a number with no frame: 8.42 km is
// long for a walk and short for a ride, and nothing on the page said which. This
// module is the frame — the same-sport cohort from the ninety days ending on the
// outing's own date, the subject's position in it, and the geometry that draws
// the distribution.
//
// It is PURE. The cohort arrives from `trails/peers-service` as plain numbers;
// nothing here reads a database, and every descriptor below holds units and
// wording only — never a value. That is the same split `metric-registry` and
// `metric-readings` keep on /health, and it exists for the same reason: a
// descriptor that could hold a reading eventually holds a stale one.
//
// Four rules the helpers keep:
//
//  1. THE WINDOW ENDS AT THE OUTING, NOT AT TODAY. "The last ninety days" read
//     literally would hand a 2025 walk a cohort it is not in, and a percentile
//     computed against a set you are absent from is not a percentile. Every set
//     is the ninety days UP TO AND INCLUDING the outing's own day, which for a
//     recent one is exactly what the reader meant.
//
//  2. A COHORT OF THREE HAS NO PERCENTILE. Below MIN_PEERS the reading says how
//     many there were instead of dressing four rides up as a distribution — the
//     zero-struct trap the hub's metric cards already close.
//
//  3. THE AXIS ONLY STARTS AT ZERO WHERE ZERO IS A REAL FLOOR. Distance, moving
//     time, climb, descent, energy, load and METs all have one. Heart rate,
//     pace, efficiency and HRR do not: a 0–180 bpm axis puts every outing ever
//     recorded in a clump against the right-hand edge and shows nothing.
//
//  4. THE PERCENTILE IS A POSITION, AND THE SENTENCE CARRIES THE MEANING. The
//     dot sits at its percentile along the axis, always. A pace of 6:40 /km is
//     the 78th percentile of pace and the sentence says "slower than 78% of
//     runs" — the alternative, flipping the number so the good end reads high,
//     is how a chart ends up disagreeing with its own label.
import { formatDuration, formatPace } from '$lib/trails/format';

/** Days of history a cohort spans, counted back from the outing's own day. */
export const PEER_WINDOW_DAYS = 90;

/**
 * The smallest cohort worth placing an outing in.
 *
 * Four is the floor rather than three because with three peers every position
 * is a quartile boundary and the percentile carries no information the rank
 * does not already carry.
 */
export const MIN_PEERS = 4;

// ——— what the server ships ————————————————————————————————————————

export interface PeerActivity {
  id: string;
  name: string;
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
}

/**
 * One cohort, ready for the browser.
 *
 * The activities are listed ONCE and every metric is an index-aligned array of
 * values beside them. A record of points per metric would repeat the id, the
 * name and the day twelve times over, which on the production cohort of 85
 * walks is a quarter of a megabyte of payload for a header strip.
 */
export interface PeerSet {
  /** The effective type every member shares — the owner's correction, resolved. */
  activityType: string;
  days: number;
  /** The local day the window ends on: the subject's own. */
  to: string;
  activities: PeerActivity[];
  /** Metric key → one value per activity, index-aligned. Null where absent. */
  values: Record<string, Array<number | null>>;
  /** Where the subject sits in `activities`, or −1 if it fell outside. */
  subjectIndex: number;
}

// ——— what a metric IS —————————————————————————————————————————————

export interface PeerMetric {
  /** The hero cell's own key, so a cell opts in by name and nothing else. */
  key: string;
  label: string;
  /** Set beside the figure, small. Null where the format carries its own. */
  unit: string | null;
  /** See rule 3. */
  zeroAnchored: boolean;
  /** The comparative for a value ABOVE the cohort — "longer", "slower". */
  above: string;
  /** And below it. Only ever used when the percentile is under 50. */
  below: string;
  /** The superlative, for an outing that is the OUTRIGHT top of its cohort. */
  most: string;
  /** And the outright bottom. */
  least: string;
  /** A value, spelled the way the header spells it. */
  format: (value: number) => string;
  /** The same, short enough for an axis end. */
  tick: (value: number) => string;
}

const KM = (v: number) => `${v.toFixed(v >= 100 ? 0 : 2)} km`;
const METRES = (v: number) => `${Math.round(v)} m`;
const BPM = (v: number) => `${Math.round(v)} bpm`;

/**
 * The twelve metrics the header can carry, keyed exactly as `heroStats` keys
 * its cells. A cell with no entry here simply never opens a card.
 *
 * `paceSport` decides one entry, the same way the header does: runners read
 * minutes per kilometre and cyclists read kilometres per hour, off the one
 * stored number. Both are returned as the `pace` key because that is the cell
 * they describe.
 */
export function peerMetrics(paceSport: boolean): Record<string, PeerMetric> {
  const list: PeerMetric[] = [
    {
      key: 'distance',
      label: 'Distance',
      unit: null,
      zeroAnchored: true,
      above: 'longer',
      below: 'shorter',
      most: 'Longest',
      least: 'Shortest',
      format: KM,
      tick: (v) => `${v.toFixed(v >= 100 ? 0 : 1)} km`,
    },
    {
      key: 'moving',
      label: 'Moving',
      unit: null,
      zeroAnchored: true,
      above: 'longer',
      below: 'shorter',
      most: 'Longest',
      least: 'Shortest',
      format: (v) => formatDuration(v),
      tick: (v) => formatDuration(v),
    },
    paceSport
      ? {
          key: 'pace',
          label: 'Avg pace',
          unit: null,
          zeroAnchored: false,
          // Seconds per kilometre: a HIGHER number is a slower outing. Rule 4.
          above: 'slower',
          below: 'faster',
          most: 'Slowest',
          least: 'Fastest',
          format: (v) => formatPace(v),
          tick: (v) => formatPace(v).replace(' /km', ''),
        }
      : {
          key: 'pace',
          label: 'Avg speed',
          unit: 'km/h',
          zeroAnchored: false,
          above: 'faster',
          below: 'slower',
          most: 'Fastest',
          least: 'Slowest',
          format: (v) => `${v.toFixed(1)} km/h`,
          tick: (v) => v.toFixed(1),
        },
    {
      key: 'climb',
      label: 'Climb',
      unit: null,
      zeroAnchored: true,
      above: 'more climb than',
      below: 'less climb than',
      most: 'Most climb',
      least: 'Least climb',
      format: METRES,
      tick: METRES,
    },
    {
      key: 'descent',
      label: 'Descent',
      unit: null,
      zeroAnchored: true,
      above: 'more descent than',
      below: 'less descent than',
      most: 'Most descent',
      least: 'Least descent',
      format: METRES,
      tick: METRES,
    },
    {
      key: 'avghr',
      label: 'Avg HR',
      unit: null,
      zeroAnchored: false,
      above: 'higher than',
      below: 'lower than',
      most: 'Highest',
      least: 'Lowest',
      format: BPM,
      tick: (v) => String(Math.round(v)),
    },
    {
      key: 'maxhr',
      label: 'Max HR',
      unit: null,
      zeroAnchored: false,
      above: 'higher than',
      below: 'lower than',
      most: 'Highest',
      least: 'Lowest',
      format: BPM,
      tick: (v) => String(Math.round(v)),
    },
    {
      key: 'energy',
      label: 'Energy',
      unit: null,
      zeroAnchored: true,
      above: 'more than',
      below: 'less than',
      most: 'Most energy',
      least: 'Least energy',
      format: (v) => `${Math.round(v)} kJ`,
      tick: (v) => String(Math.round(v)),
    },
    {
      key: 'trimp',
      label: 'Load · TRIMP',
      unit: null,
      zeroAnchored: true,
      above: 'more load than',
      below: 'less load than',
      most: 'Most load',
      least: 'Least load',
      format: (v) => String(Math.round(v)),
      tick: (v) => String(Math.round(v)),
    },
    {
      key: 'ef',
      label: 'Efficiency',
      unit: null,
      zeroAnchored: false,
      // EF is metres per minute per beat: more distance for the same heart.
      above: 'better than',
      below: 'worse than',
      most: 'Best',
      least: 'Worst',
      format: (v) => v.toFixed(2),
      tick: (v) => v.toFixed(2),
    },
    {
      key: 'hrr60',
      label: 'HRR 1 min',
      unit: null,
      zeroAnchored: false,
      above: 'sharper than',
      below: 'slower than',
      most: 'Sharpest',
      least: 'Slowest',
      format: (v) => `−${Math.round(v)} bpm`,
      tick: (v) => `−${Math.round(v)}`,
    },
    {
      key: 'mets',
      label: 'Intensity',
      unit: null,
      zeroAnchored: true,
      above: 'harder than',
      below: 'easier than',
      most: 'Hardest',
      least: 'Easiest',
      format: (v) => `${v.toFixed(1)} METs`,
      tick: (v) => v.toFixed(1),
    },
  ];

  const out: Record<string, PeerMetric> = {};
  for (const m of list) out[m.key] = m;
  return out;
}

/** Every metric key the header can open a card for. */
export function peerMetricKeys(paceSport: boolean): string[] {
  return Object.keys(peerMetrics(paceSport));
}

// ——— the reading ————————————————————————————————————————————————

export interface PeerPoint {
  id: string;
  name: string;
  day: string;
  value: number;
  /** True for the outing the page is about. */
  subject: boolean;
}

export interface PeerReading {
  metric: PeerMetric;
  /** Members of the cohort that actually carry this metric. */
  n: number;
  /** The subject's own value, or null when it has none. */
  value: number | null;
  /** 0–100, the share of the cohort this outing is above. Null below MIN_PEERS. */
  percentile: number | null;
  /** The sentence under the figure. Always says something true. */
  phrase: string;
  /** Axis ends, after rules 3 and the outlier cut. */
  domain: PeerDomain;
  /** Ascending by value — the order the swarm is laid out in. */
  points: PeerPoint[];
  median: number | null;
}

/** Plural of an effective activity type, for the cohort sentence. */
const TYPE_PLURAL: Record<string, string> = {
  run: 'runs',
  trail_run: 'trail runs',
  ride: 'rides',
  mtb: 'MTB rides',
  hike: 'hikes',
  walk: 'walks',
  swim: 'swims',
  other: 'sessions',
};

export function typePlural(type: string): string {
  return TYPE_PLURAL[type] ?? `${type.replace(/_/g, ' ')}s`;
}

/**
 * The share of the cohort a value sits above, as a percentage.
 *
 * Mid-rank, so ties split the difference: three identical walks each read 50
 * rather than one reading 0 and another 100. Returns null for an empty set.
 */
export function percentileOf(values: number[], value: number): number | null {
  if (!values.length) return null;
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return ((below + equal / 2) / values.length) * 100;
}

export function medianOf(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** `78` → `78th`. */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * One metric, placed in its cohort.
 *
 * Returns null where the header cell has no card to open: no such metric, or
 * not one value in the whole window. Everything else renders — a thin cohort
 * shows its points and says how few they are, because "three rides" is a
 * reading and a percentile drawn over three rides is not.
 */
export function peerReading(set: PeerSet | null, metric: PeerMetric): PeerReading | null {
  if (!set) return null;
  const column = set.values[metric.key];
  if (!column) return null;

  const points: PeerPoint[] = [];
  for (let i = 0; i < set.activities.length; i++) {
    const v = column[i];
    if (v == null || !Number.isFinite(v)) continue;
    const a = set.activities[i];
    points.push({ id: a.id, name: a.name, day: a.day, value: v, subject: i === set.subjectIndex });
  }
  if (!points.length) return null;
  points.sort((a, b) => a.value - b.value || a.day.localeCompare(b.day));

  const values = points.map((p) => p.value);
  const subjectValue =
    set.subjectIndex >= 0 ? (column[set.subjectIndex] ?? null) : null;
  const value = subjectValue != null && Number.isFinite(subjectValue) ? subjectValue : null;

  const n = points.length;
  const percentile = n >= MIN_PEERS && value != null ? percentileOf(values, value) : null;

  return {
    metric,
    n,
    value,
    percentile,
    phrase: phraseFor(metric, set, n, value, percentile, outrightOf(values, value)),
    domain: domainFor(metric, values, value),
    points,
    median: medianOf(values),
  };
}

/**
 * The sentence the card prints under the figure.
 *
 * Never a percentile dressed as a verdict, and never silence: a cohort too thin
 * to place says so, a metric the outing lacks says that instead, and everything
 * else gets the comparative the metric declared — which is why pace reads
 * "slower than 78%" rather than being quietly flipped to look like a win.
 */
function phraseFor(
  metric: PeerMetric,
  set: PeerSet,
  n: number,
  value: number | null,
  percentile: number | null,
  outright: 'max' | 'min' | null,
): string {
  const plural = typePlural(set.activityType);
  if (value == null) return `Not recorded — ${n} of the last ${set.days} days' ${plural} have it.`;
  if (percentile == null) {
    return `Only ${n} ${plural} in ${set.days} days — too few to place this against.`;
  }
  // An OUTRIGHT top or bottom is named, not placed. "Longer than 95% of 10
  // runs" is true of the longest run there has been, and is a worse sentence
  // than saying so — but only when it is outright: three outings tied at the
  // maximum are not "the longest", they are three of them, and the percentile
  // is the honest answer for all three.
  if (outright === 'max') return `${metric.most} of all ${n} ${plural} in ${set.days} days.`;
  if (outright === 'min') return `${metric.least} of all ${n} ${plural} in ${set.days} days.`;

  const pct = Math.round(percentile);
  const word = pct >= 50 ? metric.above : metric.below;
  const share = pct >= 50 ? pct : 100 - pct;
  const comparative = word.endsWith(' than') ? word : `${word} than`;
  return `${capitalise(comparative)} ${share}% of ${n} ${plural} in ${set.days} days.`;
}

/**
 * Whether the subject is the sole holder of the cohort's top or bottom.
 *
 * Sole, because a tie is not a superlative: two outings at 12.0 km are joint
 * longest, and a card that told each of them it was THE longest would be wrong
 * on both.
 */
function outrightOf(values: number[], value: number | null): 'max' | 'min' | null {
  if (value == null || values.length < MIN_PEERS) return null;
  const ties = values.filter((v) => v === value).length;
  if (ties !== 1) return null;
  if (value === Math.max(...values)) return 'max';
  if (value === Math.min(...values)) return 'min';
  return null;
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * The axis, after rule 3 — and after the outlier that rule 3 does not cover.
 *
 * Rule 3 decides where the axis STARTS. What flattened the first real cohort
 * this drew was where it ENDS: 104 rides, 101 of them under 10 km, one of 60.
 * Anchored at zero and run to the longest, 97% of the distribution landed in
 * the left tenth of the frame as a single blot, which is the picture failing at
 * exactly the job it was added to do.
 *
 * So the axis ends at the 95th percentile of the cohort rather than at its
 * maximum — but ONLY when the maximum is far enough past it to be doing the
 * flattening, and never before the subject itself, which must always be inside
 * its own frame. Whatever falls outside is COUNTED and drawn pinned at the
 * edge; it is never dropped, and the percentile above is computed over every
 * value either way. A clipped axis that silently loses points would be a worse
 * lie than a squashed one.
 */
export interface PeerDomain {
  lo: number;
  hi: number;
  /** Cohort members past `hi` — drawn at the edge, never discarded. */
  beyondHi: number;
  /** And below `lo`. */
  beyondLo: number;
}

/** The value at `q` through a sorted copy of `values`, linearly interpolated. */
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** How far past the cut the extreme has to sit before the cut is worth making. */
const CLIP_MARGIN = 1.3;

export function domainFor(
  metric: PeerMetric,
  values: number[],
  subject: number | null,
): PeerDomain {
  const all = subject != null && Number.isFinite(subject) ? [...values, subject] : values;
  if (!all.length) return { lo: 0, hi: 1, beyondHi: 0, beyondLo: 0 };

  const min = Math.min(...all);
  const max = Math.max(...all);
  let lo = metric.zeroAnchored ? Math.min(0, min) : min;
  let hi = max;

  // The top cut. Needs a cohort big enough for a 95th percentile to mean
  // anything — under MIN_PEERS it is just "the second largest".
  if (values.length >= MIN_PEERS) {
    const p95 = quantile(values, 0.95);
    if (p95 != null) {
      const cut = subject != null && Number.isFinite(subject) ? Math.max(p95, subject) : p95;
      if (cut > lo && max > lo + (cut - lo) * CLIP_MARGIN) hi = cut;
    }
  }

  // And the bottom, for the metrics that have no zero to anchor to.
  if (!metric.zeroAnchored && values.length >= MIN_PEERS) {
    const p05 = quantile(values, 0.05);
    if (p05 != null) {
      const cut = subject != null && Number.isFinite(subject) ? Math.min(p05, subject) : p05;
      if (cut < hi && min < hi - (hi - cut) * CLIP_MARGIN) lo = cut;
    }
  }

  // Headroom where the axis was cut, so the subject that forced the cut is not
  // drawn flush against the frame — and so the pinned chevrons have an edge of
  // their own to sit on rather than landing on top of it.
  const cutHi = hi < max;
  const cutLo = lo > min;
  if (hi > lo) {
    const room = (hi - lo) * 0.05;
    if (cutHi) hi += room;
    if (cutLo) lo -= room;
  }

  if (!(hi > lo)) {
    const pad = Math.max(Math.abs(hi) * 0.1, 1);
    lo = metric.zeroAnchored ? Math.min(0, hi - pad) : hi - pad;
    hi = hi + pad;
  } else if (!metric.zeroAnchored && !cutHi && !cutLo) {
    const room = (hi - lo) * 0.06;
    lo -= room;
    hi += room;
  }

  return {
    lo,
    hi,
    beyondHi: values.filter((v) => v > hi).length,
    beyondLo: values.filter((v) => v < lo).length,
  };
}

// ——— the matrix ————————————————————————————————————————————————
//
// A distribution says where an outing sits; it cannot say WHY. Pace against
// heart rate can: two runs at 5:30 /km, one at 148 bpm and one at 171, are the
// same dot on the pace strip and two very different runs. So every figure that
// has something to be explained BY gets a second chart — the same cohort, the
// card's own metric on x and a partner on y, with the subject lit in it.
//
// x IS ALWAYS THE CARD'S OWN METRIC, matching the strip above it. A scatter
// that put the subject on a different axis from the distribution would make the
// reader re-learn the mapping halfway down one panel.

/**
 * What explains what, in order — the first is the chart that opens.
 *
 * These are pairings a coach would actually draw, not every combination: the
 * partner is something that MOVES the metric or is moved by it. A metric with
 * no honest partner simply has no matrix, the same way a metric with no reading
 * has no card.
 */
export const PEER_PARTNERS: Record<string, string[]> = {
  // Was it long because it was slow, or long because it was long?
  distance: ['pace', 'moving'],
  moving: ['distance', 'pace'],
  // The pairing John named: pace is only a number until you know what it cost.
  pace: ['avghr', 'distance'],
  climb: ['distance', 'pace'],
  descent: ['climb', 'distance'],
  // And its mirror: a heart rate means one thing at 5:30 /km and another at 7:00.
  avghr: ['pace', 'mets'],
  maxhr: ['avghr', 'mets'],
  energy: ['moving', 'distance'],
  trimp: ['moving', 'avghr'],
  // Efficiency IS distance-per-beat, so pace is the axis that separates a good
  // day from a slow one.
  ef: ['pace', 'avghr'],
  hrr60: ['maxhr', 'trimp'],
  mets: ['avghr', 'pace'],
};

export interface ScatterPoint {
  id: string;
  name: string;
  day: string;
  x: number;
  y: number;
  subject: boolean;
}

export interface PeerMatrix {
  x: PeerMetric;
  y: PeerMetric;
  xDomain: PeerDomain;
  yDomain: PeerDomain;
  points: ScatterPoint[];
  /** Outings carrying BOTH metrics, out of the whole cohort. */
  n: number;
  of: number;
  /** The subject's own point, when it has both. */
  subject: ScatterPoint | null;
}

/**
 * The partners this cohort can actually draw, in preference order.
 *
 * Filtered on the data, not on the table: offering a chip that opens an empty
 * chart is the same failure as a tile printing a band round a zero struct. Two
 * points is the floor — a scatter of one is a dot with no shape to read.
 */
export function peerPartners(
  set: PeerSet | null,
  key: string,
  paceSport: boolean,
): PeerMetric[] {
  if (!set) return [];
  const metrics = peerMetrics(paceSport);
  const subject = metrics[key];
  if (!subject) return [];
  const out: PeerMetric[] = [];
  for (const partnerKey of PEER_PARTNERS[key] ?? []) {
    const partner = metrics[partnerKey];
    if (!partner) continue;
    const matrix = peerMatrix(set, subject, partner);
    if (matrix && matrix.n >= 2) out.push(partner);
  }
  return out;
}

/**
 * One cohort, plotted on two axes.
 *
 * Only outings carrying BOTH metrics are drawn, and `n` vs `of` says how many
 * that left — a heart-rate axis silently dropping the half of the cohort that
 * was recorded without a strap would be a scatter describing a set the reader
 * thinks is the whole one. The axes take the same outlier cut the strip does,
 * so one 60 km ride cannot flatten this chart either.
 */
export function peerMatrix(
  set: PeerSet | null,
  x: PeerMetric,
  y: PeerMetric,
): PeerMatrix | null {
  if (!set) return null;
  const xs = set.values[x.key];
  const ys = set.values[y.key];
  if (!xs || !ys) return null;

  const points: ScatterPoint[] = [];
  let subject: ScatterPoint | null = null;
  for (let i = 0; i < set.activities.length; i++) {
    const xv = xs[i];
    const yv = ys[i];
    if (xv == null || yv == null || !Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    const a = set.activities[i];
    const point: ScatterPoint = {
      id: a.id,
      name: a.name,
      day: a.day,
      x: xv,
      y: yv,
      subject: i === set.subjectIndex,
    };
    if (point.subject) subject = point;
    points.push(point);
  }
  if (!points.length) return null;

  return {
    x,
    y,
    xDomain: domainFor(x, points.map((p) => p.x), subject?.x ?? null),
    yDomain: domainFor(y, points.map((p) => p.y), subject?.y ?? null),
    points,
    n: points.length,
    of: set.activities.length,
    subject,
  };
}

// ——— the swarm ————————————————————————————————————————————————————

export interface SwarmDot {
  point: PeerPoint;
  x: number;
  /** Rows down from the axis: 0 is on it, 1 the first row beneath, and so on. */
  row: number;
  /** Set when the point is past the axis cut and has been pinned to that edge. */
  beyond: 'hi' | 'lo' | null;
}

/**
 * Beeswarm placement across a fixed width.
 *
 * A plain one-dimensional strip is the honest picture of a distribution right
 * up until two outings are the same length, at which point it is one dot that
 * claims to be one outing. Colliding dots drop to the next row down instead, so
 * the pile IS the density — and every point keeps its own click target, which
 * the drill needs and an overplotted strip cannot give.
 *
 * `maxRows` is a floor under legibility, not a limit on truth: a cohort with
 * twenty outings at the same distance would otherwise draw a column taller than
 * the card. Past it, a dot goes to whichever row has the most room, so it
 * overlaps slightly rather than disappearing or stretching the frame.
 *
 * Pure, and shared by the hover card and the drill so the two can never
 * disagree about where a point is.
 */
export function swarm(
  points: PeerPoint[],
  domain: { lo: number; hi: number },
  width: number,
  spacing: number,
  maxRows = 7,
): SwarmDot[] {
  const span = domain.hi - domain.lo || 1;
  // Rightmost x placed in each row so far. −Infinity means the row is free.
  const rows: number[] = new Array(maxRows).fill(Number.NEGATIVE_INFINITY);
  const out: SwarmDot[] = [];

  for (const point of points) {
    const raw = ((point.value - domain.lo) / span) * width;
    // Clamped, not dropped: a value past the axis cut is pinned to the edge and
    // the plot draws it differently, so the reader is told it is off the scale
    // rather than shown a frame it quietly fell out of.
    const x = Math.min(width, Math.max(0, raw));
    let row = -1;
    for (let r = 0; r < maxRows; r++) {
      if (x - rows[r] >= spacing) {
        row = r;
        break;
      }
    }
    if (row < 0) {
      // Every row is crowded — take the emptiest and accept the overlap.
      let best = 0;
      for (let r = 1; r < maxRows; r++) if (rows[r] < rows[best]) best = r;
      row = best;
    }
    rows[row] = x;
    out.push({ point, x, row, beyond: raw > width ? 'hi' : raw < 0 ? 'lo' : null });
  }
  return out;
}

/** How many rows deep the swarm actually got — what sizes the frame. */
export function swarmRows(dots: SwarmDot[]): number {
  let max = 0;
  for (const d of dots) max = Math.max(max, d.row);
  return max;
}
