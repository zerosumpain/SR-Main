<script lang="ts">
  // 02 — THE LEDGER. Fourteen columns, every heading a sort, four chip rows
  // above it.
  //
  // The table keeps its columns and scrolls sideways rather than reflowing:
  // 1,290px of minimum width inside an `overflow-x: auto`. A row that stacked
  // would put a gradient under a gap and mean nothing.
  //
  // THE FIRST CELL IS THE SEGMENT'S IDENTITY, IN THE SEGMENT'S OWN VOICE. The
  // name is DM Mono 500, lowercase, with the dots in accent — the treatment the
  // detail page gives its hero and `ActivitySegments` gives its rows, at ledger
  // scale. It is an identifier generated from the geometry's own seed, not a
  // headline, so Archivo Black would be the wrong voice for it.
  //
  // Two treatments carry meaning rather than decoration:
  //
  //  * a GETTABLE row — improving, and inside 3% of its own record — takes an
  //    8% accent tint with its gap figure bold accent. It is the one positive
  //    the whole page is organised around, and the dashboard's gettable board
  //    is accent-bordered for the same reason;
  //  * a row with NO FORM READ prints dashes in the four form columns rather
  //    than zeroes, in ghost. Under six efforts the window medians are two
  //    numbers, and that is most of a several-hundred-segment corpus — so it is
  //    a state, drawn quietly, not an error and not a whole-row dim.
  //
  // Every figure appears exactly once per row: the identity cell carries the
  // name and the qualitative chips, and every measurement is a column of its
  // own so it can be sorted. The `descriptor` line the detail page prints
  // beside the name would repeat three of them here.
  import TrackThumb from '$lib/components/trails/TrackThumb.svelte';
  import FormSpark from '$lib/components/trails/FormSpark.svelte';
  import {
    activityLabel,
    formatDistance,
    formatDuration,
    formatElevation,
    formatPace,
    formatSpeed,
    isPaceSport,
  } from '$lib/trails/format';
  import { signed } from './format';
  import {
    columnDef,
    gapPercent,
    hasFormRead,
    insufficientNote,
    isGettable,
    TABLE_ORDER,
    type ColumnKey,
    type FacetCount,
    type FilterChip,
    type RowWindow,
    type SortState,
  } from '$lib/health/segment-list';
  import type { SegmentListRow } from '$lib/trails/segments-service';
  import type { FormDirection } from '$lib/trails/segments/form';
  import type { SegmentTerrain } from '$lib/trails/segments/naming';

  interface Props {
    /** The rendered window, already filtered and sorted. */
    rows: SegmentListRow[];
    /** Facets counted over the LOADED rows — never an all-time group-by. */
    typeCounts: FacetCount<string>[];
    terrainCounts: FacetCount<SegmentTerrain>[];
    formCounts: FacetCount<FormDirection>[];
    offroadCount: number;
    activeTypes: string[];
    activeTerrains: SegmentTerrain[];
    activeForms: FormDirection[];
    offroadOnly: boolean;
    loaded: number;
    sort: SortState;
    /** Everything filtering the list that no chip row draws for itself. */
    chips: FilterChip[];
    page: RowWindow;
    /** One clock for the page, so "13d ago" and the PB age agree. */
    nowS: number;
    /** True when the visible set is a single sport — pace and EF then rank. */
    singleSport: boolean;
    ontype: (type: string | null) => void;
    onterrain: (terrain: SegmentTerrain | null) => void;
    onform: (form: FormDirection | null) => void;
    onoffroad: () => void;
    onsort: (key: ColumnKey) => void;
    onclearchip: (chip: FilterChip) => void;
    onclearall: () => void;
    onmore: (rows: number) => void;
  }

  let {
    rows,
    typeCounts,
    terrainCounts,
    formCounts,
    offroadCount,
    activeTypes,
    activeTerrains,
    activeForms,
    offroadOnly,
    loaded,
    sort,
    chips,
    page,
    nowS,
    singleSport,
    ontype,
    onterrain,
    onform,
    onoffroad,
    onsort,
    onclearchip,
    onclearall,
    onmore,
  }: Props = $props();

  const columns = $derived(TABLE_ORDER.map((key) => ({ key, def: columnDef(key) })));

  const n = (value: number) => value.toLocaleString('en-GB');

  function paceCell(row: SegmentListRow): string {
    if (!isPaceSport(row.activityType)) return formatSpeed(row.bests.paceSPerKm);
    // The heading already says PACE, so the /km would repeat on every row.
    // Speed keeps its km/h, because that suffix is what tells the reader the
    // column has changed measure under them.
    const pace = formatPace(row.bests.paceSPerKm);
    return pace.endsWith(' /km') ? pace.slice(0, -4) : pace;
  }

  /** `13d`, `4mo`, `2y` — how long since this ground was last covered. */
  function lastCell(row: SegmentListRow): string {
    if (!row.lastEffortAt) return '—';
    const days = Math.max(0, Math.floor((nowS - row.lastEffortAt) / 86_400));
    if (days < 60) return `${days}d`;
    if (days < 730) return `${Math.round(days / 30)}mo`;
    return `${(days / 365).toFixed(1)}y`;
  }

  /**
   * Why a form-derived cell is blank, on the cell itself.
   *
   * A dash with no explanation reads as missing data. It is not: it is the
   * honest answer for ground covered three times, and the tooltip says which
   * of the two floors the row failed.
   */
  function blankTitle(row: SegmentListRow): string {
    return insufficientNote(row);
  }
</script>

<section class="sl">
  <div class="sl-inner">
    <div class="sl-facets">
      <div class="sl-chips">
        <p class="sl-chips-label">Type</p>
        <button
          type="button"
          class="chip"
          class:on={activeTypes.length === 0}
          aria-pressed={activeTypes.length === 0}
          onclick={() => ontype(null)}
        >
          All <span class="chip-n">{n(loaded)}</span>
        </button>
        {#each typeCounts as t (t.value)}
          <button
            type="button"
            class="chip"
            class:on={activeTypes.includes(t.value)}
            aria-pressed={activeTypes.includes(t.value)}
            onclick={() => ontype(t.value)}
          >
            {t.label} <span class="chip-n">{n(t.count)}</span>
          </button>
        {/each}
      </div>

      <div class="sl-chips">
        <p class="sl-chips-label">Terrain</p>
        {#each terrainCounts as t (t.value)}
          <button
            type="button"
            class="chip"
            class:on={activeTerrains.includes(t.value)}
            aria-pressed={activeTerrains.includes(t.value)}
            onclick={() => onterrain(t.value)}
          >
            {t.label} <span class="chip-n">{n(t.count)}</span>
          </button>
        {/each}
        <button
          type="button"
          class="chip"
          class:on={offroadOnly}
          aria-pressed={offroadOnly}
          title="Trail runs, MTB and hikes — the sports that only happen off the tarmac"
          onclick={onoffroad}
        >
          Off-road <span class="chip-n">{n(offroadCount)}</span>
        </button>
      </div>

      <div class="sl-chips">
        <p class="sl-chips-label">Form</p>
        {#each formCounts as f (f.value)}
          <button
            type="button"
            class="chip"
            class:on={activeForms.includes(f.value)}
            aria-pressed={activeForms.includes(f.value)}
            title="The last three efforts' median time against the three before them"
            onclick={() => onform(f.value)}
          >
            {f.label} <span class="chip-n">{n(f.count)}</span>
          </button>
        {/each}
      </div>

      {#if chips.length > 0 || activeTypes.length > 0 || activeTerrains.length > 0 || activeForms.length > 0 || offroadOnly}
        <div class="sl-chips">
          {#each chips as chip (chip.id)}
            <button type="button" class="chip removable" onclick={() => onclearchip(chip)}>
              {chip.label}<span class="chip-x" aria-hidden="true">×</span><span class="sr-only">
                — remove filter</span
              >
            </button>
          {/each}
          <button type="button" class="chip clear" onclick={onclearall}>Clear all</button>
        </div>
      {/if}
    </div>

    {#if !singleSport}
      <p class="sl-partition">
        Pace, efficiency and cost rank within one sport only — the same formula on a different
        machine, so the bikes sit clear of the runs on all three. With every type shown, those
        columns rank the pace sports and sink the rest; pick a type to rank inside it.
      </p>
    {/if}

    <div class="sl-scroll">
      <table class="sl-table">
        <thead>
          <tr>
            {#each columns as col (col.key)}
              <th
                scope="col"
                class="col-{col.key}"
                class:right={col.def.align === 'right'}
                class:sorted={sort.key === col.key}
                aria-sort={sort.key === col.key
                  ? sort.dir === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'}
              >
                <button
                  type="button"
                  class="col-btn"
                  title={col.def.hint}
                  onclick={() => onsort(col.key)}
                >
                  {col.def.short}
                  {#if sort.key === col.key}
                    <span class="col-arrow" aria-hidden="true">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                  {/if}
                  <span class="sr-only">
                    — sort{sort.key === col.key
                      ? `ed ${sort.dir === 'asc' ? 'ascending' : 'descending'}`
                      : ''}</span
                  >
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            {@const read = hasFormRead(row)}
            {@const gettable = isGettable(row)}
            {@const gap = gapPercent(row.form)}
            <tr class:gettable>
              {#each columns as col (col.key)}
                <td
                  class="col-{col.key}"
                  class:right={col.def.align === 'right'}
                  class:lit={gettable && col.key === 'gap'}
                >
                  {#if col.key === 'name'}
                    <a class="sl-ground" href="/health/segments/{row.id}" title={row.name}>
                      <TrackThumb polyline={row.polyline} size={40} />
                      <span class="sl-idc">
                        <span class="sl-name"
                          >{#each row.name.split('.') as part, i (i)}{#if i > 0}<span class="sl-dot"
                                >.</span
                              >{/if}{part}{/each}</span
                        >
                        <span class="sl-pills">
                          <span class="pill">{row.terrain}</span>
                          {#if row.offroad}<span class="pill lit">Off-road</span>{/if}
                        </span>
                      </span>
                    </a>
                  {:else if col.key === 'type'}
                    {activityLabel(row.activityType)}
                  {:else if col.key === 'distance'}
                    {formatDistance(row.distanceM)}
                  {:else if col.key === 'climb'}
                    {formatElevation(row.elevationGainM)}
                  {:else if col.key === 'gradient'}
                    <span class="muted">{signed(row.gradientPct, 1)}%</span>
                  {:else if col.key === 'efforts'}
                    {row.effortCount}
                  {:else if col.key === 'best'}
                    {formatDuration(row.bests.durationS)}
                  {:else if col.key === 'pace'}
                    <span class="muted">{paceCell(row)}</span>
                  {:else if col.key === 'ef'}
                    {row.bests.efficiencyFactor == null
                      ? '—'
                      : row.bests.efficiencyFactor.toFixed(2)}
                  {:else if col.key === 'cost'}
                    <span class="muted"
                      >{row.bests.beatsPerKm == null
                        ? '—'
                        : Math.round(row.bests.beatsPerKm)}</span
                    >
                  {:else if col.key === 'form'}
                    {#if read}
                      <FormSpark form={row.form} />
                    {:else}
                      <span class="blank" title={blankTitle(row)}>No read</span>
                    {/if}
                  {:else if col.key === 'gap'}
                    {#if gap == null}
                      <span class="blank" title={blankTitle(row)}>—</span>
                    {:else}
                      {gap.toFixed(1)}%
                    {/if}
                  {:else if col.key === 'staleness'}
                    {#if row.form.daysSincePb == null}
                      <span class="blank" title={blankTitle(row)}>—</span>
                    {:else}
                      <span class="muted">{row.form.daysSincePb}d</span>
                    {/if}
                  {:else}
                    <span class="muted">{lastCell(row)}</span>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if page.matching === 0}
      <div class="sl-empty">
        <p class="sl-empty-title">Nothing matches these filters.</p>
        <button type="button" class="chip clear" onclick={onclearall}>Clear all filters</button>
      </div>
    {/if}

    <div class="sl-foot">
      <p class="sl-count">
        {n(page.shown)} of {n(page.matching)} shown · scroll the table sideways for every column
      </p>
      {#if page.remaining > 0}
        <div class="sl-more">
          <button type="button" class="chip" onclick={() => onmore(page.nextStep)}
            >Show {page.nextStep} more</button
          >
          <button type="button" class="chip" onclick={() => onmore(page.remaining)}
            >Show all {n(page.matching)}</button
          >
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  .sl {
    padding: clamp(30px, 3.6vw, 48px) clamp(20px, 3vw, 44px);
  }
  .sl-inner {
    max-width: 1500px;
    margin: 0 auto;
  }

  /* ——— chips ——— */
  .sl-facets {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 20px;
  }
  .sl-chips {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sl-chips-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    width: 68px;
    flex-shrink: 0;
    margin: 0;
  }
  .chip {
    /* Same reason as .col-btn: the removable chips carry an .sr-only. */
    position: relative;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 6px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition:
      background-color 0.2s ease-out,
      border-color 0.2s ease-out,
      color 0.2s ease-out;
  }
  .chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .chip.on {
    font-weight: 500;
    background: var(--text-primary);
    border-color: var(--text-primary);
    color: var(--bg);
  }
  .chip.on:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .chip-n {
    color: var(--text-muted);
  }
  .chip.on .chip-n {
    color: inherit;
    opacity: 0.6;
  }
  .chip.removable {
    border-color: var(--accent-tint-50);
    color: var(--accent);
  }
  .chip-x {
    margin-left: 7px;
  }
  .chip.clear {
    border-style: dashed;
    color: var(--text-muted);
  }
  .chip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .sl-partition {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.65;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    max-width: 96ch;
    margin: 0 0 16px;
  }

  /* ——— table ——— */
  .sl-scroll {
    overflow-x: auto;
    border: 1px solid var(--card-border);
  }
  .sl-table {
    border-collapse: collapse;
    width: 100%;
    /* Measured against the natural content width (1,290px) rather than picked.
       A larger figure forces slack, and an auto-layout table hands almost all
       of it to the first column — which put a 60px hole between a segment's
       name and its type. A smaller one only matters on a corpus whose names
       and figures are shorter than this one's, where it stops the table
       collapsing to nothing. */
    min-width: 1290px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }

  .sl-table thead tr {
    background: var(--card-bg);
    border-bottom: 2px solid rgba(26, 16, 8, 0.2);
  }
  .sl-table th {
    padding: 0;
    text-align: left;
    white-space: nowrap;
  }
  .col-btn {
    display: block;
    /* Positioned so the .sr-only inside it is contained HERE. An absolutely
       positioned element whose containing block is the initial one escapes
       every ancestor's overflow clip, so at 1,290px of table the hidden sort
       labels would stretch the whole page sideways on a phone. */
    position: relative;
    width: 100%;
    padding: 12px;
    font-family: inherit;
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    text-align: inherit;
    color: var(--text-muted);
    background: none;
    border: 0;
    cursor: pointer;
    transition: color 0.2s ease-out;
  }
  .sl-table th.right .col-btn {
    text-align: right;
  }
  .sl-table th:first-child .col-btn {
    padding-left: 16px;
  }
  .sl-table th:last-child .col-btn {
    padding-right: 16px;
  }
  .col-btn:hover {
    color: var(--accent);
  }
  .sl-table th.sorted .col-btn {
    font-weight: 700;
    color: var(--accent);
  }
  .col-arrow {
    margin-left: 4px;
  }
  .col-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .sl-table tbody tr {
    border-bottom: 1px solid var(--line-hair);
    transition: background-color 0.2s ease-out;
  }
  .sl-table tbody tr:last-child {
    border-bottom: none;
  }
  /* Hover is a tint. No fade, no lift. */
  .sl-table tbody tr:hover {
    background: rgba(26, 16, 8, 0.05);
  }
  .sl-table tbody tr.gettable {
    background: var(--accent-tint-08);
  }

  .sl-table td {
    padding: 10px 12px;
    vertical-align: middle;
  }
  .sl-table td:first-child {
    padding-left: 16px;
  }
  .sl-table td:last-child {
    padding-right: 16px;
  }
  .sl-table td.right {
    text-align: right;
    white-space: nowrap;
  }
  .sl-table td.col-type {
    white-space: nowrap;
    text-transform: uppercase;
  }
  .sl-table td .muted {
    color: var(--text-muted);
  }
  .sl-table td.lit {
    font-weight: 700;
    color: var(--accent);
  }
  .blank {
    color: var(--text-ghost);
  }

  /* ——— the identity cell ——— the segment's own voice, at ledger scale. */
  .sl-ground {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    color: inherit;
    text-decoration: none;
  }
  .sl-idc {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .sl-name {
    font-family: var(--font-brand);
    font-size: var(--fs-label);
    font-weight: 500;
    letter-spacing: -0.01em;
    text-transform: lowercase;
    /* One line, capped. A name is an identifier: wrapping it turns one row
       into two, and it would otherwise set the width of the whole column. */
    max-width: 26ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.2s ease-out;
  }
  .sl-ground:hover .sl-name {
    color: var(--accent);
  }
  .sl-dot {
    color: var(--accent);
  }

  /* The one radius in this system that is not 0. */
  .sl-pills {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .pill {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border: 1px solid var(--card-border);
    border-radius: 100px;
    padding: 2px 9px;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .pill.lit {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }

  /* ——— foot ——— */
  .sl-empty {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    padding: 22px 0 0;
  }
  .sl-empty-title {
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
    margin: 0;
  }

  .sl-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 16px;
  }
  .sl-count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }
  .sl-more {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
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

  @media (max-width: 560px) {
    .sl-chips-label {
      width: auto;
    }
  }
</style>
