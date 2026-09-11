<script lang="ts">
  // THE ACTOR ATLAS — every body the policy runs through, on the measure the
  // reader picks.
  //
  // Ask 5, which named five measures: how many exposures a body is tied to, the
  // biggest risk it poses, how significant its role in the policy is, how often
  // it is referenced, and how many relationships it has. All five are already in
  // the data and none of them needed a model.
  //
  // A RANKED BAR, not a scatter and not a bubble cloud. Each measure is one
  // magnitude per body, and a scatter would force two of the five on the reader
  // when the ask was explicitly to redraw on one. Bars also survive being
  // printed, which a force-directed anything does not.
  //
  // Colour does no work here beyond magnitude: one hue, the accent, with the
  // length of the bar carrying the value. The exposure BAND is a separate,
  // categorical thing and is printed as a word — never as a second hue, because
  // the site's four validated categorical colours are spent on the evidence mix
  // and a fifth would be invented.
  //
  // The table under the chart carries the same numbers for print and for a
  // screen reader, and it is the same rows in the same order — not a summary of
  // them.
  import { ACTOR_MEASURES, ceiling, formatMeasure, rank, type AtlasRow, type MeasureKey } from '$lib/policy-analysis/actors';
  import { BAND_LABEL, type Band } from '$lib/policy-analysis/view';
  import ExplainLabel from './ExplainLabel.svelte';

  interface Props {
    rows: AtlasRow[];
    /** Open the drill on an artefact. */
    onopen: (id: string) => void;
    /** Send the reader to the playbook, filtered to one body's plays. */
    onplays?: (actorId: string) => void;
  }

  let { rows, onopen, onplays }: Props = $props();

  let measure = $state<MeasureKey>('worst');
  /** Narrow the chart to bodies the library already knows. */
  let knownOnly = $state(false);
  /** Narrow to bodies with at least one play — "show me the ones that matter". */
  let armedOnly = $state(false);

  const filtered = $derived(
    rows.filter((r) => (!knownOnly || r.known) && (!armedOnly || r.measures.plays > 0)),
  );
  const ranked = $derived(rank(filtered, measure));
  const top = $derived(ceiling(ranked, measure));
  const current = $derived(ACTOR_MEASURES.find((m) => m.key === measure) ?? ACTOR_MEASURES[0]);
  /** Bodies that score nothing on this measure — named, never silently dropped. */
  const silent = $derived(filtered.length - ranked.length);

  /** How many bars before the chart becomes a wall. The rest stay in the table. */
  const DRAWN = 18;
  const drawn = $derived(ranked.slice(0, DRAWN));

  const width = (row: AtlasRow) => Math.max(1.5, (row.measures[measure] / top) * 100);
</script>

<div class="atlas">
  <!-- Filters in ONE row above the chart, which is where a reader looks for
       them and what the site's other dashboards do. -->
  <div class="at-controls">
    <div class="at-measures" role="radiogroup" aria-label="Redraw the chart on">
      <span class="at-controls-label">Rank by</span>
      {#each ACTOR_MEASURES as m (m.key)}
        <button
          type="button"
          role="radio"
          aria-checked={measure === m.key}
          class="at-measure"
          class:on={measure === m.key}
          data-pa-peek={`term:${m.key}`}
          onclick={() => (measure = m.key)}
        >{m.label}</button>
      {/each}
    </div>
    <div class="at-toggles">
      <label class="at-toggle">
        <input type="checkbox" bind:checked={armedOnly} />
        Only bodies with a play
      </label>
      <label class="at-toggle">
        <input type="checkbox" bind:checked={knownOnly} />
        Only bodies in your library
      </label>
    </div>
  </div>

  <p class="at-note">{current.note}</p>

  {#if drawn.length}
    <!--
      An HTML bar chart rather than an SVG one. Every bar carries a real text
      token at the site's 12px floor, the labels wrap, and the whole thing
      reflows at 390px — none of which an SVG viewBox gives without hand-tuning
      type that the font-size gate then rightly fails.
    -->
    <div class="at-chart">
      {#each drawn as row, index (row.id)}
        <div class="at-row">
          <button
            type="button"
            class="at-name"
            data-pa-peek={`actor:${row.id}`}
            onclick={() => onopen(row.view.profile?.id ?? row.id)}
          >
            <span class="at-rank">{index + 1}</span>
            <span class="at-name-text">{row.label}</span>
          </button>
          <div class="at-bar-cell">
            <span class="at-bar" style="width: {width(row)}%"></span>
            <span class="at-value">{formatMeasure(measure, row.measures[measure])}</span>
          </div>
          <div class="at-tail">
            <span class="at-band">{row.band ? (BAND_LABEL[row.band as Band] ?? row.band) : ''}</span>
            {#if onplays && row.measures.plays > 0}
              <button type="button" class="at-plays" onclick={() => onplays(row.id)}>
                {row.measures.plays} {row.measures.plays === 1 ? 'play' : 'plays'} →
              </button>
            {:else}
              <span class="at-type">no play</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    {#if ranked.length > DRAWN}
      <p class="at-note">
        The chart draws the top {DRAWN} of {ranked.length}. Every body is in the table below.
      </p>
    {/if}
    {#if silent > 0}
      <p class="at-note">
        {silent} further {silent === 1 ? 'body scores' : 'bodies score'} nothing on this measure and {silent === 1 ? 'is' : 'are'} left
        off the chart rather than drawn as a zero — an empty bar reads as something the assessment measured.
      </p>
    {/if}
  {:else}
    <p class="at-empty">
      No body scores on this measure. That is not the same as a clean policy — try another measure, or read
      the structural checks, which do not depend on a body having been profiled.
    </p>
  {/if}

  <!-- The same rows, as a table. For print, for a screen reader, and for anyone
       who would rather read five numbers than switch between five charts. -->
  <details class="at-table-wrap">
    <summary>Every body, every measure</summary>
    <div class="at-scroll">
      <table class="at-table">
        <thead>
          <tr>
            <th scope="col">Body</th>
            <th scope="col">Type</th>
            {#each ACTOR_MEASURES as m (m.key)}
              <th scope="col" class="at-num"><ExplainLabel term={m.key} text={m.label} /></th>
            {/each}
            <th scope="col">Worst band</th>
          </tr>
        </thead>
        <tbody>
          {#each rank(filtered, measure).concat(filtered.filter((r) => r.measures[measure] === 0)) as row (row.id)}
            <tr>
              <th scope="row">
                <button type="button" class="at-cell-link" data-pa-peek={`actor:${row.id}`} onclick={() => onopen(row.view.profile?.id ?? row.id)}>{row.label}</button>
              </th>
              <td class="at-type-cell">{row.entityType || '—'}</td>
              {#each ACTOR_MEASURES as m (m.key)}
                <td class="at-num" class:at-current={m.key === measure}>{formatMeasure(m.key, row.measures[m.key])}</td>
              {/each}
              <td>{row.band ? (BAND_LABEL[row.band as Band] ?? row.band) : '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </details>
</div>

<style>
  .at-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 20px;
  }
  .at-measures {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .at-controls-label,
  .at-toggle {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .at-measure {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 6px 10px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .at-measure:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .at-measure.on {
    background: var(--text-primary);
    border-color: var(--text-primary);
    color: var(--bg);
  }
  .at-toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
  }
  .at-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .at-toggle input {
    accent-color: var(--accent);
  }

  .at-note {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    margin: 12px 0 0;
    max-width: 72ch;
  }
  .at-empty {
    border-left: 2px solid var(--line-strong);
    padding-left: 14px;
    color: var(--text-secondary);
    margin: 20px 0 0;
    max-width: 66ch;
  }

  .at-chart {
    display: grid;
    gap: 1px;
    background: var(--divider);
    border: 1px solid var(--divider);
    margin-top: 18px;
  }
  .at-row {
    display: grid;
    grid-template-columns: minmax(9rem, 16rem) minmax(0, 1fr) 12.4rem;
    align-items: center;
    gap: 14px;
    background: var(--bg);
    padding: 7px 11px;
  }
  .at-row:hover {
    background: var(--accent-tint-04);
  }

  .at-name {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font: inherit;
    font-size: var(--fs-label);
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    min-width: 0;
  }
  .at-name:hover .at-name-text,
  .at-name:focus-visible .at-name-text {
    color: var(--accent);
    text-decoration: underline;
  }
  .at-rank {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
  }
  .at-name-text {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .at-bar-cell {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 2.4rem;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  /* 4px rounded data-end, anchored square to the baseline at the axis. */
  .at-bar {
    display: block;
    height: 13px;
    background: var(--accent);
    border-radius: 0 4px 4px 0;
    min-width: 3px;
    flex: 0 0 auto;
  }
  .at-value {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .at-tail {
    display: grid;
    grid-template-columns: 6.4rem 5rem;
    align-items: baseline;
    gap: 10px;
    justify-content: end;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    min-width: 0;
  }
  .at-band {
    color: var(--accent);
  }
  .at-type {
    color: var(--text-ghost);
  }
  .at-plays {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    color: var(--accent-ink);
    text-decoration: underline;
    cursor: pointer;
    white-space: nowrap;
  }
  .at-plays:hover {
    color: var(--accent);
  }

  .at-table-wrap {
    margin-top: 22px;
    border-top: 1px solid var(--line-strong);
  }
  .at-table-wrap summary {
    cursor: pointer;
    padding: 11px 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .at-table-wrap summary:hover {
    color: var(--accent);
  }
  /* Wide content scrolls inside its own container; the page never scrolls
     sideways. */
  .at-scroll {
    overflow-x: auto;
  }
  .at-table {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--fs-label);
  }
  .at-table th,
  .at-table td {
    text-align: left;
    padding: 6px 12px 6px 0;
    border-bottom: 1px solid var(--line);
    vertical-align: baseline;
  }
  .at-table thead th {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
    font-weight: 500;
    white-space: nowrap;
  }
  .at-table tbody th {
    font-weight: 400;
  }
  .at-num {
    text-align: right;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .at-current {
    color: var(--accent);
  }
  .at-type-cell {
    color: var(--text-muted);
    text-transform: capitalize;
  }
  .at-cell-link {
    font: inherit;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    color: var(--accent-ink);
    text-decoration: underline;
    cursor: pointer;
    text-align: left;
  }

  @media (max-width: 780px) {
    .at-row {
      grid-template-columns: minmax(0, 1fr);
      gap: 5px;
      padding: 10px 11px;
    }
    .at-tail {
      justify-content: start;
    }
  }

  /* On paper the chart is the table — a bar with no hover and no filter row is
     a decoration, and the reader needs all five measures at once anyway. */
  @media print {
    .at-controls,
    .at-chart {
      display: none !important;
    }
    .at-table-wrap summary {
      display: none;
    }
    .at-bar {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
