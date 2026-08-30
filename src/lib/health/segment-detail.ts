// The segment detail page's rules, as pure functions.
//
// Same contract as activity-detail.ts, and for the same reasons: everything the
// redesigned /health/segments/[id] shows that is not a plain field read off
// `SegmentDetail` is derived here, the copy is COMPUTED rather than
// model-written (spec hard constraint 5, 2026-08-30), and every sentence can
// therefore be asserted in a test.
//
// Four rules the helpers exist to keep:
//
//  1. FORM IS MEDIAN-BASED AND ALREADY DECIDED. `segmentForm` ran server-side
//     with its ±2% holding band, its six-effort floor and `daysSincePb`
//     measured to NOW. Nothing below recomputes any of it; the cards read it.
//
//  2. RANKS COME FROM `rankEfforts`, SO TIES SHARE A RANK. Two identical
//     efforts are both second and neither is third, and the board prints that
//     rather than a row index dressed up as a placing.
//
//  3. AN EFFORT WITH NO `avgHeartrate` IS THE UNRANKED ONE. `effortMetrics`
//     discards a heart-rate window covering less than half the effort
//     (`MIN_HR_COVERAGE`), so a null average IS the flag — the board marks the
//     row and says why, and the scatter draws it as a square.
//
//  4. EF AND BEATS-PER-KM ARE PACE-SPORT ONLY. Outside `isPaceSport` they are
//     null everywhere, so those columns and comparisons go blank by design
//     rather than printing a ride's 4.x beside a run's 1.0.
//
// The SVG helpers return GEOMETRY, not markup. Their viewBoxes are padded
// wherever a marker or a label sits on an edge — an endpoint circle drawn at
// x=0 is half outside the box and the viewport clips it, which no amount of
// CSS `overflow` recovers.
import type {
  SegmentConditions,
  SegmentDetail,
  SegmentEffortRow,
} from '$lib/trails/segments-service';
import type { SegmentForm } from '$lib/trails/segments/form';
import {
  GETTABLE_GAP_PCT,
  HOLDING_BAND_PCT,
  MIN_EFFORTS_FOR_FORM,
} from '$lib/trails/segments/form';
import { rankEfforts } from '$lib/trails/segments/metrics';
import { MIN_HR_COVERAGE } from '$lib/trails/segments/metrics';
import type { GradientBands } from '$lib/trails/segments/gradient-bands';
import { elevationProfile, type TrackPoint } from '$lib/trails/track';
import {
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  isPaceSport,
} from '$lib/trails/format';
import { capitalise, sharePhrase, spell } from './activity-detail';

// ——— small words and dates ————————————————————————————————————————
//
// Local copies rather than imports from `$lib/components/health/hub/format`:
// this is a domain module and the boundary gate forbids it reaching up into the
// ui layer. Ten lines of duplication is the cheaper half of that trade.

const MONTHS_SHORT = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * `14 JUN 2025` from a `YYYY-MM-DD`, by SPLITTING THE STRING.
 *
 * `startDateLocal` is already in the outing's own offset. Putting it through a
 * `Date` and back out through a local getter slides an evening effort into the
 * next day, either side of midnight, depending on where the reader is.
 */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  const month = MONTHS_SHORT[Number(m) - 1];
  if (!month || !y || !d) return String(iso);
  return `${Number(d)} ${month} ${y}`;
}

/**
 * The month band of a unix timestamp, for an axis whose domain is time rather
 * than a list of efforts. UTC rather than local: the only caller labels a month
 * boundary, and a month is the same month either side of an hour's offset.
 */
export function monthYearOf(unixS: number): string {
  return monthYear(new Date(unixS * 1000).toISOString().slice(0, 10));
}

/** `SEP 2023` — the month band an axis label or a stat card wants. */
export function monthYear(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m] = iso.slice(0, 10).split('-');
  const month = MONTHS_SHORT[Number(m) - 1];
  return month && y ? `${month} ${y}` : String(iso);
}

/** `8 March 2026` — the prose register. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  const month = MONTHS_LONG[Number(m) - 1];
  if (!month || !y || !d) return String(iso);
  return `${Number(d)} ${month} ${y}`;
}

/** `1st`, `2nd`, `63rd`. */
export function ordinal(value: number): string {
  const n = Math.round(value);
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const rem10 = n % 10;
  if (rem10 === 1) return `${n}st`;
  if (rem10 === 2) return `${n}nd`;
  if (rem10 === 3) return `${n}rd`;
  return `${n}th`;
}

/** Unix seconds → the calendar day count a reader means by "days ago". */
export function daysAgo(startedAt: number | null | undefined, nowS: number): number | null {
  if (!Number.isFinite(startedAt)) return null;
  return Math.max(0, Math.round((nowS - (startedAt as number)) / 86_400));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Oldest first. Every geometry below reads the record in this order. */
export function chronological(efforts: SegmentEffortRow[]): SegmentEffortRow[] {
  return [...efforts].sort((a, b) => a.startedAt - b.startedAt);
}

/** The quickest effort. Ties resolve to the earliest, which is when it was set. */
export function pbEffort(efforts: SegmentEffortRow[]): SegmentEffortRow | null {
  let best: SegmentEffortRow | null = null;
  for (const e of chronological(efforts)) {
    if (!(e.durationS > 0)) continue;
    if (!best || e.durationS < best.durationS) best = e;
  }
  return best;
}

// ——— 01 identity ————————————————————————————————————————————————

export interface StatCell {
  key: string;
  label: string;
  value: string;
  /** The small suffix set in the ghost colour: `%`, `d`, ` 2023`. */
  unit?: string;
  sub?: string;
  /** Accent, for the one figure the card is actually about. */
  lit?: boolean;
}

/**
 * The five cards under the name. Each carries its own footnote, because a time
 * with no date on it is a number nobody can place.
 */
export function identityCells(segment: SegmentDetail, nowS: number): StatCell[] {
  const efforts = chronological(segment.efforts);
  const pb = pbEffort(efforts);
  const last = efforts[efforts.length - 1] ?? null;
  const first = efforts[0] ?? null;
  const med = median(efforts.map((e) => e.durationS).filter((d) => d > 0));
  const net = segment.elevationGainM - segment.elevationLossM;
  const lastAgo = last ? daysAgo(last.startedAt, nowS) : null;

  const cells: StatCell[] = [];

  cells.push({
    key: 'pb',
    label: 'Personal best',
    value: pb ? formatDuration(pb.durationS) : '—',
    lit: true,
    sub: pb
      ? `${shortDate(pb.startDateLocal)}${
          segment.form.daysSincePb == null ? '' : ` · ${segment.form.daysSincePb}d ago`
        }`
      : 'No efforts yet',
  });

  cells.push({
    key: 'median',
    label: 'Median',
    value: med == null ? '—' : formatDuration(med),
    sub: `Across ${segment.effortCount} effort${segment.effortCount === 1 ? '' : 's'}`,
  });

  cells.push({
    key: 'last',
    label: 'Last effort',
    value: last ? formatDuration(last.durationS) : '—',
    sub: last
      ? `${shortDate(last.startDateLocal)}${lastAgo == null ? '' : ` · ${lastAgo}d ago`}`
      : '—',
  });

  cells.push({
    key: 'gradient',
    label: 'Avg gradient',
    value: `${segment.gradientPct > 0 ? '+' : ''}${segment.gradientPct}`,
    unit: '%',
    sub: `−${Math.round(segment.elevationLossM)} m descent · net ${
      net >= 0 ? '+' : '−'
    }${Math.round(Math.abs(net))} m`,
  });

  const perYear = effortsPerYear(segment, nowS);
  cells.push({
    key: 'first',
    label: 'First matched',
    value: first ? monthYear(first.startDateLocal).split(' ')[0] : '—',
    unit: first ? ` ${monthYear(first.startDateLocal).split(' ')[1]}` : undefined,
    sub: perYear == null ? '—' : `${perYear} efforts / year`,
  });

  return cells;
}

/**
 * Efforts per year over the span the segment has actually existed for.
 *
 * Measured to NOW, not to the last effort — the same choice `daysSincePb`
 * makes. Ground covered twenty times in 2023 and never since is not a
 * twenty-a-year segment.
 */
export function effortsPerYear(segment: SegmentDetail, nowS: number): number | null {
  const first = chronological(segment.efforts)[0] ?? null;
  if (!first || !segment.effortCount) return null;
  const years = Math.max(0.5, (nowS - first.startedAt) / (365.25 * 86_400));
  return Math.round(segment.effortCount / years);
}

/** `Sep 2023 – Aug 2026`, for the header meta. */
export function matchedSpan(efforts: SegmentEffortRow[]): string | null {
  const sorted = chronological(efforts);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return null;
  const a = first.startDateLocal.slice(0, 4);
  const b = last.startDateLocal.slice(0, 4);
  return a === b ? a : `${a}–${b}`;
}

// ——— 02 the ground ————————————————————————————————————————————

/** Plot box of the elevation profile, in the SVG's own user units. */
export const PROFILE = { w: 600, top: 25.5, bottom: 122.7, base: 130 } as const;

export interface ProfileGeometry {
  /** `<polyline points>` for the trace. */
  line: string;
  /** `<path d>` for the fill beneath it. */
  area: string;
  startY: number;
  endY: number;
  /** Left edge of the steepest quarter, or null when there is no climb to mark. */
  steepestX: number | null;
  steepestW: number;
  startLabel: string;
  midLabel: string;
  endLabel: string;
  gainM: number;
  lossM: number;
  /** Share of the total gain that happens in the first half, 0–100. */
  frontGainPct: number;
}

/**
 * The elevation profile, sampled evenly by distance.
 *
 * ONE POINT PER 100 m, clamped to 13–41. The design's profile is deliberately
 * chunky — that framing is the look — but a 6 km segment drawn at the same
 * thirteen points would lose every feature it has.
 */
export function profileGeometry(
  coordinates: SegmentDetail['coordinates'] | null | undefined,
): ProfileGeometry | null {
  if (!coordinates || coordinates.length < 3) return null;
  const profile = elevationProfile(coordinates as TrackPoint[]);
  if (profile.length < 3) return null;

  const totalM = profile[profile.length - 1].distanceM;
  if (!(totalM > 0)) return null;

  const count = Math.max(13, Math.min(41, Math.round(totalM / 100)));
  const samples: Array<{ distanceM: number; elevationM: number }> = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const target = (i / (count - 1)) * totalM;
    while (cursor < profile.length - 1 && profile[cursor + 1].distanceM <= target) cursor++;
    samples.push(profile[cursor]);
  }

  const eles = samples.map((s) => s.elevationM);
  const lo = Math.min(...eles);
  const hi = Math.max(...eles);
  const span = hi - lo || 1;
  const yOf = (ele: number) =>
    PROFILE.bottom - ((ele - lo) / span) * (PROFILE.bottom - PROFILE.top);
  const xOf = (i: number) => (i / (count - 1)) * PROFILE.w;

  const pts = samples.map((s, i) => `${xOf(i).toFixed(1)},${yOf(s.elevationM).toFixed(1)}`);
  const line = pts.join(' ');
  const area = `M${pts.join(' L')} L${PROFILE.w},${PROFILE.base} L0,${PROFILE.base} Z`;

  // Gain and loss over the samples, with the same 1 m threshold `spanElevation`
  // uses — under that it is barometric jitter, not ground.
  let gainM = 0;
  let lossM = 0;
  for (let i = 1; i < eles.length; i++) {
    const d = eles[i] - eles[i - 1];
    if (d >= 1) gainM += d;
    else if (d <= -1) lossM += -d;
  }

  // The quarter of the distance carrying the most climb.
  const windowN = Math.max(1, Math.round((count - 1) / 4));
  let bestStart = 0;
  let bestGain = 0;
  for (let i = 0; i + windowN < count; i++) {
    const g = eles[i + windowN] - eles[i];
    if (g > bestGain) {
      bestGain = g;
      bestStart = i;
    }
  }
  // Only worth marking when that quarter is doing real work: a fifth of the
  // segment's gain would be the flat answer, so require appreciably more.
  const markSteepest = gainM >= 20 && bestGain >= gainM * 0.3;

  const half = Math.round(samples.length / 2);
  const frontGain = eles.slice(0, half + 1).reduce((acc, v, i, arr) => {
    if (i === 0) return acc;
    const d = v - arr[i - 1];
    return d >= 1 ? acc + d : acc;
  }, 0);

  return {
    line,
    area,
    startY: yOf(eles[0]),
    endY: yOf(eles[eles.length - 1]),
    steepestX: markSteepest ? Math.min(xOf(bestStart), PROFILE.w * 0.75) : null,
    steepestW: PROFILE.w / 4,
    startLabel: `${Math.round(eles[0])} m`,
    midLabel: `${Math.round(totalM / 2)} m`,
    endLabel: `${Math.round(eles[eles.length - 1])} m`,
    gainM: Math.round(gainM),
    lossM: Math.round(lossM),
    frontGainPct: gainM > 0 ? Math.round((frontGain / gainM) * 100) : 0,
  };
}

/**
 * The paragraph under the profile. Terrain, surface, and where the climbing
 * actually is — every clause traceable to a number on the page.
 */
export function groundNote(
  segment: SegmentDetail,
  profile: ProfileGeometry | null,
  bands: GradientBands | null,
): string {
  const parts: string[] = [];

  const terrain =
    segment.terrain === 'climb'
      ? 'A climb'
      : segment.terrain === 'descent'
        ? 'A descent'
        : segment.terrain === 'rolling'
          ? 'Rolling ground'
          : 'Level ground';
  parts.push(`${terrain}${segment.offroad ? ', off-road by sport' : ''}.`);

  if (profile && profile.gainM >= 20) {
    parts.push(
      `${capitalise(sharePhrase(profile.frontGainPct))} the climbing happens in the first half, which is where every effort here is won or lost.`,
    );
  }

  if (bands?.usable) {
    const steep = bands.bands
      .filter((b) => b.fromPct >= 8)
      .reduce((acc, b) => acc + b.sharePct, 0);
    // The SHARES are quoted, never `steepestPct`. A single 50 m chord across a
    // dropped altitude sample reads as a 100% wall, and one bad sample would
    // then own the sentence; the shares are averaged over the whole path and
    // shrug it off.
    parts.push(
      steep > 0
        ? `${steep}% of it is steeper than 8%.`
        : 'Nothing on it is steeper than 8%.',
    );
  }

  parts.push(
    'SegmentDetail stores one average gradient; the stored coordinates carry elevation, so both the profile and the band breakdown are read off the trace rather than a new column.',
  );
  return parts.join(' ');
}

// ——— 03 form ————————————————————————————————————————————————————

export interface FormCard {
  key: string;
  label: string;
  value: string;
  unit?: string;
  tone: 'plain' | 'good' | 'accent';
  note: string;
  /** The gettable verdict: 2px accent border and a tint. */
  loud?: boolean;
}

/** `03 / Form · three-year view` — the window the section is actually reading. */
export function formKicker(efforts: SegmentEffortRow[], nowS: number): string {
  const first = chronological(efforts)[0] ?? null;
  if (!first) return '03 / Form';
  const months = Math.max(1, Math.round((nowS - first.startedAt) / (30.44 * 86_400)));
  if (months < 24) return `03 / Form · ${spell(months)}-month view`;
  return `03 / Form · ${spell(Math.round(months / 12))}-year view`;
}

/** The two display lines of the form headline, derived from direction and gap. */
export function formTitle(form: SegmentForm): string[] {
  if (form.direction === 'unknown') return ['Not enough', 'efforts yet'];
  const gap = form.gapPct == null ? null : form.gapPct * 100;
  const short = gap == null || gap < 0.05 ? null : `Still ${gap.toFixed(1)}% short`;
  if (form.direction === 'improving') return ['Gaining ground,', short ?? 'and holding the record'];
  if (form.direction === 'slipping') return ['Losing ground,', short ?? 'but still holding it'];
  return ['Holding the line,', short ?? 'and holding the record'];
}

export function formCards(segment: SegmentDetail, nowS: number): FormCard[] {
  const form = segment.form;
  const efforts = chronological(segment.efforts);
  const pb = pbEffort(efforts);
  const recent = efforts.slice(-3);
  const recentBest = recent.length
    ? recent.reduce((a, b) => (b.durationS < a.durationS ? b : a))
    : null;

  const direction: FormCard = {
    key: 'direction',
    label: 'Direction',
    value:
      form.direction === 'unknown'
        ? 'No read'
        : form.direction.charAt(0).toUpperCase() + form.direction.slice(1),
    tone:
      form.direction === 'improving' ? 'good' : form.direction === 'slipping' ? 'accent' : 'plain',
    note:
      form.direction === 'unknown'
        ? `Under ${MIN_EFFORTS_FOR_FORM} efforts, so the two window medians are just two numbers. ${segment.effortCount} on record.`
        : form.direction === 'holding'
          ? `Inside the ±${HOLDING_BAND_PCT}% holding band over the last ${form.sample}, so it counts as noise rather than a direction.`
          : `${Math.abs(form.deltaPct ?? 0).toFixed(1)}% ${
              form.direction === 'improving' ? 'quicker' : 'slower'
            } over the last ${form.sample} — outside the ±${HOLDING_BAND_PCT}% holding band, so it counts as a direction.`,
  };

  const gapPct = form.gapPct == null ? null : form.gapPct * 100;
  const gapSeconds =
    recentBest && pb ? Math.max(0, Math.round(recentBest.durationS - pb.durationS)) : null;
  const gap: FormCard = {
    key: 'gap',
    label: 'Gap to PB',
    value: gapPct == null ? '—' : gapPct.toFixed(1),
    unit: gapPct == null ? undefined : '%',
    tone: 'accent',
    note:
      recentBest && pb && gapSeconds != null
        ? gapSeconds === 0
          ? `The best of the last ${recent.length} is the PB itself, at ${formatDuration(pb.durationS)}.`
          : `Best of the last ${recent.length} is ${formatDuration(recentBest.durationS)} against a PB of ${formatDuration(pb.durationS)}. ${capitalise(spell(gapSeconds))} second${gapSeconds === 1 ? '' : 's'}.`
        : 'No efforts to measure a gap against.',
  };

  const staleness: FormCard = {
    key: 'staleness',
    label: 'Staleness',
    value: form.daysSincePb == null ? '—' : String(form.daysSincePb),
    unit: form.daysSincePb == null ? undefined : 'd',
    tone: 'plain',
    note: 'Measured to today, not to the last effort — an old record on ground you still cover is the catchable kind.',
  };

  const verdict = gettable(segment);
  const gettableCard: FormCard = {
    key: 'gettable',
    label: 'Gettable?',
    value: verdict.headline,
    tone: 'plain',
    loud: true,
    note: verdict.note,
  };

  return [direction, gap, staleness, gettableCard];
}

export interface GettableTest {
  name: string;
  passed: boolean;
  detail: string;
}

export interface GettableVerdict {
  passed: boolean;
  headline: string;
  tests: GettableTest[];
  note: string;
}

/**
 * The dashboard's gettable board, applied to one segment.
 *
 * THE TESTS ARE THE SHIPPED ONES, not a wider set invented for this card:
 * `summariseSegmentForms` counts a segment gettable when its form reads
 * `improving` and its gap is under `GETTABLE_GAP_PCT`, and a form only reads at
 * all above the six-effort floor. Staleness is on the page as its own card
 * because it is what makes a record worth attacking — but it is not a gate, and
 * printing it as one would make this page disagree with the board.
 */
export function gettable(segment: SegmentDetail): GettableVerdict {
  const form = segment.form;
  const gapPct = form.gapPct == null ? null : form.gapPct * 100;

  const tests: GettableTest[] = [
    {
      name: 'sample',
      passed: segment.effortCount >= MIN_EFFORTS_FOR_FORM && form.direction !== 'unknown',
      detail: `the board wants ${MIN_EFFORTS_FOR_FORM} efforts before it reads a form, this has ${segment.effortCount}`,
    },
    {
      name: 'direction',
      passed: form.direction === 'improving',
      detail:
        form.direction === 'unknown'
          ? 'no direction is read yet'
          : `the board wants improving, this is ${form.direction}`,
    },
    {
      name: 'gap',
      passed: form.gapPct != null && form.gapPct < GETTABLE_GAP_PCT,
      detail: `the board wants under ${(GETTABLE_GAP_PCT * 100).toFixed(0)}%, this is ${
        gapPct == null ? 'unmeasured' : `${gapPct.toFixed(1)}%`
      }`,
    },
  ];

  const failed = tests.filter((t) => !t.passed);
  const passed = failed.length === 0;
  const passedNames = tests.filter((t) => t.passed).map((t) => t.name);

  const listed = (names: string[]) =>
    names.length <= 1
      ? names.join('')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  const note = passed
    ? `Passes on ${listed(passedNames)}. ${
        form.daysSincePb == null
          ? 'The record is in range.'
          : `The record is ${form.daysSincePb} days old and in range.`
      }`
    : `${
        passedNames.length ? `Passes on ${listed(passedNames)}. ` : ''
      }Fails the ${failed[0].name} test — ${failed[0].detail}.`;

  return {
    passed,
    headline: passed ? 'Yes' : 'Not yet',
    tests,
    note,
  };
}

// ——— the effort scatter ————————————————————————————————————————

export const SCATTER = { w: 900, h: 240, x0: 60, x1: 865, top: 34, bottom: 204 } as const;

export type ScatterKind = 'plain' | 'unranked' | 'pb' | 'last';

export interface ScatterDot {
  key: string;
  x: number;
  y: number;
  kind: ScatterKind;
}

export interface ScatterGeometry {
  dots: ScatterDot[];
  /** The rolling median, `<polyline points>`. Empty when there is no window. */
  medianLine: string;
  gridlines: Array<{ y: number; label: string }>;
  pb: { x: number; y: number; label: string; anchor: 'start' | 'end' } | null;
  last: { x: number; y: number; label: string } | null;
  xLabels: Array<{ x: number; label: string; anchor: 'start' | 'middle' | 'end' }>;
}

/** Rolling median over a centred window. Nothing is drawn where it cannot span. */
export function rollingMedian(values: number[], window = 5): Array<number | null> {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    if (i < half || i > values.length - 1 - half) return null;
    return median(values.slice(i - half, i + half + 1));
  });
}

export function scatterGeometry(efforts: SegmentEffortRow[]): ScatterGeometry | null {
  const rows = chronological(efforts).filter((e) => e.durationS > 0);
  if (rows.length < 2) return null;

  const durations = rows.map((e) => e.durationS);
  const lo = Math.min(...durations);
  const hi = Math.max(...durations);
  // A 5% pad, so the PB dot clears the top gridline rather than sitting on it.
  const room = (hi - lo) * 0.05 || 1;
  const dLo = lo - room;
  const dHi = hi + room;
  const yOf = (d: number) =>
    SCATTER.top + ((d - dLo) / (dHi - dLo)) * (SCATTER.bottom - SCATTER.top);
  const xOf = (i: number) =>
    rows.length === 1 ? SCATTER.x0 : SCATTER.x0 + (i / (rows.length - 1)) * (SCATTER.x1 - SCATTER.x0);

  const pbIndex = durations.indexOf(lo);
  const lastIndex = rows.length - 1;

  const dots: ScatterDot[] = rows.map((e, i) => ({
    key: `${e.id}`,
    x: Number(xOf(i).toFixed(1)),
    y: Number(yOf(e.durationS).toFixed(1)),
    kind:
      i === pbIndex
        ? 'pb'
        : i === lastIndex
          ? 'last'
          : e.avgHeartrate == null
            ? 'unranked'
            : 'plain',
  }));

  const medians = rollingMedian(durations, 5);
  const medianLine = medians
    .map((v, i) => (v == null ? null : `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`))
    .filter((p): p is string => p != null)
    .join(' ');

  const gridlines = [0, 1, 2, 3].map((k) => {
    const y = SCATTER.top + (k / 3) * (SCATTER.bottom - SCATTER.top);
    const value = dLo + (k / 3) * (dHi - dLo);
    return { y: Number(y.toFixed(1)), label: formatDuration(value) };
  });

  return {
    dots,
    medianLine: medians.filter((v) => v != null).length > 1 ? medianLine : '',
    gridlines,
    // A PB set on the most recent effort sits at the right edge, where a label
    // running rightwards is clipped by the viewport rather than by CSS. It
    // flips instead.
    pb: {
      x: dots[pbIndex].x,
      y: dots[pbIndex].y,
      label: `PB ${formatDuration(rows[pbIndex].durationS)}`,
      anchor: dots[pbIndex].x > SCATTER.w - 90 ? ('end' as const) : ('start' as const),
    },
    // When the most recent effort IS the record, one dot would carry two
    // labels stacked on each other. The PB label is the one that says more.
    last:
      pbIndex === lastIndex
        ? null
        : {
            x: dots[lastIndex].x,
            y: dots[lastIndex].y,
            label: `Last ${formatDuration(rows[lastIndex].durationS)}`,
          },
    xLabels: [
      { x: SCATTER.x0, label: monthYear(rows[0].startDateLocal), anchor: 'start' },
      {
        x: (SCATTER.x0 + SCATTER.x1) / 2,
        label: monthYear(rows[Math.floor(rows.length / 2)].startDateLocal),
        anchor: 'middle',
      },
      { x: SCATTER.w - 20, label: monthYear(rows[lastIndex].startDateLocal), anchor: 'end' },
    ],
  };
}

/** The paragraph under the scatter — the median's direction, said plainly. */
export function scatterNote(segment: SegmentDetail): string {
  const form = segment.form;
  const efforts = chronological(segment.efforts);
  const span = formKicker(efforts, efforts[efforts.length - 1]?.startedAt ?? 0);
  void span;
  if (form.direction === 'unknown') {
    return `Every effort on this ground, oldest first. Under ${MIN_EFFORTS_FOR_FORM} of them the rolling median has nothing to say yet — the dots are the whole story until then.`;
  }
  const way =
    form.direction === 'improving'
      ? 'still descending'
      : form.direction === 'slipping'
        ? 'rising'
        : 'flat';
  return `Every effort on this ground, oldest first. The rolling median is ${way}, which is the useful sentence: the PB is a single day and the median is the ground truth.`;
}

// ——— 04 the board ——————————————————————————————————————————————

export interface BoardBadge {
  text: string;
  tone: 'solid' | 'outline' | 'cream' | 'plain';
}

export interface BoardRow {
  key: string;
  activityId: string;
  /** Rank on time. Ties share it, so two rows can both read `03`. */
  rank: number | null;
  dateIso: string;
  dateLabel: string;
  time: string;
  pace: string;
  avgHeartrate: string;
  efficiencyFactor: string;
  beatsPerKm: string;
  /** Null `avgHeartrate` — the effort is unranked on every HR-derived metric. */
  unranked: boolean;
  isPb: boolean;
  isLast: boolean;
  litTime: boolean;
  litHr: boolean;
  litEf: boolean;
  litBpk: boolean;
  badges: BoardBadge[];
  /** Why the row is unranked, in the row itself. */
  note: string | null;
}

/**
 * The leaderboard, quickest first.
 *
 * Ranks come from `rankEfforts` on four keys, so a tie shares a rank on each of
 * them independently — the fastest day and the most efficient one are rarely
 * the same effort, which is the whole point of the panel.
 */
export function boardRows(efforts: SegmentEffortRow[], paceSport: boolean): BoardRow[] {
  const rows = [...efforts].sort((a, b) => a.durationS - b.durationS);
  if (!rows.length) return [];

  const byTime = rankEfforts(rows, 'durationS', (e) => e.durationS);
  const byHr = rankEfforts(rows, 'avgHeartrate', (e) => e.avgHeartrate);
  const byEf = rankEfforts(rows, 'efficiencyFactor', (e) => e.efficiencyFactor);
  const byBpk = rankEfforts(rows, 'beatsPerKm', (e) => e.beatsPerKm);

  const sharesRank = (map: Map<SegmentEffortRow, number>, row: SegmentEffortRow) => {
    const r = map.get(row);
    if (r == null) return false;
    let n = 0;
    for (const v of map.values()) if (v === r) n++;
    return n > 1;
  };

  const lastId = chronological(efforts)[efforts.length - 1]?.id ?? null;

  return rows.map((e) => {
    const rankTime = byTime.get(e) ?? null;
    const rankHr = byHr.get(e) ?? null;
    const rankEf = byEf.get(e) ?? null;
    const rankBpk = byBpk.get(e) ?? null;
    const unranked = e.avgHeartrate == null;
    const isPb = rankTime === 1;
    const isLast = e.id === lastId;

    const badges: BoardBadge[] = [];
    if (isPb) badges.push({ text: 'PB time', tone: 'solid' });
    if (rankEf === 1) {
      badges.push({ text: `${sharesRank(byEf, e) ? '=' : ''}1st EF`, tone: 'outline' });
    }
    if (rankBpk === 1) badges.push({ text: 'Cheapest', tone: 'solid' });
    if (rankHr === 1) badges.push({ text: '1st lowest HR', tone: 'outline' });
    if (isLast) badges.push({ text: 'Most recent', tone: 'cream' });
    if (badges.length < 3 && rankBpk != null && rankBpk > 1 && rankBpk <= 3) {
      badges.push({ text: `${ordinal(rankBpk)} b/km`, tone: 'plain' });
    }
    if (badges.length < 3 && rankEf != null && rankEf > 1 && rankEf <= 3) {
      badges.push({ text: `${ordinal(rankEf)} EF`, tone: 'plain' });
    }

    return {
      key: String(e.id),
      activityId: e.activityId,
      rank: rankTime,
      dateIso: e.startDateLocal.slice(0, 10),
      dateLabel: shortDate(e.startDateLocal),
      time: formatDuration(e.durationS),
      pace: paceSport ? formatPace(e.paceSPerKm).replace(' /km', '') : formatSpeed(e.paceSPerKm),
      avgHeartrate: e.avgHeartrate == null ? '—' : String(Math.round(e.avgHeartrate)),
      efficiencyFactor: e.efficiencyFactor == null ? '—' : e.efficiencyFactor.toFixed(2),
      beatsPerKm: e.beatsPerKm == null ? '—' : String(Math.round(e.beatsPerKm)),
      unranked,
      isPb,
      isLast,
      litTime: isPb,
      litHr: rankHr === 1,
      litEf: rankEf === 1,
      litBpk: rankBpk === 1,
      badges: badges.slice(0, 3),
      note: unranked
        ? `HR coverage under ${Math.round(MIN_HR_COVERAGE * 100)}% · unranked`
        : null,
    };
  });
}

export interface BoardNote {
  key: string;
  label: string;
  text: string;
  lead?: boolean;
}

/**
 * The three notes under the board. Each one only renders when the record
 * actually contains the thing it explains — a tie note on a board with no tie
 * is the sort of copy that makes a page stop being trustworthy.
 */
export function boardNotes(efforts: SegmentEffortRow[]): BoardNote[] {
  const notes: BoardNote[] = [];
  const pb = pbEffort(efforts);

  const withEf = efforts.filter((e) => e.efficiencyFactor != null);
  const bestEf = withEf.length
    ? withEf.reduce((a, b) =>
        (b.efficiencyFactor as number) > (a.efficiencyFactor as number) ? b : a,
      )
    : null;
  const withBpk = efforts.filter((e) => e.beatsPerKm != null);
  const bestBpk = withBpk.length
    ? withBpk.reduce((a, b) => ((b.beatsPerKm as number) < (a.beatsPerKm as number) ? b : a))
    : null;

  if (bestEf && pb) {
    if (bestEf.id === pb.id) {
      notes.push({
        key: 'record',
        label: 'The interesting record',
        lead: true,
        text: `${longDate(pb.startDateLocal)} holds the time and the efficiency on this segment. The fastest day was also the cheapest, which does not happen often.`,
      });
    } else {
      const slower = Math.round(bestEf.durationS - pb.durationS);
      const both = bestBpk?.id === bestEf.id;
      const hrGap =
        bestEf.avgHeartrate != null && pb.avgHeartrate != null
          ? Math.round(pb.avgHeartrate - bestEf.avgHeartrate)
          : null;
      const beats =
        hrGap == null
          ? ''
          : hrGap > 0
            ? `, at ${spell(hrGap)} fewer beats per minute`
            : hrGap < 0
              ? `, at ${spell(-hrGap)} more beats per minute`
              : ', at the same heart rate';
      notes.push({
        key: 'record',
        label: 'The interesting record',
        lead: true,
        text: `${longDate(bestEf.startDateLocal)} is the best effort on this segment by ${
          both ? 'both efficiency measures' : 'efficiency'
        } — ${spell(slower)} second${slower === 1 ? '' : 's'} slower than the PB${beats}.${
          hrGap != null && hrGap > 0 ? ' That is fitness.' : ''
        } ${longDate(pb.startDateLocal)} was the quick day.`,
      });
    }
  }

  const unranked = efforts.filter((e) => e.avgHeartrate == null);
  if (unranked.length) {
    const one = chronological(unranked)[unranked.length - 1];
    notes.push({
      key: 'unranked',
      label: 'Why a row goes unranked',
      text: `${longDate(one.startDateLocal)} has a time but no heart rate: the series covered less than ${Math.round(
        MIN_HR_COVERAGE * 100,
      )}% of the effort. A mean of what survived is not the mean of the effort, so nothing is claimed — and the row is unranked on every HR-derived metric.${
        unranked.length > 1 ? ` ${unranked.length} rows read that way.` : ''
      }`,
    });
  }

  // A tie is only worth explaining when the board is showing one.
  const efValues = withEf.map((e) => (e.efficiencyFactor as number).toFixed(2));
  const tiedEf = efValues.find((v, i) => efValues.indexOf(v) !== i);
  if (tiedEf && withEf.length > 2) {
    const count = efValues.filter((v) => v === tiedEf).length;
    notes.push({
      key: 'tie',
      label: 'How a tie reads',
      text: `${capitalise(spell(count))} efforts share EF ${tiedEf}, so ${
        count === 2
          ? 'both hold that rank and neither holds the next one'
          : 'they all hold that rank and none holds the next one'
      }. The board's ranks are competition ranks, not row numbers.`,
    });
  }

  return notes;
}

// ——— 05 the record, and the weather —————————————————————————————

export const PB_STEP = { w: 600, top: 20, bottom: 120 } as const;

export interface PbStepGeometry {
  /** `<path d>` using H and V only — the record can only ever fall. */
  path: string;
  dots: Array<{ x: number; y: number }>;
  pb: { x: number; y: number; label: string; anchor: 'start' | 'end' };
  /** The flat stretch since the record last moved. */
  flat: { x: number; y: number; label: string } | null;
  gridlines: Array<{ y: number; label: string }>;
  xLabels: Array<{ x: number; label: string; anchor: 'start' | 'middle' | 'end' }>;
  steps: number;
  months: number;
}

/**
 * The PB as it stood on the day, as a step path.
 *
 * H AND V COMMANDS ONLY. A diagonal between two steps would draw a record
 * improving on a day nothing was run, and the whole point of the shape is that
 * a long flat stretch means nothing has beaten it since.
 *
 * The axis runs to NOW rather than to the last effort, for the same reason
 * `daysSincePb` does: a segment last run three years ago has a three-year flat
 * stretch, and hiding that behind the last dot would be the flattering answer.
 */
export function pbStepGeometry(
  efforts: SegmentEffortRow[],
  nowS: number,
): PbStepGeometry | null {
  const rows = chronological(efforts).filter((e) => e.durationS > 0);
  if (rows.length < 2) return null;

  const steps: Array<{ t: number; value: number; iso: string }> = [];
  let best = Number.POSITIVE_INFINITY;
  for (const e of rows) {
    if (e.durationS < best) {
      best = e.durationS;
      steps.push({ t: e.startedAt, value: best, iso: e.startDateLocal });
    }
  }
  if (!steps.length) return null;

  const t0 = rows[0].startedAt;
  const t1 = Math.max(nowS, rows[rows.length - 1].startedAt);
  const tSpan = t1 - t0 || 1;
  const xOf = (t: number) => Math.min(PB_STEP.w, Math.max(0, ((t - t0) / tSpan) * PB_STEP.w));

  const values = steps.map((s) => s.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const room = (hi - lo) * 0.05 || 1;
  const vLo = lo - room;
  const vHi = hi + room;
  const yOf = (v: number) =>
    PB_STEP.top + ((v - vLo) / (vHi - vLo)) * (PB_STEP.bottom - PB_STEP.top);

  let path = `M0,${yOf(steps[0].value).toFixed(1)}`;
  for (let i = 1; i < steps.length; i++) {
    path += ` H${xOf(steps[i].t).toFixed(1)} V${yOf(steps[i].value).toFixed(1)}`;
  }
  path += ` H${PB_STEP.w}`;

  const lastStep = steps[steps.length - 1];
  const pbX = Number(xOf(lastStep.t).toFixed(1));
  const pbY = Number(yOf(lastStep.value).toFixed(1));
  const flatMonths = Math.floor((nowS - lastStep.t) / (30.44 * 86_400));

  return {
    path,
    dots: steps
      .slice(1)
      .map((s) => ({ x: Number(xOf(s.t).toFixed(1)), y: Number(yOf(s.value).toFixed(1)) })),
    // Past four fifths of the axis the label would run off the padded viewBox,
    // so it flips to the left of the dot rather than being clipped.
    pb: {
      x: pbX,
      y: pbY,
      label: formatDuration(lastStep.value),
      anchor: pbX > PB_STEP.w * 0.8 ? ('end' as const) : ('start' as const),
    },
    flat:
      flatMonths >= 1
        ? {
            x: pbX,
            y: pbY,
            label: `${flatMonths} month${flatMonths === 1 ? '' : 's'} flat`,
          }
        : null,
    gridlines: [0, 1, 2].map((k) => {
      const y = PB_STEP.top + (k / 2) * (PB_STEP.bottom - PB_STEP.top);
      return { y, label: formatDuration(vLo + (k / 2) * (vHi - vLo)) };
    }),
    // THE AXIS IS TIME, SO THE LABELS ARE THE TIME DOMAIN'S — not the first,
    // middle and last effort's. It runs to now, and labelling the right edge
    // with the last effort's month would put a date under a point that is
    // months to its left, which is exactly the reading the flat bar exists to
    // prevent.
    xLabels: [
      { x: 0, label: monthYearOf(t0), anchor: 'start' },
      { x: PB_STEP.w / 2, label: monthYearOf(t0 + tSpan / 2), anchor: 'middle' },
      { x: PB_STEP.w, label: monthYearOf(t1), anchor: 'end' },
    ],
    steps: steps.length,
    months: Math.max(1, Math.round(tSpan / (30.44 * 86_400))),
  };
}

export function recordNote(geometry: PbStepGeometry | null): string {
  if (!geometry) return 'Too few efforts for the record to have a shape yet.';
  const flat = geometry.flat;
  return `The record as it stood on the day. It only ever falls, so the shape carries one fact: a long flat stretch means nothing has beaten it since. ${capitalise(
    spell(geometry.steps),
  )} step${geometry.steps === 1 ? '' : 's'} across ${geometry.months} months${
    flat ? `, then ${flat.label.toLowerCase()}` : ''
  } — which is the sentence the gap is really about.`;
}

export interface ConditionCell {
  key: string;
  label: string;
  value: string;
  lit?: boolean;
}

/** How many efforts a conditions read needs before it says anything. */
export const MIN_CONDITION_SAMPLE = 4;

export function conditionsCells(conditions: SegmentConditions): ConditionCell[] | null {
  if (conditions.sample < MIN_CONDITION_SAMPLE || conditions.meanC == null) return null;
  const delta =
    conditions.quickestC != null && conditions.slowestC != null
      ? conditions.quickestC - conditions.slowestC
      : null;
  const degrees = (v: number | null) =>
    v == null ? '—' : `${v.toFixed(1)}`;
  return [
    { key: 'typical', label: 'Typical', value: degrees(conditions.meanC) },
    { key: 'quickest', label: 'On the quickest', value: degrees(conditions.quickestC), lit: true },
    { key: 'slowest', label: 'On the slowest', value: degrees(conditions.slowestC) },
    {
      key: 'difference',
      label: 'Difference',
      value: delta == null ? '—' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta).toFixed(1)}`,
    },
  ];
}

/** The second conditions paragraph — the one sentence worth acting on. */
export function conditionsVerdict(conditions: SegmentConditions): string | null {
  if (conditions.quickestC == null || conditions.slowestC == null) return null;
  const delta = conditions.quickestC - conditions.slowestC;
  if (Math.abs(delta) < 1) {
    return 'The quick days and the slow ones ran at much the same temperature, so nothing here says wait for the weather.';
  }
  return `${capitalise(spell(Math.round(Math.abs(delta))))} degrees ${
    delta < 0 ? 'cooler' : 'warmer'
  } on the quick days. Worth knowing before booking the attempt.`;
}

// ——— 06 comparable ground ——————————————————————————————————————

export interface ComparableRow {
  id: number;
  name: string;
  metric: string;
  /** Percent against this segment's best EF. Positive is better. */
  deltaPct: number | null;
}

/** Its best efficiency relative to this segment's best, in percent. */
export function efficiencyDeltaPct(
  otherEf: number | null | undefined,
  referenceEf: number | null | undefined,
): number | null {
  if (otherEf == null || referenceEf == null || !(referenceEf > 0)) return null;
  return ((otherEf - referenceEf) / referenceEf) * 100;
}

/** `WHAT ELSE CLIMBS LIKE THIS` — the verb follows the terrain. */
export function comparableVerb(terrain: SegmentDetail['terrain']): string {
  if (terrain === 'climb') return 'climbs';
  if (terrain === 'descent') return 'drops';
  if (terrain === 'rolling') return 'rolls';
  return 'runs';
}

/** `1.70 km · +5.8% · EF 1.06` — the right-hand span of a "looks the same" row. */
export function climbMetric(row: {
  distanceM: number;
  gradientPct: number;
  bests: { efficiencyFactor: number | null };
}): string {
  const parts = [
    formatDistance(row.distanceM),
    `${row.gradientPct > 0 ? '+' : ''}${row.gradientPct}%`,
  ];
  if (row.bests.efficiencyFactor != null) {
    parts.push(`EF ${row.bests.efficiencyFactor.toFixed(2)}`);
  }
  return parts.join(' · ');
}

/** `EF 1.04` / `941 b/km` — the right-hand span of a "costs the same" row. */
export function efficiencyMetric(row: {
  bests: { efficiencyFactor: number | null; beatsPerKm: number | null };
}): string {
  const parts: string[] = [];
  if (row.bests.efficiencyFactor != null) parts.push(`EF ${row.bests.efficiencyFactor.toFixed(2)}`);
  if (row.bests.beatsPerKm != null) parts.push(`${Math.round(row.bests.beatsPerKm)} b/km`);
  return parts.join(' · ') || '—';
}

// ——— 07 what would take it ——————————————————————————————————————

export interface AttemptRow {
  label: string;
  text: string;
}

export interface Attempt {
  headline: string[];
  lede: string;
  rows: AttemptRow[];
}

/**
 * The attempt, built from what the record already says.
 *
 * EVERY CLAUSE TRACES TO A NUMBER ON THIS PAGE: the gap comes from `form`, the
 * temperature from `conditions`, the shape of the climb from the trace, and the
 * target from the same 3% the gettable board uses. Nothing here is a training
 * principle the page cannot show its working for.
 */
export function attempt(
  segment: SegmentDetail,
  profile: ProfileGeometry | null,
  nowS: number,
): Attempt | null {
  const efforts = chronological(segment.efforts);
  const pb = pbEffort(efforts);
  if (!pb || efforts.length < 2) return null;

  const recent = efforts.slice(-3);
  const recentBest = recent.reduce((a, b) => (b.durationS < a.durationS ? b : a));
  const gapS = Math.max(0, Math.round(recentBest.durationS - pb.durationS));
  const form = segment.form;

  const headline =
    gapS === 0
      ? ['The record is', 'the recent one']
      : gapS < 60
        ? [spell(gapS), gapS === 1 ? 'second' : 'seconds']
        : [
            `${spell(Math.floor(gapS / 60))} minute${Math.floor(gapS / 60) === 1 ? '' : 's'}`,
            gapS % 60 ? `and ${spell(gapS % 60)} seconds` : 'flat',
          ];

  const ledeParts: string[] = [];
  if (gapS === 0) {
    ledeParts.push(
      `The best of the last ${recent.length} efforts is the record itself, at ${formatDuration(pb.durationS)}.`,
    );
  } else {
    ledeParts.push(
      `The gap between the best of the last ${recent.length} and a record ${
        form.daysSincePb == null ? 'that has stood a while' : `${form.daysSincePb} days old`
      }.`,
    );
  }
  if (form.direction === 'improving' && form.deltaPct != null) {
    ledeParts.push(
      `Form is already pointing the right way at ${Math.abs(form.deltaPct).toFixed(1)}% quicker.`,
    );
  } else if (form.direction === 'slipping' && form.deltaPct != null) {
    ledeParts.push(
      `Form is pointing the other way at ${Math.abs(form.deltaPct).toFixed(1)}% slower, so this is a target rather than a plan.`,
    );
  }

  // The efficiency argument: an effort that was cheaper than the PB day proves
  // the engine has moved even when the clock has not.
  const withEf = efforts.filter((e) => e.efficiencyFactor != null);
  const bestEf = withEf.length
    ? withEf.reduce((a, b) =>
        (b.efficiencyFactor as number) > (a.efficiencyFactor as number) ? b : a,
      )
    : null;
  if (bestEf && pb && bestEf.id !== pb.id && bestEf.avgHeartrate != null && pb.avgHeartrate != null) {
    const hrGap = Math.round(pb.avgHeartrate - bestEf.avgHeartrate);
    if (hrGap > 0) {
      ledeParts.push(
        `The ${longDate(bestEf.startDateLocal)} effort covered it ${spell(
          Math.round(bestEf.durationS - pb.durationS),
        )} seconds slower at ${spell(hrGap)} fewer beats a minute, which is the engine, not the day.`,
      );
    }
  }

  const rows: AttemptRow[] = [];

  const c = segment.conditions;
  if (c.quickestC != null && c.slowestC != null && Math.abs(c.quickestC - c.slowestC) >= 1) {
    const delta = c.quickestC - c.slowestC;
    rows.push({
      label: 'When',
      text: `The quick efforts here run ${spell(Math.round(Math.abs(delta)))} degrees ${
        delta < 0 ? 'cooler' : 'warmer'
      } than the slow ones — ${c.quickestC.toFixed(1)}°C against ${c.slowestC.toFixed(1)}°C, over ${c.sample} efforts that carried a reading. Pick the day for that.`,
    });
  } else {
    rows.push({
      label: 'When',
      text: `Only ${c.sample} of ${segment.effortCount} efforts carried a temperature, and nothing in them separates the quick days from the slow ones. Pick the day on legs rather than on weather.`,
    });
  }

  const howParts: string[] = [];
  if (profile && profile.gainM >= 20) {
    howParts.push(
      `${capitalise(sharePhrase(profile.frontGainPct))} the climbing is in the first half`,
    );
  }
  const pbRate = isPaceSport(segment.activityType)
    ? formatPace(pb.paceSPerKm)
    : formatSpeed(pb.paceSPerKm);
  howParts.push(
    `the PB held ${pbRate} over ${formatDistance(segment.distanceM)} at ${
      segment.gradientPct > 0 ? '+' : ''
    }${segment.gradientPct}%`,
  );
  rows.push({
    label: 'How',
    text: `${capitalise(howParts.join(', and '))}. That is the effort to match before anything else.`,
  });

  const targetS = Math.round(pb.durationS * (1 + GETTABLE_GAP_PCT));
  const place = efforts.filter((e) => e.durationS < targetS).length + 1;
  rows.push({
    label: 'Target',
    text: `${formatDuration(targetS)} first — ${ordinal(place)} on the board, and inside the ${(
      GETTABLE_GAP_PCT * 100
    ).toFixed(0)}% the gettable test wants. The PB comes after that, not instead of it.`,
  });

  void nowS;
  return { headline, lede: ledeParts.join(' '), rows };
}
