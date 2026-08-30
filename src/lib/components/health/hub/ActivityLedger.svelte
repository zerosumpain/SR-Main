<script module lang="ts">
  /** What the corrections endpoint hands back, as the ledger reports it up. */
  export interface CorrectedRow {
    id: string;
    /** The EFFECTIVE type after the correction. */
    activityType: string;
    typeOverride: string | null;
    excludedFromSegments: boolean;
    /** What the source called it, kept so the correction reads as a change. */
    sourceType: string;
  }
</script>

<script lang="ts">
  // 03 — THE LEDGER. Twelve columns, every heading a sort, type chips above.
  //
  // The table keeps its columns and scrolls sideways rather than reflowing:
  // 1,240px of minimum width inside an `overflow-x: auto`. A row that stacked
  // would put a pace under a climb and mean nothing.
  //
  // Three treatments carry meaning, not decoration:
  //
  //  * a row whose lead highlight is a SEGMENT effort takes a 4% accent tint,
  //    and a row holding an all-time record takes 8% with its figures in bold —
  //    the badge says what, the tint says how loud;
  //  * the one cell the highlight is ABOUT goes bold accent (HIGHLIGHT_COLUMN),
  //    so "hottest outing ever" and a lit 26.4° are the same fact twice;
  //  * an excluded outing is dimmed whole. It still happened, it is still
  //    listed, and it is out of segment matching — which is a state, not an
  //    error, so it is greyed rather than flagged.
  //
  // Sorting, filtering and the totals all run over the WHOLE loaded set; the
  // rendered window is a render budget and the line under the table says so.
  import { ACTIVITY_TYPES, formatTemperature } from '$lib/trails/activity-meta';
  import {
    activityLabel,
    formatDistance,
    formatDuration,
    formatElevation,
    formatPace,
    formatSpeed,
    isPaceSport,
  } from '$lib/trails/format';
  import {
    COLUMNS,
    HIGHLIGHT_COLUMN,
    SHORT_LABELS,
    TABLE_ORDER,
    placePopover,
    POP_EST_HEIGHT,
    POP_WIDTH,
    type ActivityTableRow,
    type ColumnKey,
    type FilterChip,
    type PopoverPlacement,
    type RowWindow,
    type SortState,
    type TypeCount,
  } from '$lib/health/activity-list';

  interface Props {
    /** The rendered window, already filtered and sorted. */
    rows: ActivityTableRow[];
    /** Distinct types in the LOADED rows — never the all-time group-by. */
    typeCounts: TypeCount[];
    activeTypes: string[];
    loaded: number;
    sort: SortState;
    /** Everything filtering the list that is not a type chip. */
    chips: FilterChip[];
    page: RowWindow;
    highlightsFailed: boolean;
    onsort: (key: ColumnKey) => void;
    ontype: (type: string | null) => void;
    onclearchip: (chip: FilterChip) => void;
    onclearall: () => void;
    onmore: (rows: number) => void;
    oncorrected: (row: CorrectedRow) => void;
  }

  let {
    rows,
    typeCounts,
    activeTypes,
    loaded,
    sort,
    chips,
    page,
    highlightsFailed,
    onsort,
    ontype,
    onclearchip,
    onclearall,
    onmore,
    oncorrected,
  }: Props = $props();

  const columns = $derived(
    TABLE_ORDER.map((key) => {
      const def = COLUMNS.find((c) => c.key === key);
      return { key, def: def!, short: SHORT_LABELS[key] };
    }),
  );

  // ——— cells ———————————————————————————————————————————————————————

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /**
   * `29 Aug 26` out of the string the phone sent. Never through a `Date`: the
   * stored value is already in the workout's own offset, and re-reading it in
   * the server's zone slides evening runs into the next day.
   */
  function shortLocalDate(row: ActivityTableRow): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((row.startDateLocal ?? '').trim());
    if (!m) return '—';
    const [, y, mo, d] = m;
    return `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y.slice(2)}`;
  }

  /** The full local date and time, for the cell's tooltip. */
  function fullLocal(row: ActivityTableRow): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec((row.startDateLocal ?? '').trim());
    if (!m) return shortLocalDate(row);
    const [, y, mo, d, h, mi] = m;
    return `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}, ${h}:${mi}`;
  }

  /** `118 · 147`. Either half may be missing and the other still stands. */
  function hrCell(row: ActivityTableRow): string {
    const avg = row.avgHeartrate && row.avgHeartrate > 0 ? Math.round(row.avgHeartrate) : null;
    const max = row.maxHeartrate && row.maxHeartrate > 0 ? Math.round(row.maxHeartrate) : null;
    if (avg == null && max == null) return '—';
    return `${avg ?? '—'} · ${max ?? '—'}`;
  }

  function paceCell(row: ActivityTableRow): string {
    if (!isPaceSport(row.activityType)) return formatSpeed(row.avgPaceSPerKm);
    // The heading already says PACE, so the unit would be repeated on every
    // row. Speed keeps its km/h, because that suffix is what tells the reader
    // the column has changed measure under them.
    const pace = formatPace(row.avgPaceSPerKm);
    return pace.endsWith(' /km') ? pace.slice(0, -4) : pace;
  }

  /** `13.8°` — the column is temperature, so the C is understood. */
  function tempCell(row: ActivityTableRow): string {
    const value = formatTemperature(row.temperatureC);
    return value.endsWith('°C') ? value.slice(0, -1) : value;
  }

  /** An all-time first: the row that holds a record, drawn loudest. */
  function isRecord(row: ActivityTableRow): boolean {
    return row.highlight?.scope === 'activity' && row.highlight.rank === 1;
  }

  function litColumn(row: ActivityTableRow): ColumnKey | null {
    const kind = row.highlight?.kind;
    return kind ? (HIGHLIGHT_COLUMN[kind] ?? null) : null;
  }

  /**
   * "Most efficient here on curlew.ochre.holloway" says *here* twice — the
   * segment name IS the here, so it goes when the name follows it.
   */
  function badgeLabel(row: ActivityTableRow): string {
    const h = row.highlight;
    if (!h) return '';
    return h.segmentName ? h.label.replace(/\s+here$/i, '') : h.label;
  }

  // ——— corrections —————————————————————————————————————————————————
  //
  // ONE panel for the whole table, not one per row: at a thousand rows a
  // per-row popover component is a thousand window listeners. The trigger is
  // the `···` beside the outing name; placement comes from placePopover,
  // because a panel anchored blindly below a row 900 deep in the list opens
  // under the fold, and scrolling to reach it closes it.

  let openMenuId = $state<string | null>(null);
  let pos = $state<PopoverPlacement | null>(null);
  let savingId = $state<string | null>(null);
  let note = $state<{ id: string; kind: 'ok' | 'error'; text: string } | null>(null);

  // Plain `let`, deliberately: an effect that measured the panel it also
  // positions loops until effect_update_depth_exceeded.
  let anchorEl: HTMLElement | null = null;
  let panelEl: HTMLElement | null = null;

  const target = $derived(openMenuId ? (rows.find((r) => r.id === openMenuId) ?? null) : null);

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

  /** `offsetHeight` reads back the max-height the last placement set. */
  function naturalHeight(node: HTMLElement): number {
    return Math.max(node.offsetHeight, node.scrollHeight + 2);
  }

  function reposition() {
    if (!openMenuId || !anchorEl || !anchorEl.isConnected) return;
    pos = placePopover(
      anchorEl.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { align: 'end', height: panelEl ? naturalHeight(panelEl) : POP_EST_HEIGHT },
    );
  }

  function panelMount(node: HTMLElement) {
    panelEl = node;
    reposition();
    node.focus({ preventScroll: true });
    return {
      destroy() {
        if (panelEl === node) panelEl = null;
      },
    };
  }

  function trapTab(event: KeyboardEvent) {
    if (event.key !== 'Tab' || !panelEl) return;
    const items = [...panelEl.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelEl)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Hand focus back to the trigger, but only when the closing panel holds it. */
  function closeMenu() {
    if (!openMenuId) return;
    const active = document.activeElement;
    if (anchorEl && active !== anchorEl && active instanceof Node && panelEl?.contains(active)) {
      anchorEl.focus();
    }
    openMenuId = null;
  }

  function toggleMenu(row: ActivityTableRow, event: MouseEvent) {
    if (openMenuId === row.id) {
      closeMenu();
      return;
    }
    anchorEl = event.currentTarget as HTMLElement;
    // The old panel is on its way out; measuring it would place the new one.
    panelEl = null;
    note = null;
    pos = placePopover(
      anchorEl.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { align: 'end', height: POP_EST_HEIGHT },
    );
    openMenuId = row.id;
  }

  function onWindowPointerDown(event: PointerEvent) {
    const el = event.target;
    if (!(el instanceof Element)) return;
    // A pointer user does not need focus handed back — the click they are
    // making moves it — so this path closes without restoring.
    if (!el.closest('[data-row-menu]')) openMenuId = null;
  }

  function onWindowKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeMenu();
  }

  async function patchRow(
    row: ActivityTableRow,
    body: { excludedFromSegments?: boolean; typeOverride?: string | null },
  ) {
    if (savingId) return;
    savingId = row.id;
    note = null;
    try {
      const res = await fetch(`/api/trails/activities/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as {
        error?: string;
        effortsRemoved?: number;
        activity?: {
          activityType: string;
          typeOverride: string | null;
          excludedFromSegments: boolean;
        };
      } | null;

      if (!res.ok || !payload?.activity) {
        note = {
          id: row.id,
          kind: 'error',
          text: payload?.error ?? `Update refused (${res.status}).`,
        };
        return;
      }

      const saved = payload.activity;
      oncorrected({
        id: row.id,
        // The server returns the SOURCE type in `activityType`; the effective
        // type is the override where there is one.
        activityType: saved.typeOverride?.trim() || saved.activityType,
        typeOverride: saved.typeOverride,
        excludedFromSegments: saved.excludedFromSegments,
        sourceType: saved.activityType,
      });

      const cleared =
        typeof payload.effortsRemoved === 'number'
          ? ` ${payload.effortsRemoved} effort${payload.effortsRemoved === 1 ? '' : 's'} cleared.`
          : '';
      note = {
        id: row.id,
        kind: 'ok',
        text: `Saved.${cleared} Segment rebuild scheduled; excellence badges refresh on reload.`,
      };
    } catch (err) {
      note = { id: row.id, kind: 'error', text: (err as Error)?.message ?? 'Update failed.' };
    } finally {
      savingId = null;
    }
  }
</script>

<svelte:window
  onpointerdown={onWindowPointerDown}
  onkeydown={onWindowKeyDown}
  onscroll={reposition}
  onresize={reposition}
/>

<section class="lg">
  <div class="lg-inner">
    <div class="lg-chips">
      <p class="lg-chips-label">Type</p>
      <button
        type="button"
        class="chip"
        class:on={activeTypes.length === 0}
        aria-pressed={activeTypes.length === 0}
        onclick={() => ontype(null)}
      >
        All <span class="chip-n">{loaded.toLocaleString('en-GB')}</span>
      </button>
      {#each typeCounts as t (t.activityType)}
        <button
          type="button"
          class="chip"
          class:on={activeTypes.includes(t.activityType)}
          aria-pressed={activeTypes.includes(t.activityType)}
          onclick={() => ontype(t.activityType)}
        >
          {t.label} <span class="chip-n">{t.count.toLocaleString('en-GB')}</span>
        </button>
      {/each}

      {#each chips as chip (chip.id)}
        <button type="button" class="chip removable" onclick={() => onclearchip(chip)}>
          {chip.label}<span class="chip-x" aria-hidden="true">×</span><span class="sr-only">
            — remove filter</span
          >
        </button>
      {/each}
      {#if chips.length > 0 || activeTypes.length > 0}
        <button type="button" class="chip clear" onclick={onclearall}>Clear all</button>
      {/if}
    </div>

    {#if highlightsFailed}
      <p class="lg-degraded">
        The excellence engine did not answer, so the Excellence column is empty. Everything else on
        this page is unaffected.
      </p>
    {/if}

    <div class="lg-scroll" onscroll={reposition}>
      <table class="lg-table">
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
                  {col.short}
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
            {@const lit = litColumn(row)}
            {@const record = isRecord(row)}
            <tr
              class:seg={row.highlight?.scope === 'segment'}
              class:record
              class:excluded={row.excludedFromSegments}
            >
              {#each columns as col (col.key)}
                <td
                  class="col-{col.key}"
                  class:right={col.def.align === 'right'}
                  class:lit={lit === col.key}
                >
                  {#if col.key === 'date'}
                    <span class="muted" title={fullLocal(row)}>{shortLocalDate(row)}</span>
                  {:else if col.key === 'name'}
                    <span class="lg-outing">
                      <a
                        class="lg-name"
                        title={row.name}
                        href="/health/activities/{encodeURIComponent(row.id)}">{row.name}</a
                      >
                      <button
                        type="button"
                        class="lg-menu"
                        data-row-menu
                        aria-haspopup="dialog"
                        aria-expanded={openMenuId === row.id}
                        aria-label="Corrections for {row.name}"
                        onclick={(event) => toggleMenu(row, event)}>···</button
                      >
                    </span>
                  {:else if col.key === 'type'}
                    {activityLabel(row.activityType)}
                    {#if row.typeOverride}
                      <span class="was" title="Corrected from {activityLabel(row.sourceType)}"
                        >{activityLabel(row.sourceType)}</span
                      >
                    {/if}
                  {:else if col.key === 'distance'}
                    {formatDistance(row.distanceM)}
                  {:else if col.key === 'time'}
                    {formatDuration(row.activeDurationS ?? row.durationS)}
                  {:else if col.key === 'climb'}
                    {formatElevation(row.elevationGainM)}
                  {:else if col.key === 'hr'}
                    {hrCell(row)}
                  {:else if col.key === 'pace'}
                    <span class="muted">{paceCell(row)}</span>
                  {:else if col.key === 'ef'}
                    {row.efficiencyFactor == null ? '—' : row.efficiencyFactor.toFixed(2)}
                  {:else if col.key === 'temp'}
                    <span class="muted">{tempCell(row)}</span>
                  {:else if col.key === 'segments'}
                    {row.segmentCount > 0 ? row.segmentCount : '—'}
                  {:else if highlightsFailed}
                    <span class="blank">—</span>
                  {:else if row.highlight}
                    <span
                      class="exc-badge scope-{row.highlight.scope}"
                      title={row.highlight.detail}
                      >{row.highlight.scope} · {badgeLabel(row)}{#if row.highlight
                        .segmentName}{' on '}{#if row.highlight.segmentId}<a
                            href="/health/segments/{row.highlight.segmentId}"
                            >{row.highlight.segmentName}</a
                          >{:else}{row.highlight.segmentName}{/if}{/if}</span
                    >
                  {:else if row.excludedFromSegments}
                    <span class="exc-note">Excluded from segments</span>
                  {:else if row.typeOverride}
                    <span class="exc-note">Type corrected by owner</span>
                  {:else}
                    <span class="blank">—</span>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if page.matching === 0}
      <div class="lg-empty">
        <p class="lg-empty-title">Nothing matches these filters.</p>
        <button type="button" class="chip clear" onclick={onclearall}>Clear all filters</button>
      </div>
    {/if}

    <div class="lg-foot">
      <p class="lg-count">
        {page.shown.toLocaleString('en-GB')} of {page.matching.toLocaleString('en-GB')} shown ·
        scroll the table sideways for every column
      </p>
      {#if page.remaining > 0}
        <div class="lg-more">
          <button type="button" class="chip" onclick={() => onmore(page.nextStep)}
            >Show {page.nextStep} more</button
          >
          <button type="button" class="chip" onclick={() => onmore(page.remaining)}
            >Show all {page.matching.toLocaleString('en-GB')}</button
          >
        </div>
      {/if}
    </div>
  </div>
</section>

{#if target && pos}
  {#key target.id}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="pop"
      data-row-menu
      role="dialog"
      aria-modal="true"
      aria-label="Corrections for {target.name}"
      tabindex="-1"
      use:panelMount
      onkeydown={trapTab}
      style="left: {pos.left}px; top: {pos.top}px; width: {POP_WIDTH}px; max-height: {pos.maxHeight}px"
    >
      <div class="pop-hd">
        <span class="pop-title">Correct this recording</span>
        <button type="button" class="pop-x" aria-label="Close" onclick={closeMenu}>×</button>
      </div>

      <button
        type="button"
        class="pop-btn"
        disabled={savingId === target.id}
        onclick={() => patchRow(target, { excludedFromSegments: !target.excludedFromSegments })}
      >
        {target.excludedFromSegments
          ? 'Put back into segment analysis'
          : 'Exclude from segment analysis'}
      </button>

      <label class="pop-field">
        <span class="pop-title">Correct type — now {activityLabel(target.activityType)}</span>
        <select
          value={target.typeOverride ?? ''}
          disabled={savingId === target.id}
          onchange={(event) => patchRow(target, { typeOverride: event.currentTarget.value || null })}
        >
          <option value="">No correction — source says {activityLabel(target.sourceType)}</option>
          {#each ACTIVITY_TYPES as type (type)}
            <option value={type}>{activityLabel(type)}</option>
          {/each}
        </select>
      </label>

      {#if savingId === target.id}
        <p class="pop-note">Saving…</p>
      {:else if note && note.id === target.id}
        <p class="pop-note" class:err={note.kind === 'error'}>{note.text}</p>
      {:else}
        <p class="pop-hint">
          Both corrections clear this outing's segment efforts and schedule a rebuild. Neither
          touches what the phone sent, so the next sync cannot undo them.
        </p>
      {/if}
    </div>
  {/key}
{/if}

<style>
  .lg {
    padding: clamp(30px, 3.6vw, 48px) clamp(20px, 3vw, 44px);
  }
  .lg-inner {
    max-width: 1500px;
    margin: 0 auto;
  }

  /* ——— chips ——— */
  .lg-chips {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 22px;
  }
  .lg-chips-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 8px 0 0;
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

  .lg-degraded {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    color: var(--warn);
    margin: 0 0 16px;
  }

  /* ——— table ——— */
  .lg-scroll {
    overflow-x: auto;
    border: 1px solid var(--card-border);
  }
  .lg-table {
    border-collapse: collapse;
    width: 100%;
    min-width: 1240px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }

  .lg-table thead tr {
    background: var(--card-bg);
    border-bottom: 2px solid rgba(26, 16, 8, 0.2);
  }
  .lg-table th {
    padding: 0;
    text-align: left;
    white-space: nowrap;
  }
  .col-btn {
    display: block;
    /* Positioned so the .sr-only inside it is contained HERE. An absolutely
       positioned element whose containing block is the initial one escapes
       every ancestor's overflow clip, so at 1,240px of table the hidden sort
       labels were stretching the whole page sideways on a phone. */
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
  .lg-table th.right .col-btn {
    text-align: right;
  }
  .lg-table th:first-child .col-btn {
    padding-left: 16px;
  }
  .lg-table th:last-child .col-btn {
    padding-right: 16px;
  }
  .col-btn:hover {
    color: var(--accent);
  }
  .lg-table th.sorted .col-btn {
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

  .lg-table tbody tr {
    border-bottom: 1px solid var(--line-hair);
    transition: background-color 0.2s ease-out;
  }
  .lg-table tbody tr:last-child {
    border-bottom: none;
  }
  /* Hover is a tint. No fade, no lift. */
  .lg-table tbody tr:hover {
    background: rgba(26, 16, 8, 0.05);
  }
  .lg-table tbody tr.seg {
    background: var(--accent-tint-04);
  }
  .lg-table tbody tr.record {
    background: var(--accent-tint-08);
  }
  .lg-table tbody tr.excluded {
    opacity: 0.6;
  }

  .lg-table td {
    padding: 12px;
    vertical-align: top;
  }
  .lg-table td:first-child {
    padding-left: 16px;
  }
  .lg-table td:last-child {
    padding-right: 16px;
  }
  .lg-table td.right {
    text-align: right;
    white-space: nowrap;
  }
  .lg-table td.col-type,
  .lg-table td.col-date {
    white-space: nowrap;
  }
  /* The one cell that is a CATEGORY rather than a measurement or a name. */
  .lg-table td.col-type {
    text-transform: uppercase;
  }
  .lg-table td.col-name {
    font-weight: 500;
  }
  .lg-table tbody tr.record td {
    font-weight: 700;
  }
  .lg-table td .muted {
    color: var(--text-muted);
  }
  .lg-table td.lit {
    font-weight: 700;
    color: var(--accent);
  }
  .lg-table td.lit .muted {
    color: var(--accent);
  }
  .blank {
    color: var(--text-ghost);
  }

  /* The outing and its corrections trigger stay on one line: the ··· dropping
     under the name reads as a second row. */
  .lg-outing {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .lg-name {
    /* One line, capped. A name is an identifier: wrapping it turns one row
       into two, and an outing called something enormous would otherwise set
       the width of the whole column. The full text stays in the title. */
    min-width: 0;
    max-width: 34ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: inherit;
    text-decoration: none;
    transition: color 0.2s ease-out;
  }
  .lg-name:hover {
    color: var(--accent);
  }
  .was {
    margin-left: 6px;
    color: var(--text-ghost);
    text-decoration: line-through;
  }

  .lg-menu {
    margin-left: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1;
    padding: 1px 4px;
    color: var(--text-ghost);
    background: none;
    border: 1px solid transparent;
    border-radius: 0;
    cursor: pointer;
    transition: color 0.2s ease-out;
  }
  .lg-menu:hover,
  .lg-menu[aria-expanded='true'] {
    color: var(--accent);
    border-color: var(--accent);
  }
  .lg-menu:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* ——— excellence ——— scope is the only thing that decides how loud a
     highlight is allowed to be. Kept in step with ReadingTheTable.svelte. */
  .exc-badge {
    display: inline-block;
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 3px 7px;
    border-radius: 0;
  }
  .exc-badge.scope-activity {
    font-weight: 700;
    background: var(--accent);
    color: var(--bg);
  }
  .exc-badge.scope-segment,
  .exc-badge.scope-environment {
    border: 1px solid var(--accent-tint-50);
    color: var(--accent);
  }
  .exc-badge.scope-rhythm {
    border: 1px solid var(--good-line);
    color: var(--good);
  }
  .exc-badge a {
    color: inherit;
    text-decoration: none;
    text-underline-offset: 2px;
    transition: color 0.2s ease-out;
  }
  .exc-badge a:hover,
  .exc-badge a:focus-visible {
    text-decoration: underline;
  }
  .exc-badge.scope-activity a:hover {
    color: var(--bg);
  }
  .exc-badge a:hover {
    color: var(--accent-hover);
  }
  .exc-note {
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  /* ——— foot ——— */
  .lg-empty {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    padding: 22px 0 0;
  }
  .lg-empty-title {
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
    margin: 0;
  }

  .lg-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 16px;
  }
  .lg-count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }
  .lg-more {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  /* ——— corrections panel ——— fixed, because an absolute panel inside the
     table's overflow scroller is a panel with its bottom half clipped. */
  .pop {
    position: fixed;
    z-index: 90;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.75rem;
    background: var(--surface-card);
    border: 1px solid var(--line-strong);
    border-radius: 0;
    overflow-y: auto;
  }
  .pop:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .pop-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .pop-title {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
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
  .pop-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    padding: 0.4rem 0.5rem;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    cursor: pointer;
  }
  .pop-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .pop-btn:disabled {
    opacity: 0.55;
    cursor: progress;
  }
  .pop-btn:focus-visible,
  .pop-field select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .pop-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .pop-field select {
    /* 16px, or mobile Safari zooms the viewport on focus. */
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
</style>
