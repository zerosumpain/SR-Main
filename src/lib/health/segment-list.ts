// The segments explorer's rules, as pure functions.
//
// The sibling of activity-list.ts, and deliberately the same shape: the whole
// corpus ships once and every control on the page is a pass over it, seeded
// from the URL so a dashboard deep link lands pre-filtered. What differs is
// what a row IS. An activity happened once; a segment is a piece of GROUND you
// have been over repeatedly, so the interesting columns are not the outing's
// measurements but the trend across them — which way it is going, how far the
// recent best sits behind the record, and how long that record has stood.
//
// Five rules the helpers exist to keep:
//
//  1. THE TAXONOMY IS THE DASHBOARD'S. `formTaxonomy` is the one place the
//     improving / holding / slipping / no-read counts are derived, and section
//     F of /health imports it rather than counting again. Two surfaces
//     describing the same corpus with two implementations is how they end up
//     printing different numbers for the same day.
//
//  2. `gapPct` IS A FRACTION. `segmentForm` returns (recentBest − pb) / pb, so
//     everything gettable sits between 0 and 0.03. Rendered without the ×100 it
//     printed "0.0%" on every row — the bug fixed on the dashboard board in
//     PR #591, and the reason `gapPercent()` exists here rather than a bare
//     multiply at each call site.
//
//  3. FORM IS A TIME DELTA, SO NEGATIVE IS GOOD. `deltaPct` is the change in
//     the recent window's median duration. Sorting it ascending puts the
//     segments you are gaining most on at the top, which is why FORM's first
//     click is ascending and DIST's is descending.
//
//  4. PACE, EF AND COST ONLY COMPARE WITHIN ONE SPORT. A bike returns more
//     metres for the same heartbeat, so a mixed column sorted by efficiency
//     ranks the machine rather than the effort — measured here, the rides run
//     1.2–2.4 against a run's 1.15. With a single type selected the set is one
//     sport; without one, those three columns rank over the pace sports only
//     and everything else sinks. Same partition activity-list applies, decided
//     one level up because a segment carries its sport rather than its EF being
//     nulled at source.
//
//  5. UNDER SIX EFFORTS THERE IS NO FORM. `MIN_EFFORTS_FOR_FORM` is a floor,
//     not a preference: at four efforts the "earlier" median is a single
//     effort. Those rows are not filtered out — they are most of a several
//     hundred segment corpus — they read as dashes.
import {
  GETTABLE_GAP_PCT,
  MIN_EFFORTS_FOR_FORM,
  type FormDirection,
  type SegmentForm,
} from '$lib/trails/segments/form';
import type { SegmentTerrain } from '$lib/trails/segments/naming';
import { activityLabel, isPaceSport } from '$lib/trails/format';
import { nullsSinkComparator, type ListSort } from '$lib/health/list-sort';
import {
  encodeRange,
  formatRange,
  parseRange,
  type NumericRange,
} from '$lib/health/activity-list';

// The range parsing, the render window and the popover placement are list
// machinery rather than activity machinery, and activity-list already owns
// them with tests. Re-exported so a caller wiring the segments page reaches for
// one module, exactly as activity-list re-exports $lib/health/popover.
export { rowWindow, ROWS_PER_PAGE, parseRange, encodeRange, formatRange } from '$lib/health/activity-list';
export type { NumericRange, RowWindow } from '$lib/health/activity-list';

export type ColumnKey =
  | 'name'
  | 'type'
  | 'distance'
  | 'climb'
  | 'gradient'
  | 'efforts'
  | 'best'
  | 'pace'
  | 'ef'
  | 'cost'
  | 'form'
  | 'gap'
  | 'staleness'
  | 'last';

export type NumericColumnKey =
  | 'distance'
  | 'climb'
  | 'gradient'
  | 'efforts'
  | 'best'
  | 'pace'
  | 'ef'
  | 'cost'
  | 'form'
  | 'gap'
  | 'staleness'
  | 'last';

export interface ColumnDef {
  key: ColumnKey;
  /** The long name, used in filter chips. */
  label: string;
  /** The heading, which has a table to fit thirteen of them into. */
  short: string;
  kind: 'text' | 'number';
  /** Unit a range filter is typed in — the unit `numericValue` reads. */
  unit?: string;
  align: 'left' | 'right';
  /**
   * Which way the FIRST click sorts. Not a blanket "text ascending, numbers
   * descending" like the activity ledger: on this page every column has an
   * interesting end, and it is not always the big one. Closest to a PB, most
   * improving and quickest are all ascending, and putting the 40%-off segments
   * on top of a column called GAP would be a list nobody asked for.
   */
  first: 'asc' | 'desc';
  hint: string;
}

export const COLUMNS: ColumnDef[] = [
  {
    key: 'name',
    label: 'Name',
    short: 'Ground',
    kind: 'text',
    align: 'left',
    first: 'asc',
    hint: 'The name generated from the geometry’s own seed — stable across rebuilds, so nothing you have learned gets renamed',
  },
  {
    key: 'type',
    label: 'Type',
    short: 'Type',
    kind: 'text',
    align: 'left',
    first: 'asc',
    hint: 'The sport the segment was matched within. Ground covered on foot and on wheels is two segments, not one',
  },
  {
    key: 'distance',
    label: 'Distance',
    short: 'Dist',
    kind: 'number',
    unit: 'km',
    align: 'right',
    first: 'desc',
    hint: 'Length of the matched stretch. Nothing under 500 m becomes a segment',
  },
  {
    key: 'climb',
    label: 'Climb',
    short: 'Climb',
    kind: 'number',
    unit: 'm',
    align: 'right',
    first: 'desc',
    hint: 'Total ascent over the stretch',
  },
  {
    key: 'gradient',
    label: 'Gradient',
    short: 'Grad',
    kind: 'number',
    unit: '%',
    align: 'right',
    first: 'desc',
    hint: 'Net rise over run. A descent reads negative, and the sort ranks by steepness either way',
  },
  {
    key: 'efforts',
    label: 'Efforts',
    short: 'Efforts',
    kind: 'number',
    unit: 'count',
    align: 'right',
    first: 'desc',
    hint: 'How many times this ground has been covered. Six is the floor a form read needs',
  },
  {
    key: 'best',
    label: 'Best time',
    short: 'Best',
    kind: 'number',
    unit: 's',
    align: 'right',
    first: 'asc',
    hint: 'The quickest single effort on record',
  },
  {
    key: 'pace',
    label: 'Best pace',
    short: 'Pace',
    kind: 'number',
    unit: 'min/km',
    align: 'right',
    first: 'asc',
    hint: 'Pace of the best effort — shown as speed for the wheeled sports. Ranks within one sport only',
  },
  {
    key: 'ef',
    label: 'Efficiency',
    short: 'EF',
    kind: 'number',
    unit: 'm/min/bpm',
    align: 'right',
    first: 'desc',
    hint: 'Metres per minute per beat, best effort. Ranks within one sport only — a ride’s sits near 4 against a run’s 1',
  },
  {
    key: 'cost',
    label: 'Cost',
    short: 'b/km',
    kind: 'number',
    unit: 'beats/km',
    align: 'right',
    first: 'asc',
    hint: 'Heartbeats spent per kilometre on the best effort — lower is cheaper. Ranks within one sport only, for the same reason efficiency does',
  },
  {
    key: 'form',
    label: 'Form',
    short: 'Form',
    kind: 'number',
    unit: '%',
    align: 'left',
    first: 'asc',
    hint: 'Recent median time against the window before it. The number is a duration, so negative is quicker — ascending puts the ground you are gaining on at the top',
  },
  {
    key: 'gap',
    label: 'Gap to PB',
    short: 'Gap',
    kind: 'number',
    unit: '%',
    align: 'right',
    first: 'asc',
    hint: 'How far the best of the last three sits behind the all-time best, as a percentage of it',
  },
  {
    key: 'staleness',
    label: 'PB age',
    short: 'PB age',
    kind: 'number',
    unit: 'd',
    align: 'right',
    first: 'desc',
    hint: 'Days from the record to today, not to the last effort — an old record on ground you still cover is the catchable kind',
  },
  {
    key: 'last',
    label: 'Last effort',
    short: 'Last',
    kind: 'number',
    align: 'right',
    first: 'desc',
    hint: 'When this ground was last covered',
  },
];

/** The order the columns are rendered in. Reordering here reorders the table. */
export const TABLE_ORDER: ColumnKey[] = [
  'name',
  'type',
  'distance',
  'climb',
  'gradient',
  'efforts',
  'best',
  'pace',
  'ef',
  'cost',
  'form',
  'gap',
  'staleness',
  'last',
];

/**
 * The columns a URL may carry a `min..max` range for.
 *
 * NOT every numeric column. A range is only meaningful where the filter and
 * the cell can be typed in the SAME unit — `best` is a duration whose cell says
 * `4m12s`, and `last` is a timestamp whose cell says `13d ago`, so a `best=..90`
 * in the address bar would filter in a unit nobody can see. Both still sort;
 * they simply cannot be ranged. Everything here is a plain number in the unit
 * its `ColumnDef` names.
 */
export const RANGE_COLUMNS: NumericColumnKey[] = [
  'distance',
  'climb',
  'gradient',
  'efforts',
  'form',
  'gap',
  'staleness',
];

export const COLUMN_LABELS: Record<ColumnKey, string> = Object.fromEntries(
  COLUMNS.map((c) => [c.key, c.label]),
) as Record<ColumnKey, string>;

const NUMERIC_UNITS: Record<string, string> = Object.fromEntries(
  RANGE_COLUMNS.map((k) => [k, COLUMNS.find((c) => c.key === k)?.unit ?? '']),
);

export function columnDef(key: ColumnKey): ColumnDef {
  return COLUMNS.find((c) => c.key === key) as ColumnDef;
}

/**
 * The columns' worth of a segment — everything the helpers below read.
 *
 * Structural rather than the imported `SegmentListRow`, so the loader's row
 * (which adds `shortDescriptor`) and a test's two-field fixture both satisfy
 * it without either one having to know about the other.
 */
export interface SegmentTableRow {
  id: number;
  name: string;
  activityType: string;
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  effortCount: number;
  lastEffortAt: number | null;
  terrain: SegmentTerrain;
  gradientPct: number;
  offroad: boolean;
  bests: {
    durationS: number | null;
    paceSPerKm: number | null;
    efficiencyFactor: number | null;
    beatsPerKm: number | null;
  };
  form: SegmentForm;
}

export type SortState = ListSort<ColumnKey>;

// --- the form taxonomy ----------------------------------------------------

export interface SegmentTaxonomy {
  improving: number;
  holding: number;
  slipping: number;
  /** Under the six-effort floor, or too few in the earlier window to read. */
  noRead: number;
  total: number;
  /** Rows with any direction at all — the denominator the three states share. */
  withForm: number;
  /** Improving AND inside `GETTABLE_GAP_PCT` of the record. */
  gettable: number;
}

/**
 * The four form states, counted once.
 *
 * THE ONE DERIVATION. /health's section F reads this and so does the explorer,
 * so the tiles on the two pages cannot drift apart — which they would the first
 * time somebody "tidied" one of two copies. `noRead` is measured against the
 * WHOLE set rather than by counting `direction === 'unknown'`, so the four
 * numbers always add up to `total` even if a fifth direction is ever added.
 */
export function formTaxonomy(rows: readonly { form: SegmentForm }[]): SegmentTaxonomy {
  let improving = 0;
  let holding = 0;
  let slipping = 0;
  let gettable = 0;
  for (const row of rows) {
    switch (row.form.direction) {
      case 'improving':
        improving += 1;
        if (row.form.gapPct != null && row.form.gapPct < GETTABLE_GAP_PCT) gettable += 1;
        break;
      case 'holding':
        holding += 1;
        break;
      case 'slipping':
        slipping += 1;
        break;
      default:
        break;
    }
  }
  const withForm = improving + holding + slipping;
  return {
    improving,
    holding,
    slipping,
    noRead: rows.length - withForm,
    total: rows.length,
    withForm,
    gettable,
  };
}

/**
 * Improving, and inside `GETTABLE_GAP_PCT` of its own record.
 *
 * THE SHIPPED TEST, not a wider one invented for the ledger: it is exactly what
 * `formTaxonomy` counts and what the dashboard's gettable board is built from,
 * so the row the explorer tints and the row the board lists are the same row.
 * Staleness is on the page as its own column because an old record is what
 * makes a segment worth attacking — but it is not a gate, and treating it as
 * one here would make this page disagree with the board.
 */
export function isGettable(row: { form: SegmentForm }): boolean {
  return row.form.direction === 'improving' && row.form.gapPct != null && row.form.gapPct < GETTABLE_GAP_PCT;
}

/** `1.8` from the 0.018 `segmentForm` stores. Never render `gapPct` raw. */
export function gapPercent(form: SegmentForm): number | null {
  return form.gapPct == null ? null : form.gapPct * 100;
}

/** A form read needs six efforts; below that the row shows dashes, not zeroes. */
export function hasFormRead(row: SegmentTableRow): boolean {
  return row.form.direction !== 'unknown';
}

/** Why a row has no form read, in the language SegmentFormSection uses. */
export function insufficientNote(row: SegmentTableRow): string {
  return row.effortCount < MIN_EFFORTS_FOR_FORM
    ? `${row.effortCount} effort${row.effortCount === 1 ? '' : 's'} — under the ${MIN_EFFORTS_FOR_FORM} a form read needs`
    : 'Too few in the earlier window for a median to mean anything';
}

// --- sorting --------------------------------------------------------------

/**
 * Whether pace, EF and cost are allowed to rank across the visible set.
 *
 * True when one sport is selected — the set is then internally comparable — or
 * for a pace-sport row when it is not, which ranks the run/walk/hike segments
 * against each other and sinks the wheels rather than letting them win.
 */
function comparable(row: SegmentTableRow, singleSport: boolean): boolean {
  return singleSport || isPaceSport(row.activityType);
}

/**
 * What a column sorts on. Strings compare as text, numbers as numbers, `null`
 * sinks — and a value that is not comparable across the current set is `null`
 * rather than a number that would out-rank everything (rule 4).
 */
export function sortValue(
  row: SegmentTableRow,
  key: ColumnKey,
  singleSport: boolean,
): number | string | null {
  switch (key) {
    case 'name':
      return row.name.toLowerCase();
    case 'type':
      return activityLabel(row.activityType).toLowerCase();
    case 'distance':
      return row.distanceM;
    case 'climb':
      return row.elevationGainM;
    case 'gradient':
      // Magnitude: with the Descents chip on, −15% is steeper than −0.5%.
      return Math.abs(row.gradientPct);
    case 'efforts':
      return row.effortCount;
    case 'best':
      return row.bests.durationS;
    case 'pace':
      return comparable(row, singleSport) ? row.bests.paceSPerKm : null;
    case 'ef':
      return comparable(row, singleSport) ? row.bests.efficiencyFactor : null;
    case 'cost':
      return comparable(row, singleSport) ? row.bests.beatsPerKm : null;
    case 'form':
      return row.form.deltaPct;
    case 'gap':
      return row.form.gapPct;
    case 'staleness':
      return row.form.daysSincePb;
    case 'last':
      return row.lastEffortAt;
  }
}

/**
 * The sortable, filterable number behind a numeric column IN THE UNIT ITS
 * FILTER IS TYPED IN — km rather than metres, a percentage rather than a
 * fraction. One function, so a `gap=..3` in the address bar and the figure
 * printed in the cell can never mean two different things.
 */
export function numericValue(row: SegmentTableRow, key: NumericColumnKey): number | null {
  switch (key) {
    case 'distance':
      return row.distanceM / 1000;
    case 'gap':
      return gapPercent(row.form);
    default: {
      const value = sortValue(row, key, true);
      return typeof value === 'number' ? value : null;
    }
  }
}

/** Busiest first, id as the tiebreak so the order is stable across renders. */
function byBusiest(a: SegmentTableRow, b: SegmentTableRow): number {
  return b.effortCount - a.effortCount || b.distanceM - a.distanceM || a.id - b.id;
}

export function buildComparator(
  sort: SortState | null,
  singleSport: boolean,
): (a: SegmentTableRow, b: SegmentTableRow) => number {
  return nullsSinkComparator<SegmentTableRow, ColumnKey>(
    sort,
    (row, key) => sortValue(row, key, singleSport),
    byBusiest,
  );
}

// --- filtering ------------------------------------------------------------

/** `unknown` is a filterable state: "show me what I cannot read yet". */
export const FORM_STATES: FormDirection[] = ['improving', 'holding', 'slipping', 'unknown'];
export const TERRAINS: SegmentTerrain[] = ['climb', 'descent', 'rolling', 'flat'];

export const FORM_LABELS: Record<FormDirection, string> = {
  improving: 'Improving',
  holding: 'Holding',
  slipping: 'Slipping',
  unknown: 'No form read',
};

export const TERRAIN_LABELS: Record<SegmentTerrain, string> = {
  climb: 'Climbs',
  descent: 'Descents',
  rolling: 'Rolling',
  flat: 'Flat',
};

export interface SegmentFilters {
  /** Empty means every type. */
  types: string[];
  terrains: SegmentTerrain[];
  forms: FormDirection[];
  /** Trail runs, MTB and hikes — the sports that only happen off the tarmac. */
  offroad: boolean;
  name: string;
  ranges: Record<NumericColumnKey, NumericRange>;
}

export function emptyRanges(): Record<NumericColumnKey, NumericRange> {
  const ranges = {} as Record<NumericColumnKey, NumericRange>;
  for (const key of RANGE_COLUMNS) ranges[key] = { min: null, max: null };
  return ranges;
}

export function emptyFilters(): SegmentFilters {
  return { types: [], terrains: [], forms: [], offroad: false, name: '', ranges: emptyRanges() };
}

/**
 * Every active filter, ANDed. An unknown value fails an active RANGE filter:
 * a segment with no form read cannot be shown to be "inside 3% of its PB", and
 * quietly including it would make the count above the table a lie.
 */
export function buildFilterPredicate(
  filters: SegmentFilters,
): (row: SegmentTableRow) => boolean {
  const name = filters.name.trim().toLowerCase();
  const types = new Set(filters.types);
  const terrains = new Set(filters.terrains);
  const forms = new Set(filters.forms);
  const activeRanges = RANGE_COLUMNS.filter((key) => {
    const range = filters.ranges[key];
    return !!range && (range.min != null || range.max != null);
  });

  return (row) => {
    if (types.size > 0 && !types.has(row.activityType)) return false;
    if (terrains.size > 0 && !terrains.has(row.terrain)) return false;
    if (forms.size > 0 && !forms.has(row.form.direction)) return false;
    if (filters.offroad && !row.offroad) return false;
    if (name && !row.name.toLowerCase().includes(name)) return false;

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

export function anyFilterActive(filters: SegmentFilters): boolean {
  return (
    filters.types.length > 0 ||
    filters.terrains.length > 0 ||
    filters.forms.length > 0 ||
    filters.offroad ||
    filters.name.trim().length > 0 ||
    RANGE_COLUMNS.some((key) => {
      const range = filters.ranges[key];
      return !!range && (range.min != null || range.max != null);
    })
  );
}

// --- counts ---------------------------------------------------------------

export interface FacetCount<T extends string> {
  value: T;
  label: string;
  count: number;
}

/**
 * Distinct types present IN THE LOADED ROWS with their counts. The service's
 * `types` array is an all-time group-by that ignores the row cap, so using it
 * as the chip counts would print a number the table cannot produce.
 */
export function countTypes(rows: readonly SegmentTableRow[]): FacetCount<string>[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.activityType, (counts.get(row.activityType) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: activityLabel(value), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function countTerrains(rows: readonly SegmentTableRow[]): FacetCount<SegmentTerrain>[] {
  const counts = new Map<SegmentTerrain, number>();
  for (const row of rows) counts.set(row.terrain, (counts.get(row.terrain) ?? 0) + 1);
  // Fixed order, not by frequency: these four are a scale from up to flat, and
  // a chip row that reshuffles itself when a filter moves is unusable.
  return TERRAINS.filter((t) => counts.has(t)).map((value) => ({
    value,
    label: TERRAIN_LABELS[value],
    count: counts.get(value) ?? 0,
  }));
}

export function countForms(rows: readonly SegmentTableRow[]): FacetCount<FormDirection>[] {
  const taxonomy = formTaxonomy(rows);
  const counts: Record<FormDirection, number> = {
    improving: taxonomy.improving,
    holding: taxonomy.holding,
    slipping: taxonomy.slipping,
    unknown: taxonomy.noRead,
  };
  return FORM_STATES.map((value) => ({ value, label: FORM_LABELS[value], count: counts[value] }));
}

export function countOffroad(rows: readonly SegmentTableRow[]): number {
  let n = 0;
  for (const row of rows) if (row.offroad) n += 1;
  return n;
}

// --- the URL --------------------------------------------------------------

const isTerrain = (v: string): v is SegmentTerrain => (TERRAINS as string[]).includes(v);
const isForm = (v: string): v is FormDirection => (FORM_STATES as string[]).includes(v);

/**
 * The sorts the page shipped with before the redesign, as (column, direction).
 *
 * The old explorer's sort was a named intent — `sort=gettable`, `sort=steepest`
 * — rather than a column. Those spellings are in bookmarks and in the address
 * bar of anyone who had the page open, and mapping them costs a dozen lines
 * against a filtered view silently becoming an unfiltered one.
 */
const LEGACY_SORTS: Record<string, SortState> = {
  efforts: { key: 'efforts', dir: 'desc' },
  improving: { key: 'form', dir: 'asc' },
  gettable: { key: 'gap', dir: 'asc' },
  climb: { key: 'climb', dir: 'desc' },
  steepest: { key: 'gradient', dir: 'desc' },
  longest: { key: 'distance', dir: 'desc' },
  fastest: { key: 'pace', dir: 'asc' },
  efficiency: { key: 'ef', dir: 'desc' },
  recent: { key: 'last', dir: 'desc' },
};

/**
 * Seed the state from the URL, validating every value against what is actually
 * here — a stale link's unknown type must land on the unfiltered view, not on
 * an inexplicably empty table.
 */
export function parseFilters(
  params: URLSearchParams,
  knownTypes: readonly string[],
): SegmentFilters {
  const filters = emptyFilters();
  const known = new Set(knownTypes);
  const list = (raw: string | null): string[] =>
    (raw ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0 && v !== 'all');

  filters.types = list(params.get('type')).filter((v) => known.has(v));
  // `terrain=offroad` was how the old page spelled the off-road toggle. It is
  // accepted here and written back as its own param, because off-road and
  // terrain are independent filters and must not fight over one key.
  const terrains = list(params.get('terrain'));
  filters.terrains = terrains.filter(isTerrain);
  filters.offroad = params.get('offroad') === '1' || terrains.includes('offroad');
  filters.forms = list(params.get('form')).filter(isForm);
  filters.name = params.get('q') ?? '';
  for (const key of RANGE_COLUMNS) filters.ranges[key] = parseRange(params.get(key));
  return filters;
}

export function parseSort(params: URLSearchParams): SortState | null {
  const key = params.get('sort');
  if (!key) return null;
  const legacy = LEGACY_SORTS[key];
  if (legacy) return legacy;
  const def = COLUMNS.find((c) => c.key === key);
  if (!def) return null;
  const dir = params.get('dir');
  return { key: def.key, dir: dir === 'asc' ? 'asc' : dir === 'desc' ? 'desc' : def.first };
}

/** Keep the address bar honest so a filtered view survives a copy-paste. */
export function filtersToQuery(filters: SegmentFilters, sort: SortState | null): string {
  const params = new URLSearchParams();
  if (filters.types.length > 0) params.set('type', filters.types.join(','));
  if (filters.terrains.length > 0) params.set('terrain', filters.terrains.join(','));
  if (filters.forms.length > 0) params.set('form', filters.forms.join(','));
  if (filters.offroad) params.set('offroad', '1');
  if (filters.name.trim()) params.set('q', filters.name.trim());
  for (const key of RANGE_COLUMNS) {
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
  /** Which filter the chip clears, and the one value it removes if it is one of many. */
  kind: 'type' | 'terrain' | 'form' | 'offroad' | 'name' | 'range';
  value?: string;
  label: string;
}

/**
 * Every active filter as a removable chip — except the three chip rows, which
 * draw themselves and would otherwise appear twice on the same line.
 */
export function describeFilters(filters: SegmentFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.name.trim()) {
    chips.push({ id: 'name', kind: 'name', label: `Name “${filters.name.trim()}”` });
  }
  for (const key of RANGE_COLUMNS) {
    const range = filters.ranges[key];
    if (!range || (range.min == null && range.max == null)) continue;
    chips.push({
      id: key,
      kind: 'range',
      value: key,
      label: `${COLUMN_LABELS[key]} ${formatRange(range)} ${NUMERIC_UNITS[key]}`.trim(),
    });
  }
  return chips;
}

/** Clear one filter, in place. Returns the same object. */
export function clearFilter(filters: SegmentFilters, chip: FilterChip): SegmentFilters {
  switch (chip.kind) {
    case 'type':
      filters.types = chip.value ? filters.types.filter((v) => v !== chip.value) : [];
      break;
    case 'terrain':
      filters.terrains = chip.value
        ? filters.terrains.filter((v) => v !== chip.value)
        : [];
      break;
    case 'form':
      filters.forms = chip.value
        ? filters.forms.filter((v) => v !== chip.value)
        : [];
      break;
    case 'offroad':
      filters.offroad = false;
      break;
    case 'name':
      filters.name = '';
      break;
    case 'range':
      if (chip.value) filters.ranges[chip.value as NumericColumnKey] = { min: null, max: null };
      break;
  }
  return filters;
}

/** Toggle one value in a multi-select facet — the chip rows' only behaviour. */
export function toggleFacet<T extends string>(current: T[], value: T | null): T[] {
  if (value == null) return [];
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
}
