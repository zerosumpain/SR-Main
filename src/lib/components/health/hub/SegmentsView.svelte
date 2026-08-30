<script lang="ts">
  // The owner's /health/segments — four sections read top to bottom.
  //
  //   01  The corpus         how much ground, and what shape it is in
  //   02  The ledger         thirteen columns, every heading a sort
  //   03  Chains             pairs taken one straight after the other
  //   04  Reading the ledger the four columns that read backwards
  //
  // ALL the list state lives here, in one place, because the taxonomy tiles in
  // section 01 and the table in section 02 have to be describing the same set
  // of rows. Section 01 is the one that says so out loud, so a filter that
  // moved the table without moving the tiles would make the page's own note a
  // lie — the same contract the activities page keeps with its totals.
  //
  // Nothing is re-derived that the server already decided: the form windows,
  // the bests, the terrain and the gradient all arrive computed by
  // `listSegments`, off two memoised corpus scans. What happens here is
  // filtering, sorting and counting — passes over a list.
  import { replaceState } from '$app/navigation';
  import HealthShell from './HealthShell.svelte';
  import SegmentTotals from './SegmentTotals.svelte';
  import SegmentLedger from './SegmentLedger.svelte';
  import SegmentChains from './SegmentChains.svelte';
  import ReadingTheLedger from './ReadingTheLedger.svelte';
  import {
    anyFilterActive,
    buildComparator,
    buildFilterPredicate,
    clearFilter,
    countForms,
    countOffroad,
    countTerrains,
    countTypes,
    describeFilters,
    emptyFilters,
    filtersToQuery,
    formTaxonomy,
    parseFilters,
    parseSort,
    rowWindow,
    toggleFacet,
    ROWS_PER_PAGE,
    type ColumnKey,
    type FilterChip,
    type SegmentFilters,
    type SortState,
  } from '$lib/health/segment-list';
  import { columnDef } from '$lib/health/segment-list';
  import type { SegmentListRow } from '$lib/trails/segments-service';
  import type { SegmentChain } from '$lib/trails/highlights-service';
  import type { FormDirection } from '$lib/trails/segments/form';
  import type { SegmentTerrain } from '$lib/trails/segments/naming';

  interface Props {
    segments: SegmentListRow[];
    /** The all-time group-by from the service — used only to validate the URL. */
    types: { activityType: string; count: number }[];
    chains: SegmentChain[];
    truncated: boolean;
    limit: number;
    /** The page's `url.search`, so a dashboard deep link lands pre-filtered. */
    initialQuery: string;
    error: string | null;
  }

  let { segments, types, chains, truncated, limit, initialQuery, error }: Props = $props();

  const BASE_PATH = '/health/segments';

  // ONE clock for the page. "13d since the last effort" and the PB age both
  // read it, and two components calling Date.now() separately is how a page
  // ends up disagreeing with itself across a midnight boundary.
  const nowS = Math.floor(Date.now() / 1000);

  // Seeded ONCE from the URL, deliberately not reactive: after the first paint
  // this component is the one writing the address bar, and re-reading it would
  // be an effect reading what it just wrote.
  // svelte-ignore state_referenced_locally
  const seed = new URLSearchParams(
    initialQuery.startsWith('?') ? initialQuery.slice(1) : initialQuery,
  );
  // svelte-ignore state_referenced_locally
  let filters = $state<SegmentFilters>(
    parseFilters(
      seed,
      types.map((t) => t.activityType),
    ),
  );
  let sort = $state<SortState | null>(parseSort(seed));
  let cap = $state(ROWS_PER_PAGE);

  const typeCounts = $derived(countTypes(segments));
  const terrainCounts = $derived(countTerrains(segments));
  const formCounts = $derived(countForms(segments));
  const offroadCount = $derived(countOffroad(segments));

  /**
   * Pace and efficiency only rank inside one sport. With exactly one type
   * selected the visible set is internally comparable and they rank across all
   * of it; otherwise they rank the pace sports and sink the rest.
   */
  const singleSport = $derived(filters.types.length === 1);

  const filtered = $derived(segments.filter(buildFilterPredicate(filters)));
  const sorted = $derived([...filtered].sort(buildComparator(sort, singleSport)));
  const page = $derived(rowWindow(cap, sorted.length));
  const visible = $derived(sorted.slice(0, page.shown));

  // Everything the head describes is measured over the FILTERED rows, never
  // the rendered window — the render cap is a budget, not a data budget.
  const taxonomy = $derived(formTaxonomy(filtered));
  const efforts = $derived(filtered.reduce((sum, row) => sum + (row.effortCount ?? 0), 0));
  const distanceM = $derived(filtered.reduce((sum, row) => sum + (row.distanceM ?? 0), 0));
  const climbM = $derived(filtered.reduce((sum, row) => sum + (row.elevationGainM ?? 0), 0));

  /** The chip rows draw type, terrain and form themselves. */
  const chips = $derived(describeFilters(filters));

  /**
   * With no sort chosen the comparator is busiest-first, so EFFORTS ↓ is the
   * truth of what is on screen — the head says so rather than showing nothing
   * sorted.
   */
  const shownSort = $derived<SortState>(sort ?? { key: 'efforts', dir: 'desc' });

  /**
   * A corpus with nothing new on it for a month is not evidence of "live".
   * Segments are not pushed by the phone; what is live is the matching, so the
   * dot means an effort has landed on known ground recently.
   */
  const LIVE_WINDOW_DAYS = 30;
  const daysSinceLast = $derived.by((): number | null => {
    let latest = 0;
    for (const row of segments) if ((row.lastEffortAt ?? 0) > latest) latest = row.lastEffortAt ?? 0;
    if (!latest) return null;
    return Math.floor((nowS - latest) / 86_400);
  });
  const live = $derived(daysSinceLast != null && daysSinceLast <= LIVE_WINDOW_DAYS);

  const hasRows = $derived(segments.length > 0);

  // ——— actions ———————————————————————————————————————————————————

  function syncUrl() {
    const query = filtersToQuery(filters, sort);
    replaceState(query ? `?${query}` : BASE_PATH, {});
    // A new filter or a new sort is a new list, so the page goes back to the
    // top of it.
    cap = ROWS_PER_PAGE;
  }

  function onsort(key: ColumnKey) {
    // Each column names its own interesting end — quickest, closest, most
    // improving — rather than a blanket text-ascending/numbers-descending.
    sort =
      shownSort.key === key
        ? { key, dir: shownSort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: columnDef(key).first };
    syncUrl();
  }

  function ontype(type: string | null) {
    filters.types = toggleFacet(filters.types, type);
    syncUrl();
  }

  function onterrain(terrain: SegmentTerrain | null) {
    filters.terrains = toggleFacet(filters.terrains, terrain);
    syncUrl();
  }

  function onform(form: FormDirection | null) {
    filters.forms = toggleFacet(filters.forms, form);
    syncUrl();
  }

  function onoffroad() {
    filters.offroad = !filters.offroad;
    syncUrl();
  }

  function onclearchip(chip: FilterChip) {
    clearFilter(filters, chip);
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

  // ——— rebuild ———————————————————————————————————————————————————
  //
  // The one write on the page. It reads every stored trace and re-matches the
  // corpus; segments landing on the same ground keep their name, so nothing
  // already learned about a stretch is renamed by running it.

  let rebuilding = $state(false);
  let rebuildNote = $state<string | null>(null);

  async function rebuild() {
    if (rebuilding) return;
    rebuilding = true;
    rebuildNote = null;
    try {
      const res = await fetch('/api/trails/segments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = await res.json();
      if (!res.ok) {
        rebuildNote = body?.error ?? 'Rebuild failed.';
        return;
      }
      rebuildNote =
        `${body.segments} segments from ${body.activitiesConsidered} activities ` +
        `(${body.created} new, ${body.kept} kept, ${body.removed} retired) in ` +
        `${(body.elapsedMs / 1000).toFixed(1)}s. Reload to see them.`;
    } catch (err) {
      rebuildNote = (err as Error)?.message ?? 'Rebuild failed.';
    } finally {
      rebuilding = false;
    }
  }
</script>

<HealthShell
  path="/health/segments"
  maxWidth={1500}
  nav={[
    { href: '/health', label: 'Dashboard' },
    { href: '/health/activities', label: 'Activities' },
    { href: '/health/plan', label: 'Plan', muted: true },
    { href: '/health/routes', label: 'Routes', muted: true },
    { href: '/health/record', label: 'Record', muted: true },
  ]}
  live={live ? 'Segment matching live' : null}
  meta={!live && daysSinceLast != null ? [`no effort in ${daysSinceLast} days`] : []}
  footer={[
    'strangeramblings.com/health/segments',
    'Owner-gated · a GPS trace starts at the front door',
    'Advisory only · not medical advice',
  ]}
>
  <SegmentTotals
    {taxonomy}
    {efforts}
    {distanceM}
    {climbM}
    matching={filtered.length}
    loaded={segments.length}
    {limit}
    {truncated}
  />

  {#if error}
    <!-- A query that failed is not a corpus that was never built: the
         onboarding copy below would offer to build something that has been
         matched for a year. -->
    <section class="state">
      <div class="state-inner">
        <p class="state-kicker">The list did not load</p>
        <p class="state-body">
          The database did not answer, so this table is empty for a reason that has nothing to do
          with what has been walked, run or ridden. Reload the page; if it keeps failing, the server
          log carries the query error.
        </p>
      </div>
    </section>
  {:else if !hasRows}
    <section class="state">
      <div class="state-inner">
        <p class="state-kicker">No segments yet</p>
        <p class="state-body">
          Either nothing has been walked, run or ridden twice yet, or the segments have not been
          built. Building reads every stored GPS trace and compares it against the others, matching
          wherever two stay within 20 m of each other for at least 500 m.
        </p>
        <button type="button" class="build" disabled={rebuilding} onclick={rebuild}>
          {rebuilding ? 'Building…' : 'Build segments'}
        </button>
        {#if rebuildNote}<p class="state-note">{rebuildNote}</p>{/if}
      </div>
    </section>
  {:else}
    {#if truncated}
      <section class="state">
        <div class="state-inner truncated">
          <p class="state-kicker">Only the busiest {limit.toLocaleString('en-GB')} segments</p>
          <p class="state-body">
            The list hit its cap, so the table, its taxonomy tiles and its chip counts all cover the
            most-covered ground only. Quieter segments are not in any figure on this page.
          </p>
        </div>
      </section>
    {/if}

    <SegmentLedger
      rows={visible}
      {typeCounts}
      {terrainCounts}
      {formCounts}
      {offroadCount}
      activeTypes={filters.types}
      activeTerrains={filters.terrains}
      activeForms={filters.forms}
      offroadOnly={filters.offroad}
      loaded={segments.length}
      sort={shownSort}
      {chips}
      {page}
      {nowS}
      {singleSport}
      {ontype}
      {onterrain}
      {onform}
      {onoffroad}
      {onsort}
      {onclearchip}
      {onclearall}
      {onmore}
    />

    <SegmentChains {chains} />

    <ReadingTheLedger corpusCount={segments.length} noReadCount={taxonomy.noRead} />

    <section class="state maint">
      <div class="state-inner">
        <p class="state-kicker">Rebuilding</p>
        <p class="state-body">
          A rebuild recomputes the whole corpus from the stored traces. Segments that land on the
          same ground keep their name, so nothing you have learned about a stretch gets renamed —
          and the records, the form windows and the chains are all recomputed with them.
          {#if anyFilterActive(filters)}
            The filters above are a view, not a state: they change nothing on disk.
          {/if}
        </p>
        <button type="button" class="build" disabled={rebuilding} onclick={rebuild}>
          {rebuilding ? 'Rebuilding…' : 'Rebuild segments'}
        </button>
        {#if rebuildNote}<p class="state-note">{rebuildNote}</p>{/if}
      </div>
    </section>
  {/if}
</HealthShell>

<style>
  .state {
    padding: clamp(30px, 3.6vw, 48px) clamp(20px, 3vw, 44px);
  }
  .state.maint {
    background: var(--bg-section);
    border-top: 2px solid rgba(26, 16, 8, 0.12);
  }
  .state-inner {
    max-width: 1500px;
    margin: 0 auto;
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--text-primary);
    border-radius: 0;
    padding: 22px;
    background: var(--bg);
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

  .build {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 8px 16px;
    margin-top: 18px;
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    cursor: pointer;
    transition:
      background-color 0.2s ease-out,
      border-color 0.2s ease-out,
      color 0.2s ease-out;
  }
  .build:hover:not(:disabled) {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .build:disabled {
    opacity: 0.55;
    cursor: progress;
  }
  .build:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .state-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    color: var(--accent-ink);
    margin: 14px 0 0;
  }
</style>
