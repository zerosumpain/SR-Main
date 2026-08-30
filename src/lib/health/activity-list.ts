// The activity ledger's rules, as pure functions.
//
// Lifted out of ActivityTable.svelte when the /health redesign replaced that
// component (2026-08-30). Nothing here changed in the move: these are the
// semantics the list has always had, and activity-list.test.ts asserts them
// line for line. What went was the 1,200 lines of markup around them.
//
// Every heading sorts, every row carries its one excellent thing, and a bad
// recording can be taken out of segment analysis without leaving the list.
//
// The whole list ships once and everything below is a pass over it — the
// shape /health/segments already uses. Three rules the helpers exist to keep:
//
//  1. NULLS SINK, THEY DO NOT VANISH. A walk with no heart rate still
//     happened, so it sorts to the bottom in BOTH directions rather than
//     dropping out of the table. (An active *filter* is different: a row
//     whose value is unknown cannot be shown to match "over 10 km", so it
//     fails that filter.)
//
//  2. TYPE COUNTS COME FROM THE LOADED ROWS. `listActivities().types` is an
//     all-time group-by that ignores every filter; using it as the checkbox
//     counts would print "Run 412" next to a 30-row table.
//
//  3. EF IS A PACE-SPORT NUMBER. The service already nulls it outside
//     run/trail_run/hike/walk — a ride's sits near 4 against a run's 1 — so
//     the column sorts rides to the bottom instead of to the top.
import type { ActivityListRow } from '$lib/trails/activities-service';
import {
  clampTo,
  placePopover,
  POP_WIDTH,
  POP_EST_HEIGHT,
  type PopoverPlacement,
} from '$lib/health/popover';
import type { Highlight } from '$lib/trails/highlights';
import { activityLabel } from '$lib/trails/format';
import { localDay } from '$lib/trails/activity-meta';

export type ColumnKey =
  | 'date'
  | 'type'
  | 'name'
  | 'distance'
  | 'time'
  | 'pace'
  | 'climb'
  | 'hr'
  | 'temp'
  | 'ef'
  | 'segments'
  | 'excellence';

export type NumericColumnKey =
  | 'distance'
  | 'time'
  | 'pace'
  | 'climb'
  | 'hr'
  | 'temp'
  | 'ef'
  | 'segments';

export type ColumnKind = 'date' | 'type' | 'text' | 'number';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  kind: ColumnKind;
  /** Unit the FILTER inputs are typed in — the same unit `numericValue` reads. */
  unit?: string;
  align: 'left' | 'right';
  ascLabel: string;
  descLabel: string;
  hint: string;
}

export const COLUMNS: ColumnDef[] = [
  {
    key: 'date',
    label: 'Date',
    kind: 'date',
    align: 'left',
    ascLabel: 'Oldest first',
    descLabel: 'Newest first',
    hint: 'The local day the workout was lived, not the server day',
  },
  {
    key: 'type',
    label: 'Type',
    kind: 'type',
    align: 'left',
    ascLabel: 'A → Z',
    descLabel: 'Z → A',
    hint: 'The effective sport — the owner’s correction where there is one',
  },
  {
    key: 'name',
    label: 'Name',
    kind: 'text',
    align: 'left',
    ascLabel: 'A → Z',
    descLabel: 'Z → A',
    hint: 'What the workout was called on the phone',
  },
  {
    key: 'distance',
    label: 'Distance',
    kind: 'number',
    unit: 'km',
    align: 'right',
    ascLabel: 'Shortest first',
    descLabel: 'Longest first',
    hint: 'Ground covered',
  },
  {
    key: 'time',
    label: 'Time',
    kind: 'number',
    unit: 'min',
    align: 'right',
    ascLabel: 'Shortest first',
    descLabel: 'Longest first',
    hint: 'Moving time where the watch reported it, otherwise elapsed',
  },
  {
    key: 'pace',
    label: 'Pace',
    kind: 'number',
    unit: 'min/km',
    align: 'right',
    ascLabel: 'Fastest first',
    descLabel: 'Slowest first',
    hint: 'Shown as pace for run, trail run, hike and walk and as speed for everything else. Filtered in min/km either way — 4.0 min/km is 15.0 km/h',
  },
  {
    key: 'climb',
    label: 'Climb',
    kind: 'number',
    unit: 'm',
    align: 'right',
    ascLabel: 'Flattest first',
    descLabel: 'Hilliest first',
    hint: 'Total ascent',
  },
  {
    key: 'hr',
    label: 'Avg HR',
    kind: 'number',
    unit: 'bpm',
    align: 'right',
    ascLabel: 'Lowest first',
    descLabel: 'Highest first',
    hint: 'Average heart rate over the workout',
  },
  {
    key: 'temp',
    label: 'Temp',
    kind: 'number',
    unit: '°C',
    align: 'right',
    ascLabel: 'Coldest first',
    descLabel: 'Hottest first',
    hint: 'Ambient temperature the phone recorded, normalised to °C',
  },
  {
    key: 'ef',
    label: 'EF',
    kind: 'number',
    unit: 'm/min/bpm',
    align: 'right',
    ascLabel: 'Worst first',
    descLabel: 'Best first',
    hint: 'Efficiency factor — metres per minute per beat. Pace sports only, so rides are blank and sort to the bottom',
  },
  {
    key: 'segments',
    label: 'Segments',
    kind: 'number',
    unit: 'count',
    align: 'right',
    ascLabel: 'Fewest first',
    descLabel: 'Most first',
    hint: 'How many known segments this outing crossed',
  },
  {
    key: 'excellence',
    label: 'Excellence',
    kind: 'text',
    align: 'left',
    ascLabel: 'Quietest first',
    descLabel: 'Loudest first',
    hint: 'The single best thing about the outing. Search matches the badge and its supporting line',
  },
];

/**
 * The order the twelve columns are RENDERED in, and the short heading each one
 * wears there. Kept apart from `COLUMNS` on purpose: `label` is the long name
 * used in filter chips and panel headings ("Distance 5–20 km" has to say
 * Distance), while the table head has 1,240px to fit twelve of them into and
 * says DIST. Reordering here reorders the table and nothing else — the query
 * string, the filter chips and the range parsing all key off `NUMERIC_COLUMNS`.
 */
export const TABLE_ORDER: ColumnKey[] = [
  'date',
  'name',
  'type',
  'distance',
  'time',
  'climb',
  'hr',
  'pace',
  'ef',
  'temp',
  'segments',
  'excellence',
];

export const SHORT_LABELS: Record<ColumnKey, string> = {
  date: 'Date',
  name: 'Outing',
  type: 'Type',
  distance: 'Dist',
  time: 'Moving',
  climb: 'Climb',
  hr: 'HR · max',
  pace: 'Pace',
  ef: 'EF',
  temp: 'Temp',
  segments: 'Segs',
  excellence: 'Excellence',
};

/**
 * Which column a highlight is ABOUT, so the ledger can light that one cell.
 * "Hottest outing ever" and a bold 26.4° in the TEMP column are the same fact
 * said twice: the badge says which, the cell says where. A kind with no column
 * of its own — a streak, a percentile, the biggest burn — lights nothing.
 */
export const HIGHLIGHT_COLUMN: Record<string, NumericColumnKey> = {
  record_distance: 'distance',
  record_duration: 'time',
  record_climb: 'climb',
  record_pace: 'pace',
  vs_typical_pace: 'pace',
  most_efficient: 'ef',
  vs_typical_ef: 'ef',
  segment_ef: 'ef',
  hottest: 'temp',
  coldest: 'temp',
  segment_rank: 'segments',
  segment_bpk: 'segments',
  back_to_back: 'segments',
};

export const NUMERIC_COLUMNS: NumericColumnKey[] = [
  'distance',
  'time',
  'pace',
  'climb',
  'hr',
  'temp',
  'ef',
  'segments',
];

export const COLUMN_LABELS: Record<ColumnKey, string> = Object.fromEntries(
  COLUMNS.map((c) => [c.key, c.label]),
) as Record<ColumnKey, string>;

export const NUMERIC_UNITS: Record<NumericColumnKey, string> = Object.fromEntries(
  NUMERIC_COLUMNS.map((k) => [k, COLUMNS.find((c) => c.key === k)?.unit ?? '']),
) as Record<NumericColumnKey, string>;

/** The columns' worth of a row — everything the pure helpers below read. */
export type FilterableRow = Pick<
  ActivityListRow,
  | 'id'
  | 'name'
  | 'activityType'
  | 'startDate'
  | 'startDateLocal'
  | 'distanceM'
  | 'durationS'
  | 'activeDurationS'
  | 'elevationGainM'
  | 'avgHeartrate'
  | 'avgPaceSPerKm'
  | 'temperatureC'
  | 'efficiencyFactor'
  | 'segmentCount'
> & { highlight: Highlight | null };

/** A loaded row with its lead highlight attached. */
export interface ActivityTableRow extends ActivityListRow {
  highlight: Highlight | null;
}

export interface NumericRange {
  min: number | null;
  max: number | null;
}

export interface ActivityFilters {
  /** Inclusive local-day bounds, `YYYY-MM-DD`. */
  from: string | null;
  to: string | null;
  /** Empty means every type. */
  types: string[];
  name: string;
  excellence: string;
  ranges: Record<NumericColumnKey, NumericRange>;
}

export interface SortState {
  key: ColumnKey;
  dir: 'asc' | 'desc';
}

export function emptyRanges(): Record<NumericColumnKey, NumericRange> {
  const ranges = {} as Record<NumericColumnKey, NumericRange>;
  for (const key of NUMERIC_COLUMNS) ranges[key] = { min: null, max: null };
  return ranges;
}

export function emptyFilters(): ActivityFilters {
  return { from: null, to: null, types: [], name: '', excellence: '', ranges: emptyRanges() };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A day bound is only a bound if it is actually a day. Anything else is off. */
export function validDay(value: string | null | undefined): string | null {
  const day = (value ?? '').trim();
  return DAY_RE.test(day) ? day : null;
}

function num(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The sortable, filterable number behind a numeric column, IN THE UNIT ITS
 * FILTER IS TYPED IN. One function so the min/max box and the comparator can
 * never disagree about what 10 meant.
 */
export function numericValue(row: FilterableRow, key: NumericColumnKey): number | null {
  switch (key) {
    case 'distance': {
      const m = num(row.distanceM);
      return m == null ? null : m / 1000;
    }
    case 'time': {
      const s = num(row.activeDurationS) ?? num(row.durationS);
      return s == null || s <= 0 ? null : s / 60;
    }
    case 'pace': {
      // Stored as seconds per km for every sport; the ride column merely
      // renders it as km/h. Filtering the stored number keeps one dial.
      const s = num(row.avgPaceSPerKm);
      return s == null || s <= 0 ? null : s / 60;
    }
    case 'climb':
      return num(row.elevationGainM);
    case 'hr': {
      const bpm = num(row.avgHeartrate);
      return bpm == null || bpm <= 0 ? null : bpm;
    }
    case 'temp':
      return num(row.temperatureC);
    case 'ef':
      return num(row.efficiencyFactor);
    case 'segments':
      return num(row.segmentCount) ?? 0;
  }
}

/** What a column sorts on. Strings compare as text, numbers as numbers. */
export function sortValue(row: FilterableRow, key: ColumnKey): number | string | null {
  switch (key) {
    case 'date':
      return num(row.startDate);
    case 'type':
      return activityLabel(row.activityType).toLowerCase();
    case 'name':
      return (row.name ?? '').toLowerCase();
    case 'excellence':
      // Weight is the ranker's own "how loud is this", so descending really
      // does put the best outings on top.
      return row.highlight ? row.highlight.weight : null;
    default:
      return numericValue(row, key);
  }
}

/** Newest first, id as the tiebreak so the order is stable across renders. */
function byRecency(a: FilterableRow, b: FilterableRow): number {
  return b.startDate - a.startDate || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * One active sort at a time. Rows with no value in the sorted column sink to
 * the bottom in BOTH directions — reversing the sort must not promote the
 * blanks to the top, and it must never hide them.
 */
export function buildComparator(
  sort: SortState | null,
): (a: FilterableRow, b: FilterableRow) => number {
  if (!sort) return byRecency;
  const dir = sort.dir === 'asc' ? 1 : -1;
  return (a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va == null && vb == null) return byRecency(a, b);
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp =
      typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb) : Number(va) - Number(vb);
    return cmp * dir || byRecency(a, b);
  };
}

/**
 * Every active filter, ANDed. An unknown value fails an active filter: a row
 * with no heart rate cannot be shown to be "over 150 bpm", and quietly
 * including it would make the count above the table a lie.
 */
export function buildFilterPredicate(
  filters: ActivityFilters,
): (row: FilterableRow) => boolean {
  const name = filters.name.trim().toLowerCase();
  const excellence = filters.excellence.trim().toLowerCase();
  const types = new Set(filters.types);
  const from = validDay(filters.from);
  const to = validDay(filters.to);
  const activeRanges = NUMERIC_COLUMNS.filter((key) => {
    const range = filters.ranges[key];
    return !!range && (range.min != null || range.max != null);
  });

  return (row) => {
    if (types.size > 0 && !types.has(row.activityType)) return false;

    if (from || to) {
      // Local day from the string the phone sent — never through a Date, or
      // an evening run slides into the next day on a UTC server.
      const day = localDay(row.startDateLocal);
      if (!day) return false;
      if (from && day < from) return false;
      if (to && day > to) return false;
    }

    if (name && !(row.name ?? '').toLowerCase().includes(name)) return false;

    if (excellence) {
      const highlight = row.highlight;
      if (!highlight) return false;
      const haystack = `${highlight.label} ${highlight.detail}`.toLowerCase();
      if (!haystack.includes(excellence)) return false;
    }

    for (const key of activeRanges) {
      const value = numericValue(row, key);
      if (value == null) return false;
      const range = filters.ranges[key];
      if (range.min != null && value < range.min) return false;
      if (range.max != null && value > range.max) return false;
    }

    return true;
  };
}

export interface TypeCount {
  activityType: string;
  label: string;
  count: number;
}

/**
 * Distinct types present IN THE LOADED ROWS with their counts. The service's
 * `types` array is an all-time group-by over the whole table and would print
 * counts that do not match anything on screen.
 */
export function countTypes(rows: FilterableRow[]): TypeCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.activityType, (counts.get(row.activityType) ?? 0) + 1);
  return [...counts.entries()]
    .map(([activityType, count]) => ({ activityType, label: activityLabel(activityType), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export interface FilteredTotals {
  count: number;
  distanceM: number;
  durationS: number;
  elevationGainM: number;
}

/**
 * The strip above the table, recomputed from what is on screen. The server's
 * totals are an aggregate over the whole set and stop matching the moment a
 * filter moves.
 */
export function totalsOf(rows: FilterableRow[]): FilteredTotals {
  let distanceM = 0;
  let durationS = 0;
  let elevationGainM = 0;
  for (const row of rows) {
    distanceM += num(row.distanceM) ?? 0;
    durationS += num(row.durationS) ?? 0;
    elevationGainM += num(row.elevationGainM) ?? 0;
  }
  return { count: rows.length, distanceM, durationS, elevationGainM };
}

export function formatRange(range: NumericRange): string {
  if (range.min != null && range.max != null) return `${range.min}–${range.max}`;
  if (range.min != null) return `≥ ${range.min}`;
  if (range.max != null) return `≤ ${range.max}`;
  return '';
}

export function encodeRange(range: NumericRange): string | null {
  if (range.min == null && range.max == null) return null;
  return `${range.min ?? ''}..${range.max ?? ''}`;
}

/**
 * `2..10`, `..10`, `2..`. Anything else — including half a range that is not
 * a number — falls back to unfiltered rather than to a filter nobody typed.
 */
export function parseRange(raw: string | null | undefined): NumericRange {
  const off: NumericRange = { min: null, max: null };
  if (!raw) return off;
  const parts = raw.split('..');
  if (parts.length !== 2) return off;
  const side = (text: string): { ok: boolean; value: number | null } => {
    const trimmed = text.trim();
    if (!trimmed) return { ok: true, value: null };
    const value = Number(trimmed);
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, value: null };
  };
  const min = side(parts[0]);
  const max = side(parts[1]);
  if (!min.ok || !max.ok) return off;
  if (min.value == null && max.value == null) return off;
  return { min: min.value, max: max.value };
}

/**
 * Seed the state from the URL, validating every value against what is
 * actually here — a stale link's unknown type must land on the unfiltered
 * view, not an inexplicably empty table.
 */
export function parseFilters(
  params: URLSearchParams,
  knownTypes: readonly string[],
): ActivityFilters {
  const filters = emptyFilters();
  filters.from = validDay(params.get('from'));
  filters.to = validDay(params.get('to'));
  const known = new Set(knownTypes);
  filters.types = (params.get('type') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value !== 'all' && known.has(value));
  filters.name = params.get('q') ?? '';
  filters.excellence = params.get('x') ?? '';
  for (const key of NUMERIC_COLUMNS) filters.ranges[key] = parseRange(params.get(key));
  return filters;
}

export function parseSort(params: URLSearchParams): SortState | null {
  const key = params.get('sort');
  if (!key || !COLUMNS.some((column) => column.key === key)) return null;
  return { key: key as ColumnKey, dir: params.get('dir') === 'asc' ? 'asc' : 'desc' };
}

/** Keep the address bar honest so a filtered view survives a copy-paste. */
export function filtersToQuery(filters: ActivityFilters, sort: SortState | null): string {
  const params = new URLSearchParams();
  const from = validDay(filters.from);
  const to = validDay(filters.to);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (filters.types.length > 0) params.set('type', filters.types.join(','));
  if (filters.name.trim()) params.set('q', filters.name.trim());
  if (filters.excellence.trim()) params.set('x', filters.excellence.trim());
  for (const key of NUMERIC_COLUMNS) {
    const encoded = encodeRange(filters.ranges[key]);
    if (encoded) params.set(key, encoded);
  }
  if (sort) {
    params.set('sort', sort.key);
    params.set('dir', sort.dir);
  }
  return params.toString();
}

export interface FilterChip {
  id: string;
  column: ColumnKey;
  /** Set only for the per-type chips, which remove one value not the column. */
  value?: string;
  label: string;
}

/** Every active filter as a removable chip. Empty means nothing is filtered. */
export function describeFilters(filters: ActivityFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  const from = validDay(filters.from);
  const to = validDay(filters.to);
  if (from || to) {
    chips.push({
      id: 'date',
      column: 'date',
      label: `Date ${from ?? 'any'} → ${to ?? 'any'}`,
    });
  }
  for (const type of filters.types) {
    chips.push({ id: `type:${type}`, column: 'type', value: type, label: `Type ${activityLabel(type)}` });
  }
  if (filters.name.trim()) {
    chips.push({ id: 'name', column: 'name', label: `Name “${filters.name.trim()}”` });
  }
  for (const key of NUMERIC_COLUMNS) {
    const range = filters.ranges[key];
    if (!range || (range.min == null && range.max == null)) continue;
    chips.push({
      id: key,
      column: key,
      label: `${COLUMN_LABELS[key]} ${formatRange(range)} ${NUMERIC_UNITS[key]}`.trim(),
    });
  }
  if (filters.excellence.trim()) {
    chips.push({
      id: 'excellence',
      column: 'excellence',
      label: `Excellence “${filters.excellence.trim()}”`,
    });
  }
  return chips;
}

export function isColumnFiltered(filters: ActivityFilters, key: ColumnKey): boolean {
  switch (key) {
    case 'date':
      return validDay(filters.from) != null || validDay(filters.to) != null;
    case 'type':
      return filters.types.length > 0;
    case 'name':
      return filters.name.trim().length > 0;
    case 'excellence':
      return filters.excellence.trim().length > 0;
    default: {
      const range = filters.ranges[key];
      return !!range && (range.min != null || range.max != null);
    }
  }
}

// --- popover placement ----------------------------------------------------
// Both panels are position:fixed — an absolute panel inside the table's
// overflow-x scroller is a panel with its bottom half clipped — so nothing
// keeps them on screen but placePopover. A row 900 deep in the list has its
// trigger near the bottom of the viewport: anchoring blindly below it put the
// panel under the fold, and scrolling to reach it closed it, which made the
// corrections unreachable for most of the table.
//
// It lives in $lib/health/popover so the activity detail page can place the
// same corrections menu without importing the ledger. Re-exported here so
// activity-list.test.ts keeps one import for the whole contract.
export {
  placePopover,
  clampTo,
  POP_WIDTH,
  POP_GAP,
  POP_MARGIN,
  POP_MIN_HEIGHT,
  POP_EST_HEIGHT,
} from '$lib/health/popover';
export type { AnchorRect, ViewportSize, PopoverPlacement } from '$lib/health/popover';

// --- how many rows actually render ----------------------------------------
// 1,136 rows is ~15,000 cells server-rendered and hydrated on every load, so
// the table renders a page at a time. FILTERING, SORTING AND THE TOTALS STILL
// RUN OVER THE WHOLE SET — the cap is a render budget, never a data budget,
// and the count below the table says so out loud.

export const ROWS_PER_PAGE = 100;

export interface RowWindow {
  /** How many rows are actually rendered. */
  shown: number;
  /** How many rows match the filters — what the totals strip describes. */
  matching: number;
  /** How many matching rows are still held back. */
  remaining: number;
  /** How many the next "show more" would add. */
  nextStep: number;
}

export function rowWindow(cap: number, matching: number, step = ROWS_PER_PAGE): RowWindow {
  const shown = clampTo(Math.floor(cap), 0, Math.max(0, matching));
  const remaining = Math.max(0, matching - shown);
  return { shown, matching, remaining, nextStep: Math.min(Math.max(1, step), remaining) };
}

/** Clear one column's filter, in place. Returns the same object. */
export function clearColumnFilter(filters: ActivityFilters, key: ColumnKey): ActivityFilters {
  switch (key) {
    case 'date':
      filters.from = null;
      filters.to = null;
      break;
    case 'type':
      filters.types = [];
      break;
    case 'name':
      filters.name = '';
      break;
    case 'excellence':
      filters.excellence = '';
      break;
    default:
      filters.ranges[key] = { min: null, max: null };
  }
  return filters;
}
