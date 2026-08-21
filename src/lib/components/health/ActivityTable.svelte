<script module lang="ts">
  // The owner's activity table: every header filters and sorts, every row
  // carries its one excellent thing, and a bad recording can be taken out of
  // segment analysis without leaving the list.
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
</script>

<script lang="ts">
  import { replaceState } from '$app/navigation';
  import HighlightBadge from './HighlightBadge.svelte';
  import { ACTIVITY_TYPES, effectiveType, formatTemperature } from '$lib/trails/activity-meta';
  import { efficiencyFactor } from '$lib/health/analytics/efficiency';
  import {
    activityLabel as label,
    formatDistance,
    formatDuration,
    formatElevation,
    formatHeartrate,
    formatLocalDate,
    formatPace,
    formatSpeed,
    isPaceSport,
  } from '$lib/trails/format';

  let {
    rows,
    highlights = {},
    initialQuery = '',
    basePath = '/health/activities',
  }: {
    rows: ActivityListRow[];
    highlights?: Record<string, Highlight | undefined>;
    /** The page's `url.search`, so a deep link lands filtered on first paint. */
    initialQuery?: string;
    basePath?: string;
  } = $props();

  interface RowOverride {
    activityType: string;
    sourceType: string;
    typeOverride: string | null;
    excludedFromSegments: boolean;
  }

  // A correction is applied here rather than by mutating `data.rows`: the load
  // payload is a plain object, so mutating it would change nothing on screen.
  let overrides = $state<Record<string, RowOverride>>({});

  const tableRows = $derived.by((): ActivityTableRow[] =>
    rows.map((row) => {
      const override = overrides[row.id];
      if (!override) return { ...row, highlight: highlights[row.id] ?? null };
      const merged = { ...row, ...override };
      return {
        ...merged,
        // EF is a pace-sport number, so correcting a ride to a run has to
        // recompute it — otherwise the column stays blank until a reload.
        efficiencyFactor: isPaceSport(merged.activityType)
          ? efficiencyFactor(
              merged.distanceM,
              merged.activeDurationS ?? merged.durationS,
              merged.avgHeartrate,
            )
          : null,
        highlight: highlights[row.id] ?? null,
      };
    }),
  );

  // Seeded ONCE from the URL, like /health/segments: after first paint the
  // controls own the state and `replaceState` writes it back, so re-reading the
  // props here would fight the user.
  // svelte-ignore state_referenced_locally
  const seed = new URLSearchParams(
    initialQuery.startsWith('?') ? initialQuery.slice(1) : initialQuery,
  );
  // svelte-ignore state_referenced_locally
  let filters = $state<ActivityFilters>(
    parseFilters(
      seed,
      rows.map((row) => row.activityType),
    ),
  );
  let sort = $state<SortState | null>(parseSort(seed));

  const typeCounts = $derived(countTypes(tableRows));
  const filtered = $derived(tableRows.filter(buildFilterPredicate(filters)));
  const sorted = $derived([...filtered].sort(buildComparator(sort)));
  const chips = $derived(describeFilters(filters));
  const totals = $derived(totalsOf(filtered));

  function syncUrl() {
    const query = filtersToQuery(filters, sort);
    replaceState(query ? `?${query}` : basePath, {});
  }

  // --- popovers -------------------------------------------------------------
  // Both panels are position:fixed and anchored off the trigger's rect. The
  // table scrolls sideways, and an absolutely positioned popover inside an
  // overflow-x container is a popover with its bottom half cut off.

  const POP_WIDTH = 300;

  let openColumn = $state<ColumnKey | null>(null);
  let openMenu = $state<string | null>(null);
  let popPos = $state<{ left: number; top: number } | null>(null);
  let menuPos = $state<{ left: number; top: number } | null>(null);

  const openColumnDef = $derived(COLUMNS.find((column) => column.key === openColumn) ?? null);
  const openRow = $derived(tableRows.find((row) => row.id === openMenu) ?? null);

  function anchorOf(event: MouseEvent): { left: number; top: number } {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POP_WIDTH - 8));
    return { left, top: rect.bottom + 4 };
  }

  function toggleColumn(key: ColumnKey, event: MouseEvent) {
    openMenu = null;
    if (openColumn === key) {
      openColumn = null;
      return;
    }
    popPos = anchorOf(event);
    openColumn = key;
  }

  function toggleMenu(id: string, event: MouseEvent) {
    openColumn = null;
    if (openMenu === id) {
      openMenu = null;
      return;
    }
    menuPos = anchorOf(event);
    openMenu = id;
    note = null;
  }

  function closeAll() {
    openColumn = null;
    openMenu = null;
  }

  function onWindowPointerDown(event: PointerEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('[data-col-pop]')) openColumn = null;
    if (!target.closest('[data-row-menu]')) openMenu = null;
  }

  function onWindowKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeAll();
  }

  // --- filter editing -------------------------------------------------------

  function setSort(key: ColumnKey, dir: 'asc' | 'desc') {
    sort = { key, dir };
    openColumn = null;
    syncUrl();
  }

  function clearSort() {
    sort = null;
    syncUrl();
  }

  function toggleType(type: string) {
    filters.types = filters.types.includes(type)
      ? filters.types.filter((value) => value !== type)
      : [...filters.types, type];
    syncUrl();
  }

  function setDay(which: 'from' | 'to', value: string) {
    filters[which] = value ? value : null;
    syncUrl();
  }

  function setBound(key: NumericColumnKey, which: 'min' | 'max', value: string) {
    const trimmed = value.trim();
    const parsed = trimmed === '' ? null : Number(trimmed);
    const bound = parsed != null && Number.isFinite(parsed) ? parsed : null;
    const current = filters.ranges[key];
    const next: NumericRange = { min: current.min, max: current.max };
    if (which === 'min') next.min = bound;
    else next.max = bound;
    filters.ranges[key] = next;
    syncUrl();
  }

  function setText(key: 'name' | 'excellence', value: string) {
    filters[key] = value;
    syncUrl();
  }

  function clearColumn(key: ColumnKey) {
    clearColumnFilter(filters, key);
    if (sort?.key === key) sort = null;
    syncUrl();
  }

  function removeChip(chip: FilterChip) {
    if (chip.column === 'type' && chip.value) {
      filters.types = filters.types.filter((value) => value !== chip.value);
    } else {
      clearColumnFilter(filters, chip.column);
    }
    syncUrl();
  }

  function clearAll() {
    filters = emptyFilters();
    sort = null;
    syncUrl();
  }

  // --- row corrections ------------------------------------------------------

  let savingId = $state<string | null>(null);
  let note = $state<{ id: string; kind: 'ok' | 'error'; text: string } | null>(null);

  async function patchRow(
    row: ActivityTableRow,
    patch: { excludedFromSegments?: boolean; typeOverride?: string | null },
  ) {
    if (savingId) return;
    savingId = row.id;
    note = null;
    try {
      const res = await fetch(`/api/trails/activities/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            error?: string;
            effortsRemoved?: number;
            activity?: {
              activityType: string;
              typeOverride: string | null;
              excludedFromSegments: boolean;
            };
          }
        | null;

      // Never leave the table showing a change the server refused: the row is
      // only rewritten from the row the server sent back.
      if (!res.ok || !body?.activity) {
        note = { id: row.id, kind: 'error', text: body?.error ?? `Update refused (${res.status}).` };
        return;
      }

      const saved = body.activity;
      overrides = {
        ...overrides,
        [row.id]: {
          activityType: effectiveType(saved),
          sourceType: saved.activityType,
          typeOverride: saved.typeOverride,
          excludedFromSegments: saved.excludedFromSegments,
        },
      };
      const cleared =
        typeof body.effortsRemoved === 'number'
          ? `, ${body.effortsRemoved} effort${body.effortsRemoved === 1 ? '' : 's'} cleared`
          : '';
      note = {
        id: row.id,
        kind: 'ok',
        text: `Saved. Segment rebuild scheduled${cleared}. Excellence badges refresh on reload.`,
      };
    } catch (err) {
      note = { id: row.id, kind: 'error', text: (err as Error)?.message ?? 'Update failed.' };
    } finally {
      savingId = null;
    }
  }

  function paceCell(row: ActivityTableRow): string {
    return isPaceSport(row.activityType) ? formatPace(row.avgPaceSPerKm) : formatSpeed(row.avgPaceSPerKm);
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeyDown} onscroll={closeAll} />

<section class="nm-sec totals">
  <div class="stat">
    <span class="stat-value">{totals.count}</span>
    <span class="sr-label-tight">{chips.length > 0 ? 'Shown' : 'Activities'}</span>
  </div>
  <div class="stat">
    <span class="stat-value">{formatDistance(totals.distanceM)}</span>
    <span class="sr-label-tight">Distance</span>
  </div>
  <div class="stat">
    <span class="stat-value">{formatDuration(totals.durationS)}</span>
    <span class="sr-label-tight">Moving</span>
  </div>
  <div class="stat">
    <span class="stat-value">{formatElevation(totals.elevationGainM)}</span>
    <span class="sr-label-tight">Climbed</span>
  </div>
  {#if chips.length > 0}
    <div class="stat">
      <span class="stat-value">{tableRows.length}</span>
      <span class="sr-label-tight">Loaded</span>
    </div>
  {/if}
</section>

{#if chips.length > 0}
  <div class="chips" aria-label="Active filters">
    <span class="sr-label-tight">Filters</span>
    {#each chips as chip (chip.id)}
      <button type="button" class="chip" onclick={() => removeChip(chip)}>
        {chip.label}<span class="x" aria-hidden="true">×</span>
        <span class="sr-only">remove filter</span>
      </button>
    {/each}
    <button type="button" class="chip clear-all" onclick={clearAll}>Clear all</button>
  </div>
{/if}

<div class="scroller">
  <table class="activity-table">
    <thead>
      <tr>
        {#each COLUMNS as column (column.key)}
          <th
            scope="col"
            class:num={column.align === 'right'}
            class:active={sort?.key === column.key}
          >
            <button
              type="button"
              class="col-btn"
              data-col-pop
              title={column.hint}
              aria-haspopup="dialog"
              aria-expanded={openColumn === column.key}
              onclick={(event) => toggleColumn(column.key, event)}
            >
              <span class="col-label">{column.label}</span>
              {#if sort?.key === column.key}
                <span class="dir" aria-hidden="true">{sort.dir === 'asc' ? '↑' : '↓'}</span>
              {/if}
              {#if isColumnFiltered(filters, column.key)}
                <span class="dot" aria-hidden="true">•</span>
              {/if}
              <span class="sr-only">
                — sort and filter{sort?.key === column.key
                  ? `, sorted ${sort.dir === 'asc' ? 'ascending' : 'descending'}`
                  : ''}{isColumnFiltered(filters, column.key) ? ', filtered' : ''}
              </span>
            </button>
          </th>
        {/each}
        <th scope="col" class="actions-hd"><span class="sr-only">Row actions</span></th>
      </tr>
    </thead>
    <tbody>
      {#each sorted as row (row.id)}
        <tr
          data-activity-id={row.id}
          class:excluded={row.excludedFromSegments}
          class:open={openMenu === row.id}
        >
          <td class="when">{formatLocalDate(row.startDateLocal, row.startDate)}</td>
          <td class="type">
            <span class="type-tag">{label(row.activityType)}</span>
            {#if row.typeOverride}
              <span class="flag" title="Corrected from {label(row.sourceType)}">corrected</span>
            {/if}
          </td>
          <th scope="row" class="name">
            <a href="{basePath}/{encodeURIComponent(row.id)}" data-activity-row>{row.name}</a>
            {#if row.excludedFromSegments}
              <span class="flag" title="Left out of segment analysis">excluded</span>
            {/if}
          </th>
          <td class="num">{formatDistance(row.distanceM)}</td>
          <td class="num">{formatDuration(row.activeDurationS ?? row.durationS)}</td>
          <td class="num">{paceCell(row)}</td>
          <td class="num">{formatElevation(row.elevationGainM)}</td>
          <td class="num">{formatHeartrate(row.avgHeartrate)}</td>
          <td class="num">{formatTemperature(row.temperatureC)}</td>
          <td class="num">{row.efficiencyFactor == null ? '—' : row.efficiencyFactor.toFixed(2)}</td>
          <td class="num">{row.segmentCount > 0 ? row.segmentCount : '—'}</td>
          <td class="exc">
            {#if row.highlight}
              <HighlightBadge highlight={row.highlight} size="sm" />
            {:else}
              <span class="blank">—</span>
            {/if}
          </td>
          <td class="actions">
            <button
              type="button"
              class="menu-btn"
              data-row-menu
              aria-haspopup="dialog"
              aria-expanded={openMenu === row.id}
              aria-label="Actions for {row.name}"
              onclick={(event) => toggleMenu(row.id, event)}
            >
              ···
            </button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

{#if sorted.length === 0}
  <section class="nm-sec empty">
    <p class="empty-title">Nothing matches these filters.</p>
    <button type="button" class="btn" onclick={clearAll}>Clear all filters</button>
  </section>
{/if}

<p class="foot-note">
  {sorted.length} of {tableRows.length} loaded {tableRows.length === 1 ? 'activity' : 'activities'}.
  Every heading sorts and filters. Blanks always sink to the bottom of a sort — an outing with no
  heart rate still happened. Efficiency factor is a pace-sport measure, so rides and swims are
  blank by design.
</p>

{#if openColumnDef && popPos}
  {@const col = openColumnDef}
  <div
    class="pop"
    data-col-pop
    role="dialog"
    aria-label="{col.label} — sort and filter"
    style="left: {popPos.left}px; top: {popPos.top}px; width: {POP_WIDTH}px"
  >
    <div class="pop-hd">
      <span class="sr-label-tight">{col.label}</span>
      <button type="button" class="pop-x" aria-label="Close" onclick={() => (openColumn = null)}>×</button>
    </div>
    <p class="pop-hint">{col.hint}</p>

    <div class="pop-sorts">
      <button
        type="button"
        class="pop-btn"
        class:on={sort?.key === col.key && sort.dir === 'asc'}
        onclick={() => setSort(col.key, 'asc')}
      >
        ↑ {col.ascLabel}
      </button>
      <button
        type="button"
        class="pop-btn"
        class:on={sort?.key === col.key && sort.dir === 'desc'}
        onclick={() => setSort(col.key, 'desc')}
      >
        ↓ {col.descLabel}
      </button>
    </div>

    {#if col.kind === 'date'}
      <div class="pop-fields">
        <label class="field">
          <span class="sr-label-tight">From</span>
          <input
            type="date"
            value={filters.from ?? ''}
            oninput={(event) => setDay('from', event.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span class="sr-label-tight">To</span>
          <input
            type="date"
            value={filters.to ?? ''}
            oninput={(event) => setDay('to', event.currentTarget.value)}
          />
        </label>
      </div>
    {:else if col.kind === 'type'}
      <ul class="pop-types">
        {#each typeCounts as type (type.activityType)}
          <li>
            <label class="check">
              <input
                type="checkbox"
                checked={filters.types.includes(type.activityType)}
                onchange={() => toggleType(type.activityType)}
              />
              <span class="check-label">{type.label}</span>
              <span class="check-count">{type.count}</span>
            </label>
          </li>
        {/each}
      </ul>
    {:else if col.kind === 'number'}
      {@const key = col.key as NumericColumnKey}
      <div class="pop-fields">
        <label class="field">
          <span class="sr-label-tight">Min ({col.unit})</span>
          <input
            type="number"
            step="any"
            value={filters.ranges[key].min ?? ''}
            onchange={(event) => setBound(key, 'min', event.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span class="sr-label-tight">Max ({col.unit})</span>
          <input
            type="number"
            step="any"
            value={filters.ranges[key].max ?? ''}
            onchange={(event) => setBound(key, 'max', event.currentTarget.value)}
          />
        </label>
      </div>
    {:else}
      {@const key = col.key === 'excellence' ? 'excellence' : 'name'}
      <label class="field">
        <span class="sr-label-tight">Contains</span>
        <input
          type="text"
          value={filters[key]}
          placeholder={key === 'excellence' ? 'e.g. fastest' : 'e.g. morning'}
          oninput={(event) => setText(key, event.currentTarget.value)}
        />
      </label>
    {/if}

    <div class="pop-foot">
      <button type="button" class="pop-btn" onclick={() => clearColumn(col.key)}>
        Clear this column
      </button>
      {#if sort}
        <button type="button" class="pop-btn quiet" onclick={clearSort}>Clear sort</button>
      {/if}
    </div>
  </div>
{/if}

{#if openRow && menuPos}
  {@const target = openRow}
  <div
    class="pop menu"
    data-row-menu
    role="dialog"
    aria-label="Corrections for {target.name}"
    style="left: {menuPos.left}px; top: {menuPos.top}px; width: {POP_WIDTH}px"
  >
    <div class="pop-hd">
      <span class="sr-label-tight">Correct this recording</span>
      <button type="button" class="pop-x" aria-label="Close" onclick={() => (openMenu = null)}>×</button>
    </div>

    <button
      type="button"
      class="pop-btn wide"
      disabled={savingId === target.id}
      onclick={() => patchRow(target, { excludedFromSegments: !target.excludedFromSegments })}
    >
      {target.excludedFromSegments
        ? 'Put back into segment analysis'
        : 'Exclude from segment analysis'}
    </button>

    <label class="field">
      <span class="sr-label-tight">Correct type — now {label(target.activityType)}</span>
      <select
        value={target.typeOverride ?? ''}
        disabled={savingId === target.id}
        onchange={(event) => patchRow(target, { typeOverride: event.currentTarget.value || null })}
      >
        <option value="">No correction — source says {label(target.sourceType)}</option>
        {#each ACTIVITY_TYPES as type (type)}
          <option value={type}>{label(type)}</option>
        {/each}
      </select>
    </label>

    {#if savingId === target.id}
      <p class="pop-note">Saving…</p>
    {:else if note && note.id === target.id}
      <p class="pop-note" class:err={note.kind === 'error'}>{note.text}</p>
    {:else}
      <p class="pop-hint">
        Both corrections clear this outing's segment efforts and schedule a rebuild. Neither touches
        what the phone sent, so the next sync cannot undo them.
      </p>
    {/if}
  </div>
{/if}

<style>
  .totals {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 1rem;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .stat-value {
    font-family: var(--font-mono);
    font-size: var(--fs-num-md);
    color: var(--text-primary);
    line-height: 1.1;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 1rem;
  }
  .chips :global(.sr-label-tight) {
    margin-right: 0.35rem;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--accent);
    background: transparent;
    color: var(--accent);
    cursor: pointer;
  }
  .chip:hover {
    background: var(--accent);
    color: var(--bg);
  }
  .chip .x {
    margin-left: 0.45rem;
  }
  .chip.clear-all {
    border-color: var(--line-strong);
    color: var(--text-secondary);
  }
  .chip.clear-all:hover {
    background: transparent;
    border-color: var(--accent);
    color: var(--accent);
  }

  .scroller {
    overflow-x: auto;
    border-top: 1px solid var(--line-strong);
  }

  .activity-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }

  thead th {
    background: var(--surface-rail);
    border-bottom: 1px solid var(--line-strong);
    padding: 0;
    text-align: left;
    white-space: nowrap;
  }
  thead th.num {
    text-align: right;
  }
  thead th.active .col-btn {
    color: var(--accent);
  }

  .col-btn {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3rem;
    width: 100%;
    padding: 0.5rem 0.6rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-secondary);
    background: none;
    border: 0;
    cursor: pointer;
    text-align: inherit;
  }
  thead th.num .col-btn {
    justify-content: flex-end;
  }
  .col-btn:hover {
    color: var(--accent);
  }
  .col-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .dot {
    color: var(--accent);
  }

  .actions-hd {
    width: 2.4rem;
  }

  tbody tr {
    border-bottom: 1px solid var(--line-hair);
  }
  tbody tr:hover,
  tbody tr.open {
    background: var(--surface-sunken);
  }
  tbody td,
  tbody th {
    padding: 0.45rem 0.6rem;
    text-align: left;
    font-weight: 400;
    vertical-align: middle;
    color: var(--text-primary);
  }
  tbody td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .when {
    white-space: nowrap;
    color: var(--text-secondary);
  }
  .type-tag {
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--accent-ink);
    white-space: nowrap;
  }
  .name {
    min-width: 12rem;
    max-width: 22rem;
  }
  .name a {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
    text-decoration: none;
  }
  .name a:hover {
    color: var(--accent);
    text-decoration: underline;
  }
  .flag {
    display: inline-block;
    margin-left: 0.4rem;
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--trend-down);
    border: 1px solid var(--trend-down);
    padding: 0 0.25rem;
  }
  .exc {
    min-width: 13rem;
    max-width: 20rem;
  }
  .blank {
    color: var(--text-ghost);
  }

  /* An excluded recording is still listed — it just stops shouting. */
  tbody tr.excluded td,
  tbody tr.excluded th,
  tbody tr.excluded .name a {
    color: var(--text-ghost);
  }
  tbody tr.excluded .type-tag {
    color: var(--text-ghost);
  }

  .menu-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 1;
    padding: 0.25rem 0.4rem;
    color: var(--text-muted);
    background: none;
    border: 1px solid transparent;
    cursor: pointer;
  }
  .menu-btn:hover,
  .menu-btn[aria-expanded='true'] {
    color: var(--accent);
    border-color: var(--accent);
  }
  .menu-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* Fixed, not absolute: the table scrolls sideways and an absolute panel
     inside an overflow-x container is a panel with its bottom half clipped. */
  .pop {
    position: fixed;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.75rem;
    background: var(--surface-card);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    max-height: 70vh;
    overflow-y: auto;
  }
  .pop-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .pop-x {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 1;
    padding: 0.15rem 0.35rem;
    color: var(--text-muted);
    background: none;
    border: 0;
    cursor: pointer;
  }
  .pop-x:hover {
    color: var(--accent);
  }
  .pop-hint,
  .pop-note {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-muted);
  }
  .pop-note {
    color: var(--accent-ink);
  }
  .pop-note.err {
    color: var(--error);
  }

  .pop-sorts,
  .pop-foot {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .pop-btn {
    flex: 1 1 auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    padding: 0.4rem 0.5rem;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid var(--line-strong);
    cursor: pointer;
    text-align: center;
  }
  .pop-btn.wide {
    flex: 1 1 100%;
  }
  .pop-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .pop-btn.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .pop-btn.quiet {
    flex: 0 0 auto;
  }
  .pop-btn:disabled {
    opacity: 0.55;
    cursor: progress;
  }
  .pop-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .pop-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .field input,
  .field select {
    /* 16px or mobile Safari zooms the viewport on focus. */
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 0.3rem 0.4rem;
    min-width: 0;
    width: 100%;
  }
  .field input:focus-visible,
  .field select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .pop-types {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.2rem 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    cursor: pointer;
  }
  .check-label {
    flex: 1 1 auto;
  }
  .check-count {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .empty {
    align-items: flex-start;
  }
  .empty-title {
    margin: 0 0 0.6rem;
    font-family: var(--font-body);
    font-size: var(--fs-body-lg);
    color: var(--text-primary);
  }
  .btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 0.5rem 1rem;
    color: var(--text-primary);
    background: none;
    border: 1px solid var(--line-strong);
    cursor: pointer;
  }
  .btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .foot-note {
    margin: 0.9rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.55;
    color: var(--text-muted);
    max-width: 78ch;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 700px) {
    .pop-fields {
      grid-template-columns: 1fr;
    }
  }
</style>
