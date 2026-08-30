<script lang="ts">
  // The owner's /health/activities — four sections read top to bottom.
  //
  //   01  Totals            what the phone has sent, filtered
  //   02  Training strip    twelve weeks, and the ratio read off the end
  //   03  The ledger        twelve columns, every heading a sort
  //   04  Reading the table the four columns that lie if you don't ask
  //
  // ALL the list state lives here, in one place, because the totals in section
  // 01 and the table in section 03 have to be describing the same set of rows.
  // Section 01 is the one that says so out loud, so a filter that moved the
  // table without moving the tiles would make the page's own note a lie.
  //
  // Nothing is re-derived that the server already decided: ranks, EF, the
  // effective type and the highlight corpus all arrive computed. What happens
  // here is filtering, sorting and summing — passes over a list.
  import { replaceState } from '$app/navigation';
  import HealthShell from './HealthShell.svelte';
  import ActivityTotals from './ActivityTotals.svelte';
  import TrainingStrip from './TrainingStrip.svelte';
  import ActivityLedger, { type CorrectedRow } from './ActivityLedger.svelte';
  import ReadingTheTable from './ReadingTheTable.svelte';
  import {
    buildComparator,
    buildFilterPredicate,
    clearColumnFilter,
    countTypes,
    describeFilters,
    emptyFilters,
    filtersToQuery,
    parseFilters,
    parseSort,
    rowWindow,
    totalsOf,
    ROWS_PER_PAGE,
    type ActivityFilters,
    type ActivityTableRow,
    type ColumnKey,
    type FilterChip,
    type SortState,
  } from '$lib/health/activity-list';
  import { efficiencyFactor } from '$lib/health/analytics/efficiency';
  import { isPaceSport } from '$lib/trails/format';
  import type { ActivityListRow } from '$lib/trails/activities-service';
  import type { Highlight } from '$lib/trails/highlights';
  import type { TrailsStrip } from '$lib/trails/physio-service';

  interface Props {
    rows: ActivityListRow[];
    highlights: Record<string, Highlight | undefined>;
    highlightsFailed: boolean;
    strip: TrailsStrip | null;
    truncated: boolean;
    limit: number;
    /** The page's `url.search`, so a dashboard deep link lands pre-filtered. */
    initialQuery: string;
    error: string | null;
  }

  let { rows, highlights, highlightsFailed, strip, truncated, limit, initialQuery, error }: Props =
    $props();

  const BASE_PATH = '/health/activities';

  // Seeded ONCE from the URL, deliberately not reactive: after the first paint
  // this component is the one writing the address bar, and re-reading it would
  // be an effect reading what it just wrote.
  // svelte-ignore state_referenced_locally
  const seed = new URLSearchParams(
    initialQuery.startsWith('?') ? initialQuery.slice(1) : initialQuery,
  );
  // svelte-ignore state_referenced_locally
  let filters = $state<ActivityFilters>(parseFilters(seed, rows.map((row) => row.activityType)));
  let sort = $state<SortState | null>(parseSort(seed));
  let cap = $state(ROWS_PER_PAGE);

  /**
   * Corrections, applied over the loaded rows rather than into them. The load
   * payload is a plain object, so mutating it would change nothing on screen —
   * and the row the SERVER returned is the only one worth trusting.
   */
  let overrides = $state<Record<string, CorrectedRow>>({});

  const tableRows = $derived.by((): ActivityTableRow[] =>
    rows.map((row) => {
      const saved = overrides[row.id];
      const merged = saved
        ? {
            ...row,
            activityType: saved.activityType,
            sourceType: saved.sourceType,
            typeOverride: saved.typeOverride,
            excludedFromSegments: saved.excludedFromSegments,
          }
        : row;
      return {
        ...merged,
        // A ride corrected to a run has an EF from that moment, not from the
        // next reload — the server nulls it outside the pace sports and this
        // is the same partition applied to the corrected type.
        efficiencyFactor: saved
          ? isPaceSport(merged.activityType)
            ? efficiencyFactor(
                merged.distanceM,
                merged.activeDurationS ?? merged.durationS,
                merged.avgHeartrate,
              )
            : null
          : merged.efficiencyFactor,
        highlight: highlights[row.id] ?? null,
      };
    }),
  );

  const typeCounts = $derived(countTypes(tableRows));
  const filtered = $derived(tableRows.filter(buildFilterPredicate(filters)));
  const sorted = $derived([...filtered].sort(buildComparator(sort)));
  const page = $derived(rowWindow(cap, sorted.length));
  const visible = $derived(sorted.slice(0, page.shown));

  const totals = $derived(totalsOf(filtered));
  /** `totalsOf` sums elapsed; the tile and the MOVING column both mean moving. */
  const movingS = $derived(
    filtered.reduce((sum, row) => sum + (row.activeDurationS ?? row.durationS ?? 0), 0),
  );
  const crossings = $derived(filtered.reduce((sum, row) => sum + (row.segmentCount ?? 0), 0));
  const crossedOn = $derived(filtered.filter((row) => (row.segmentCount ?? 0) > 0).length);

  /** Type chips draw themselves; every other active filter shows as a chip. */
  const chips = $derived(describeFilters(filters).filter((chip) => chip.column !== 'type'));

  /**
   * With no sort chosen the comparator is recency, so DATE ↓ is the truth of
   * what is on screen — the head says so rather than showing nothing sorted.
   */
  const shownSort = $derived<SortState>(sort ?? { key: 'date', dir: 'desc' });

  const earliest = $derived.by((): string | null => {
    let min: string | null = null;
    for (const row of rows) {
      const day = (row.startDateLocal ?? '').slice(0, 10);
      if (day && (min == null || day < min)) min = day;
    }
    return min;
  });

  /** A webhook with nothing through it for a month is not evidence of "live". */
  const LIVE_WINDOW_DAYS = 30;
  const daysSinceLast = $derived.by((): number | null => {
    let latest = 0;
    for (const row of rows) if (row.startDate > latest) latest = row.startDate;
    if (!latest) return null;
    return Math.floor((Date.now() / 1000 - latest) / 86400);
  });
  const live = $derived(daysSinceLast != null && daysSinceLast <= LIVE_WINDOW_DAYS);

  const hasRows = $derived(rows.length > 0);

  // ——— actions ———————————————————————————————————————————————————

  function syncUrl() {
    const query = filtersToQuery(filters, sort);
    replaceState(query ? `?${query}` : BASE_PATH, {});
    // A new filter or a new sort is a new list, so the page goes back to the
    // top of it.
    cap = ROWS_PER_PAGE;
  }

  /** Text sorts A→Z first; a measurement sorts biggest-first first. */
  function defaultDir(key: ColumnKey): 'asc' | 'desc' {
    return key === 'name' || key === 'type' ? 'asc' : 'desc';
  }

  function onsort(key: ColumnKey) {
    sort =
      shownSort.key === key
        ? { key, dir: shownSort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: defaultDir(key) };
    syncUrl();
  }

  function ontype(type: string | null) {
    if (type == null) filters.types = [];
    else if (filters.types.length === 1 && filters.types[0] === type) filters.types = [];
    else filters.types = [type];
    syncUrl();
  }

  function onclearchip(chip: FilterChip) {
    if (chip.value) filters.types = filters.types.filter((t) => t !== chip.value);
    else clearColumnFilter(filters, chip.column);
    syncUrl();
  }

  function onclearall() {
    filters = emptyFilters();
    sort = null;
    syncUrl();
  }

  function onmore(step: number) {
    cap += step;
  }

  function oncorrected(row: CorrectedRow) {
    overrides = { ...overrides, [row.id]: row };
  }
</script>

<HealthShell
  path="/health/activities"
  maxWidth={1500}
  nav={[
    { href: '/health', label: 'Dashboard' },
    { href: '/health/segments', label: 'Segments' },
    { href: '/health/plan', label: 'Plan', muted: true },
    { href: '/health/routes', label: 'Routes', muted: true },
    { href: '/health/record', label: 'Record', muted: true },
  ]}
  live={live ? 'HAE webhook live' : null}
  meta={!live && daysSinceLast != null ? [`no outing in ${daysSinceLast} days`] : []}
  footer={[
    'strangeramblings.com/health/activities',
    'Owner-gated · a GPS trace starts at the front door',
    'Advisory only · not medical advice',
  ]}
>
  <ActivityTotals
    {totals}
    {movingS}
    {crossings}
    {crossedOn}
    matching={filtered.length}
    loaded={tableRows.length}
    {limit}
    {truncated}
    {earliest}
  />

  {#if error}
    <!-- A query that failed is not a phone that was never set up: the
         onboarding copy below would tell the owner to configure something that
         has been running for a year. -->
    <section class="state">
      <div class="state-inner">
        <p class="state-kicker">The list did not load</p>
        <p class="state-body">
          The database did not answer, so this table is empty for a reason that has nothing to do
          with what the phone has sent. Reload the page; if it keeps failing, the server log carries
          the query error.
        </p>
      </div>
    </section>
  {:else if !hasRows}
    <section class="state">
      <div class="state-inner">
        <p class="state-kicker">Nothing here yet</p>
        <p class="state-body">
          Activities arrive from Health Auto Export on the phone. Enable <strong
            >Export Version 2</strong
          >
          with <strong>Include Workout Metrics</strong> and <strong>Route Data</strong>, pointed at
          <code>/api/health/apple/ingest</code>. The webhook has no retroactive push, so history
          starts from the moment it is switched on.
        </p>
      </div>
    </section>
  {:else}
    {#if strip && (strip.weeks ?? []).some((w) => w.totalS > 0)}
      <TrainingStrip {strip} />
    {/if}

    {#if truncated}
      <section class="state">
        <div class="state-inner truncated">
          <p class="state-kicker">Only the most recent {limit.toLocaleString('en-GB')} outings</p>
          <p class="state-body">
            The list hit its cap, so the table, its totals and its type counts all cover the most
            recent rows only. Older outings are not in any figure on this page.
          </p>
        </div>
      </section>
    {/if}

    <ActivityLedger
      rows={visible}
      {typeCounts}
      activeTypes={filters.types}
      loaded={tableRows.length}
      sort={shownSort}
      {chips}
      {page}
      {highlightsFailed}
      {onsort}
      {ontype}
      {onclearchip}
      {onclearall}
      {onmore}
      {oncorrected}
    />

    <ReadingTheTable corpusCount={tableRows.length} />
  {/if}
</HealthShell>

<style>
  .state {
    padding: clamp(30px, 3.6vw, 48px) clamp(20px, 3vw, 44px);
  }
  .state-inner {
    max-width: 1500px;
    margin: 0 auto;
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--text-primary);
    border-radius: 0;
    padding: 22px;
  }
  .state-inner.truncated {
    border-left-color: var(--accent);
  }
  .state-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 14px;
  }
  .state-body {
    font-size: var(--fs-nav);
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 68ch;
    text-wrap: pretty;
    margin: 0;
  }
  .state-body code {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    background: var(--card-bg);
    padding: 0.05rem 0.3rem;
  }
</style>
