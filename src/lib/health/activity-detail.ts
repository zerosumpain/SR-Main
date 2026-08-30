// The activity detail page's rules, as pure functions.
//
// Everything the redesigned /health/activities/[id] shows that is not simply a
// field read off `ActivityDetail` / `ActivityPhysio` is derived here: the hero
// stat cells, the zone table, the split table, the same-sport comparisons, the
// pace ramp's range, and every sentence of the page's editorial copy.
//
// The copy is COMPUTED, never model-written (spec hard constraint 5, 2026-08-30).
// It reads like prose because the templates are written as prose and the
// numbers are spelled out, not because anything phrased it. That keeps the page
// free of an LLM call on a route that must render for the owner in one hop, and
// it means the sentences can be asserted in a test.
//
// Three rules the helpers exist to keep:
//
//  1. THE TRAILING SPLIT IS REPORTED, NEVER ROUNDED UP. `computeSplits` already
//     returns the true `distanceM` with the pace extrapolated to a full km. The
//     table's job is to say so — `ext` on the pace, its own tint — and never to
//     recompute either number.
//
//  2. A CONDITIONAL FIGURE IS ABSENT, NOT ZERO. TRIMP, EF, HRR60 and METs all
//     go null often. Every builder below drops the cell rather than printing a
//     zero, so a thin outing renders a shorter grid instead of a wrong one.
//
//  3. COMPARISONS ARE AGAINST THE ATHLETE'S OWN MEDIANS. `physio.typical` is a
//     same-sport median over the last n outings; below three of them there is
//     no comparison to make and the panel does not render.
import type { ActivityDetail } from '$lib/trails/activities-service';
import type { ActivityPhysio } from '$lib/trails/physio-service';
import type { Split, TrackPoint } from '$lib/trails/track';
import type { ZoneSeconds } from '$lib/health/analytics/hr-zones';
import { formatDuration, formatPace, isPaceSport } from '$lib/trails/format';

// ——— small words ————————————————————————————————————————————————
//
// The design's editorial voice spells numbers out ("Thirty-two beats off in the
// first minute"), so the copy builders need words rather than numerals.

const UNITS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** `32` → `thirty-two`. Outside 0–99 the numeral is the honest answer. */
export function spell(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const v = Math.round(Math.abs(n));
  if (v < 20) return UNITS[v];
  if (v > 99) return String(v);
  const tens = TENS[Math.floor(v / 10)];
  const unit = v % 10;
  return unit ? `${tens}-${UNITS[unit]}` : tens;
}

/** Sentence case for a spelled number opening a sentence. */
export function capitalise(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

/**
 * A percentage as the phrase a person would say. Used where the design writes
 * "nearly half" rather than "47.7%" — the exact figure is in the table beneath,
 * so the sentence is allowed to be the readable one.
 */
export function sharePhrase(pct: number): string {
  if (!Number.isFinite(pct)) return 'some';
  if (pct >= 92) return 'almost all of';
  if (pct >= 72) return 'most of';
  if (pct >= 62) return 'nearly two thirds of';
  if (pct >= 55) return 'over half';
  if (pct >= 45) return 'nearly half';
  if (pct >= 38) return 'over a third of';
  if (pct >= 28) return 'about a third of';
  if (pct >= 22) return 'about a quarter of';
  if (pct >= 12) return 'a sixth of';
  return 'a sliver of';
}

// ——— the date line ——————————————————————————————————————————————

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * `Monday 17 August 2026 · 18:04 · Europe/London`.
 *
 * Parsed by SPLITTING THE STRING, exactly as `formatLocalDate` does and for the
 * same reason: `startDateLocal` is already in the workout's own offset, so
 * putting it through a `Date` and back out through a local getter slides an
 * evening run into the next day. The weekday needs date arithmetic, which is
 * done in UTC on the parsed parts — no offset is applied either way, so the
 * calendar day cannot move.
 */
export function fullLocalDate(
  startDateLocal: string,
  startDate: number,
  timezone: string | null,
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec((startDateLocal ?? '').trim());
  if (!m) {
    const fallback = new Date(startDate * 1000).toLocaleString('en-GB', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'UTC',
    });
    return timezone ? `${fallback} · ${timezone}` : fallback;
  }
  const [, y, mo, d, h, mi] = m;
  const weekday = WEEKDAYS[new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDay()];
  const parts = [`${weekday} ${+d} ${MONTHS[+mo - 1]} ${y}`, `${h}:${mi}`];
  if (timezone) parts.push(timezone);
  return parts.join(' · ');
}

// ——— hero stat cells ————————————————————————————————————————————

export interface StatCell {
  key: string;
  label: string;
  /** The figure, in display type. */
  value: string;
  /** The unit suffix, set small and ghosted beside it. `null` for a bare number. */
  unit: string | null;
  /** Accent-on-dark: the two figures the design lights up. */
  lit?: boolean;
}

function metres(value: number | null | undefined): { value: string; unit: string } {
  return { value: Number.isFinite(value) ? String(Math.round(value as number)) : '—', unit: 'm' };
}

/**
 * The twelve cells across the dark header, in the design's order.
 *
 * Eight are always drawn — a walk with no heart rate still happened, and an em
 * dash says so. The last four are physiology and only appear when the figure
 * exists; that is what makes the grid's cell count vary between eight and
 * twelve, and why it cannot be a container-background hairline grid.
 */
export function heroStats(activity: ActivityDetail, physio: ActivityPhysio | null): StatCell[] {
  const pace = isPaceSport(activity.activityType);
  const distanceKm = activity.distanceM != null ? activity.distanceM / 1000 : null;

  const cells: StatCell[] = [
    {
      key: 'distance',
      label: 'Distance',
      value: distanceKm == null ? '—' : distanceKm.toFixed(distanceKm >= 100 ? 0 : 2),
      unit: distanceKm == null ? null : 'km',
    },
    {
      key: 'moving',
      label: 'Moving',
      value: formatDuration(activity.activeDurationS ?? activity.durationS),
      unit: null,
    },
    pace
      ? {
          key: 'pace',
          label: 'Avg pace',
          value: formatPace(activity.avgPaceSPerKm).replace(' /km', ''),
          unit: activity.avgPaceSPerKm ? '/km' : null,
        }
      : {
          key: 'pace',
          label: 'Avg speed',
          value: activity.avgPaceSPerKm ? (3600 / activity.avgPaceSPerKm).toFixed(1) : '—',
          unit: activity.avgPaceSPerKm ? 'km/h' : null,
        },
    { key: 'climb', label: 'Climb', ...metres(activity.elevationGainM) },
    { key: 'descent', label: 'Descent', ...metres(activity.elevationLossM) },
    {
      key: 'avghr',
      label: 'Avg HR',
      value: activity.avgHeartrate ? String(Math.round(activity.avgHeartrate)) : '—',
      unit: activity.avgHeartrate ? 'bpm' : null,
    },
    {
      key: 'maxhr',
      label: 'Max HR',
      value: activity.maxHeartrate ? String(Math.round(activity.maxHeartrate)) : '—',
      unit: activity.maxHeartrate ? 'bpm' : null,
    },
    {
      // The design labels this ENERGY and prints kJ, which is the stored unit
      // (`activeEnergyKj`) rather than a conversion — so the figure on screen
      // is the figure in the row.
      key: 'energy',
      label: 'Energy',
      value: activity.activeEnergyKj != null ? String(Math.round(activity.activeEnergyKj)) : '—',
      unit: activity.activeEnergyKj != null ? 'kJ' : null,
    },
  ];

  if (physio?.trimp != null) {
    cells.push({
      key: 'trimp',
      label: 'Load · TRIMP',
      value: String(Math.round(physio.trimp)),
      unit: null,
      lit: true,
    });
  }
  if (physio?.ef != null) {
    cells.push({ key: 'ef', label: 'Efficiency', value: physio.ef.toFixed(2), unit: null });
  }
  if (physio?.hrr60 != null) {
    cells.push({
      key: 'hrr60',
      label: 'HRR 1 min',
      value: `−${Math.round(physio.hrr60)}`,
      unit: 'bpm',
      lit: true,
    });
  }
  if (physio?.mets != null) {
    cells.push({
      key: 'mets',
      label: 'Intensity',
      value: physio.mets.toFixed(1),
      unit: 'METs',
    });
  }

  return cells;
}

// ——— the route's pace ramp ——————————————————————————————————————

/**
 * The pace range the map's colour ramp actually spans, as seconds per km.
 *
 * The same 5th/95th percentile bounds `TrackMap` uses to build the ramp, so the
 * legend under the map is describing the trace above it rather than the fastest
 * and slowest GPS artefacts on it. Returns null when there is nothing to span.
 */
export function paceRange(
  coordinates: TrackPoint[] | null | undefined,
): { slowSPerKm: number; fastSPerKm: number } | null {
  if (!coordinates || coordinates.length < 3) return null;
  // A TrackPoint is [lng, lat, ele, t] — longitude FIRST. Same equirectangular
  // step and the same 5th/95th percentile bounds `TrackMap.paceColours` uses,
  // because the legend has to describe the ramp that is actually drawn.
  const R = 6371008.8;
  const speeds: number[] = [];
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1];
    const b = coordinates[i];
    const dt = b[3] - a[3];
    if (!(dt > 0)) continue;
    const dLat = ((b[1] - a[1]) * Math.PI) / 180;
    const dLng = ((b[0] - a[0]) * Math.PI) / 180;
    const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
    const x = dLng * Math.cos(lat);
    const speed = (Math.sqrt(x * x + dLat * dLat) * R) / dt;
    if (speed > 0) speeds.push(speed);
  }
  if (speeds.length < 2) return null;
  speeds.sort((a, b) => a - b);
  const lo = speeds[Math.floor(speeds.length * 0.05)];
  const hi = speeds[Math.floor(speeds.length * 0.95)];
  if (!(lo > 0) || !(hi > 0)) return null;
  return { slowSPerKm: 1000 / lo, fastSPerKm: 1000 / hi };
}

// ——— heart-rate zones ————————————————————————————————————————————

export interface ZoneRow {
  key: keyof ZoneSeconds;
  label: string;
  /** `< 93`, `93–111`, `167+` — the absolute bpm band. */
  range: string;
  seconds: number;
  pct: number;
  /** The zone this outing spent most of itself in. */
  lead: boolean;
}

/** Six rows, always six: an empty zone is a zero, not a missing column. */
export function zoneRows(zones: ZoneSeconds, edges: number[]): ZoneRow[] {
  const total = zones.z0 + zones.z1 + zones.z2 + zones.z3 + zones.z4 + zones.z5;
  const ranges = [
    `< ${edges[0]}`,
    `${edges[0]}–${edges[1] - 1}`,
    `${edges[1]}–${edges[2] - 1}`,
    `${edges[2]}–${edges[3] - 1}`,
    `${edges[3]}–${edges[4] - 1}`,
    `${edges[4]}+`,
  ];
  const keys: Array<keyof ZoneSeconds> = ['z0', 'z1', 'z2', 'z3', 'z4', 'z5'];
  let leadKey: keyof ZoneSeconds = 'z0';
  for (const k of keys) if (zones[k] > zones[leadKey]) leadKey = k;

  return keys.map((key, i) => ({
    key,
    label: `Z${i}`,
    range: ranges[i],
    seconds: zones[key],
    pct: total > 0 ? (zones[key] / total) * 100 : 0,
    lead: total > 0 && key === leadKey,
  }));
}

/**
 * Two sentences about where the effort actually sat: which zone held it, and
 * how much of it went above the aerobic band.
 */
export function zonesNote(rows: ZoneRow[]): string {
  const lead = rows.find((r) => r.lead);
  if (!lead) return '';
  const aboveZ4 = rows[5].pct;
  const easy = rows[0].pct + rows[1].pct + rows[2].pct;

  // "and n percent went above it" is nonsense when the lead zone IS the top
  // one — Z5 has nothing above it — so that clause is only added below Z5.
  const first =
    lead.key === 'z5'
      ? `${capitalise(sharePhrase(lead.pct))} this outing sat in Z5, the top band there is.`
      : `${capitalise(sharePhrase(lead.pct))} this outing sat in ${lead.label}${
          aboveZ4 >= 1
            ? `, and ${spell(Math.round(aboveZ4))} percent went above Z4`
            : ', and nothing went above Z4'
        }.`;

  const second =
    lead.pct >= 40 && (lead.key === 'z4' || lead.key === 'z5')
      ? 'A session shaped like this is where a week’s hard share gets spent, which is why the easy days either side of it are the ones that need protecting.'
      : easy >= 70
        ? 'That is an easy day by the zone definition, and easy days are the ones a training block is mostly made of.'
        : 'The zone edges are fractions of HRmax, so every band above moves with the figure in this section’s header rather than with the effort.';

  return `${first} ${second}`;
}

// ——— splits ——————————————————————————————————————————————————————

/** A full kilometre, within GPS rounding. Below this the row is the trailing one. */
const FULL_SPLIT_M = 995;

/** Below this the trailing split's extrapolated pace is not trusted to scale. */
const TRUSTED_TRAILING_M = 200;

export interface SplitRow {
  index: number;
  distanceM: number;
  durationS: number;
  /** Already extrapolated to a full km by `computeSplits` for a partial row. */
  paceSPerKm: number;
  elevationGainM: number;
  /** The trailing part-kilometre: reported, tinted, and suffixed `ext`. */
  partial: boolean;
  fastest: boolean;
  biggestClimb: boolean;
  /** 0–100. Longer bar = more time per kilometre. */
  relative: number;
}

/**
 * The split table's rows.
 *
 * The RELATIVE bar is proportional to pace against the slowest FULL split, and
 * deliberately NOT stretched between the fastest and slowest. That
 * normalisation makes a set of splits one second apart fill the whole column as
 * though it were a collapse; proportional bars stay honest. The trailing split
 * is measured on the same scale and clamped, because its pace is an
 * extrapolation and would otherwise set the scale for every real kilometre.
 *
 * `fastest` looks at full splits only, for the same reason.
 */
export function splitRows(splits: Split[]): SplitRow[] {
  if (!splits.length) return [];
  const full = splits.filter((s) => s.distanceM >= FULL_SPLIT_M);
  // The trailing split's pace is an extrapolation, and the shorter the fragment
  // the wilder it can be — a 12 m tail read as a full kilometre would squash
  // every real bar on the table. Above 200 m the extrapolation is worth
  // trusting, so it joins the scale; below it, only the full kilometres do.
  const trusted = splits.filter((s) => s.distanceM >= TRUSTED_TRAILING_M);
  const scaleSet = trusted.length ? trusted : full.length ? full : splits;
  const scale = Math.max(...scaleSet.map((s) => s.paceSPerKm));
  const rankable = full.length ? full : splits;
  const fastestPace = Math.min(...rankable.map((s) => s.paceSPerKm));
  const biggestClimb = Math.max(...splits.map((s) => s.elevationGainM ?? 0));

  let fastestTaken = false;
  let climbTaken = false;
  return splits.map((s) => {
    const partial = s.distanceM < FULL_SPLIT_M;
    const isFastest = !partial && !fastestTaken && s.paceSPerKm === fastestPace;
    if (isFastest) fastestTaken = true;
    const isBiggest = !climbTaken && biggestClimb > 0 && (s.elevationGainM ?? 0) === biggestClimb;
    if (isBiggest) climbTaken = true;
    return {
      index: s.index,
      distanceM: s.distanceM,
      durationS: s.durationS,
      paceSPerKm: s.paceSPerKm,
      elevationGainM: s.elevationGainM ?? 0,
      partial,
      fastest: isFastest,
      biggestClimb: isBiggest,
      relative:
        scale > 0 ? Math.max(6, Math.min(100, (s.paceSPerKm / scale) * 100)) : 0,
    };
  });
}

/**
 * What the split table is actually showing: whether pace on this outing is
 * reading the legs or reading the gradient.
 */
export function splitsNote(rows: SplitRow[]): string {
  const full = rows.filter((r) => !r.partial);
  if (full.length < 3) return '';
  const fastest = full.reduce((a, b) => (b.paceSPerKm < a.paceSPerKm ? b : a));
  const slowest = full.reduce((a, b) => (b.paceSPerKm > a.paceSPerKm ? b : a));
  const flattest = full.reduce((a, b) => (b.elevationGainM < a.elevationGainM ? b : a));
  const steepest = full.reduce((a, b) => (b.elevationGainM > a.elevationGainM ? b : a));
  if (fastest.index === slowest.index) return '';

  const gradientReads =
    fastest.index === flattest.index || slowest.index === steepest.index;

  const first =
    `Split ${fastest.index} is the quickest${fastest.index === flattest.index ? ' and the flattest' : ''}; ` +
    `split ${slowest.index} is the slowest${slowest.index === steepest.index ? ' and the steepest' : ''}.`;

  const second = gradientReads
    ? 'Pace here is a reading of the gradient rather than of the legs — which is why the segment placings below are the useful measure and the splits are not.'
    : 'Pace holds across the climb, so these splits are describing the effort rather than the ground under it.';

  return `${first} ${second}`;
}

// ——— effort and recovery ————————————————————————————————————————

export interface Comparison {
  label: string;
  text: string;
  /** `good` prints olive, `cost` prints accent, `flat` stays in body ink. */
  tone: 'good' | 'cost' | 'flat';
}

/**
 * This outing against the athlete's own same-sport medians — never a population
 * norm. Null below three comparable outings, where a median means nothing.
 */
export function comparisons(
  activity: ActivityDetail,
  physio: ActivityPhysio | null,
): { rows: Comparison[]; n: number } | null {
  if (!physio || physio.typical.n < 3) return null;
  const t = physio.typical;
  const pace = isPaceSport(activity.activityType);
  const rows: Comparison[] = [];

  if (activity.avgPaceSPerKm && t.paceSPerKm) {
    const pct = Math.round(((t.paceSPerKm - activity.avgPaceSPerKm) / t.paceSPerKm) * 100);
    rows.push({
      label: pace ? 'Pace' : 'Speed',
      text: pct === 0 ? 'level' : `${Math.abs(pct)}% ${pct > 0 ? 'faster' : 'slower'}`,
      tone: pct === 0 ? 'flat' : pct > 0 ? 'good' : 'cost',
    });
  }
  if (activity.avgHeartrate && t.avgHr) {
    const diff = Math.round(activity.avgHeartrate - t.avgHr);
    rows.push({
      label: 'Heart rate',
      text: diff === 0 ? 'level' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)} bpm`,
      // More beats for the same work is a cost, fewer is a gain.
      tone: diff === 0 ? 'flat' : diff > 0 ? 'cost' : 'good',
    });
  }
  if (physio.ef != null && t.ef) {
    const pct = Math.round(((physio.ef - t.ef) / t.ef) * 100);
    rows.push({
      label: 'Efficiency',
      text: pct === 0 ? 'level' : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`,
      tone: pct === 0 ? 'flat' : pct > 0 ? 'good' : 'cost',
    });
  }

  return rows.length ? { rows, n: t.n } : null;
}

/** The paragraph under the comparison rows — what the three of them add up to. */
export function comparisonNote(rows: Comparison[]): string {
  const gains = rows.filter((r) => r.tone === 'good').length;
  const costs = rows.filter((r) => r.tone === 'cost').length;
  const lead =
    gains > costs
      ? 'More of this outing went the right way than the wrong way against the same-sport median.'
      : costs > gains
        ? 'This one cost more than the same-sport median gave back.'
        : 'This outing sits on the same-sport median in both directions.';
  return `${lead} Compared against the athlete’s own medians, never a population norm.`;
}

/** Thirty-two beats off in the first minute — and what that band means. */
export function hrrNote(hrr60: number | null | undefined): string {
  if (hrr60 == null || !Number.isFinite(hrr60)) return '';
  const drop = Math.round(hrr60);
  const first = `${capitalise(spell(drop))} beats off in the first minute.`;
  const second =
    drop >= 30
      ? 'Above thirty is the healthy band for a trained aerobic system, and it is one of the few readings here that does not depend on the training block being thick.'
      : drop >= 20
        ? 'Twenty to thirty is the ordinary band; below twenty is where a tired or under-recovered autonomic system usually shows up first.'
        : 'Under twenty beats is where fatigue, heat or a short recovery window usually shows up first — one reading is not a trend, but a run of them is.';
  return `${first} ${second}`;
}

/** The decoupling figure, read out. */
export function decouplingNote(pct: number | null | undefined, activeS: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '';
  const held = pct <= 5;
  const across = activeS ? ` across ${formatDuration(activeS)} of work` : '';
  return held
    ? `Pace-per-beat held to the end. Over about 5% suggests the aerobic base ran out; this stayed under it${across}.`
    : `The second half cost more beats per metre than the first. Over about 5% suggests the aerobic base ran out, and this one went past it${across}.`;
}

// ——— provenance ——————————————————————————————————————————————————

/**
 * What the row says about itself: whose type this is, and what the load figure
 * was computed from. Both matter — a TRIMP from an average heart rate
 * under-reads an interval session, and the reader cannot tell without being
 * told.
 */
export function provenanceNote(
  activity: ActivityDetail,
  physio: ActivityPhysio | null,
  label: (type: string) => string,
): string {
  const parts: string[] = [];
  if (activity.typeOverride) {
    parts.push(
      `The watch called this a ${label(activity.sourceType).toLowerCase()}; it is filed as a ` +
        `${label(activity.activityType).toLowerCase()} because that correction was made here, and ` +
        'the next sync cannot undo it.',
    );
  } else {
    parts.push(
      `The type here came straight from the source — a ${label(
        activity.activityType,
      ).toLowerCase()}, uncorrected.`,
    );
  }
  if (physio?.trimpBasis === 'series') {
    parts.push(
      'Load is computed from the heart-rate series rather than the average, which matters: a ' +
        'TRIMP taken off an average heart rate under-reads an interval session.',
    );
  } else if (physio?.trimpBasis === 'average') {
    parts.push(
      'There is no usable heart-rate series on this one, so load is computed from the average ' +
        'instead — which under-reads an interval session and over-reads a steady one.',
    );
  }
  return parts.join(' ');
}

// ——— series geometry ————————————————————————————————————————————

/**
 * Bucket-average a series down to `count` points.
 *
 * A 1 Hz heart-rate series over forty minutes is ~2,400 points; drawn straight
 * it is a solid band of ink, and taking every nth sample keeps the spikes and
 * loses the shape. Averaging inside each bucket keeps the shape and drops the
 * spikes, which is what the design's traces are drawn as.
 */
export function resample(points: Array<[number, number]>, count: number): Array<[number, number]> {
  if (points.length <= count || count < 2) return points;
  const first = points[0][0];
  const last = points[points.length - 1][0];
  const span = last - first;
  if (!(span > 0)) return points;

  const sums = new Array(count).fill(0);
  const ns = new Array(count).fill(0);
  for (const [x, y] of points) {
    const slot = Math.min(count - 1, Math.floor(((x - first) / span) * count));
    sums[slot] += y;
    ns[slot] += 1;
  }
  const out: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    if (!ns[i]) continue;
    out.push([first + ((i + 0.5) / count) * span, sums[i] / ns[i]]);
  }
  return out.length >= 2 ? out : points;
}

/** `0:00` / `20:39` / `41:18` — the x-axis of a time trace. */
export function timeAxis(points: Array<[number, number]>): string[] {
  if (points.length < 2) return [];
  const last = points[points.length - 1][0];
  return ['0:00', formatDuration(last / 2), formatDuration(last)];
}

/** `0 km` / `3.1 km` / `6.2 km` — the x-axis of the elevation trace. */
export function distanceAxis(points: Array<[number, number]>): string[] {
  if (points.length < 2) return [];
  const last = points[points.length - 1][0];
  return ['0 km', `${(last / 2000).toFixed(1)} km`, `${(last / 1000).toFixed(1)} km`];
}

/**
 * The value of a series at `x`, linearly interpolated between its neighbours.
 *
 * The heart-rate recovery curve is not sampled on a tidy grid — the watch
 * returns whatever it returned — so the 60-second marker has to be found rather
 * than indexed. Null outside the curve's own span: extrapolating a recovery
 * curve past its end would invent the one number the panel exists to show.
 */
export function interpolate(points: Array<[number, number]>, x: number): number | null {
  if (points.length < 2) return null;
  if (x < points[0][0] || x > points[points.length - 1][0]) return null;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (x <= x1) {
      const span = x1 - x0;
      return span > 0 ? y0 + ((x - x0) / span) * (y1 - y0) : y1;
    }
  }
  return points[points.length - 1][1];
}

/** Mean of a series' values — the dashed line across the heart-rate trace. */
export function meanOf(points: Array<[number, number]>): number | null {
  if (!points.length) return null;
  let sum = 0;
  for (const p of points) sum += p[1];
  return sum / points.length;
}
