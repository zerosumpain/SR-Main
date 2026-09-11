<script lang="ts">
  // THE CAST, AS ONE TABLE — every body the policy runs through, ranked on the
  // measure the reader picks, against the six questions that decide how each
  // would behave.
  //
  // 2026-09-11, John: *"now do the same for the actors page"*, after the stress
  // test. Measured first, at 1440 on the nine-body seed: **1,881px**, of which
  // the trait table was 1,143 and the bar chart above it 456.
  //
  // THE DIAGNOSIS WAS DUPLICATION, NOT DENSITY. The panel rendered the same nine
  // bodies THREE times — a ranked bar chart, a six-question grid underneath it,
  // and a five-measure table inside a disclosure. The chart and the grid opened
  // with the same two columns (the body, and the worst thing it could do), so a
  // reader scrolled past a ranking to reach a table that re-stated it.
  //
  // There is one table now. The measure switcher re-ranks it and redraws the bar
  // in its second column, which is what the chart was for; the six questions
  // stay where they were. Ask 5's five measures all still work, and the bodies
  // that score nothing on the chosen one sit at the foot WITHOUT a bar rather
  // than being dropped — this is the cast, so leaving a body out of it because
  // it scores zero on one measure would be a different (and wrong) table.
  //
  // A RANKED BAR, not a scatter and not a bubble cloud: each measure is one
  // magnitude per body, and a scatter would force two of the five on a reader
  // who asked to redraw on one. Colour does no work beyond magnitude — one hue,
  // the accent, with length carrying the value. The exposure BAND stays a word,
  // never a second hue, because the site's four validated categorical colours
  // are spent on the evidence mix and a fifth would be invented.
  import { ACTOR_MEASURES, ceiling, formatMeasure, rank, type AtlasRow, type MeasureKey } from '$lib/policy-analysis/actors';
  import type { TraitRow } from '$lib/policy-analysis/matrix';
  import { BAND_LABEL, type Band } from '$lib/policy-analysis/view';
  import ExplainLabel from './ExplainLabel.svelte';
  import CastTable from './CastTable.svelte';

  interface Props {
    rows: AtlasRow[];
    /** The same bodies, with the six questions. Ranked and filtered in step. */
    traits: TraitRow[];
    /** Open the drill on an artefact. */
    onopen: (id: string) => void;
    /** Send the reader to the playbook, filtered to one body's plays. */
    onplays?: (actorId: string) => void;
  }

  let { rows, traits, onopen, onplays }: Props = $props();

  let measure = $state<MeasureKey>('worst');
  /** Narrow the chart to bodies the library already knows. */
  let knownOnly = $state(false);
  /** Narrow to bodies with at least one play — "show me the ones that matter". */
  let armedOnly = $state(false);

  const filtered = $derived(
    rows.filter((r) => (!knownOnly || r.known) && (!armedOnly || r.measures.plays > 0)),
  );
  /**
   * SCORERS FIRST, THEN THE REST — never `rank()` alone.
   *
   * `rank()` drops every body scoring zero on the measure, which is right for a
   * chart (an empty bar reads as something the assessment measured) and wrong
   * for the cast: a body with no play still answers the six questions, and
   * leaving it out because it scores nothing on the column you happen to be
   * sorting by hides it. They sit at the foot with no bar, and the note says so.
   */
  const scoring = $derived(rank(filtered, measure));
  const ordered = $derived([...scoring, ...filtered.filter((r) => r.measures[measure] === 0)]);
  const top = $derived(ceiling(scoring, measure));
  const current = $derived(ACTOR_MEASURES.find((m) => m.key === measure) ?? ACTOR_MEASURES[0]);
  /** Bodies that score nothing on this measure — named, never silently dropped. */
  const silent = $derived(filtered.length - scoring.length);

  /** The trait rows, in the order and the subset the controls just chose. */
  const byId = $derived(new Map(traits.map((t) => [t.id, t])));
  const shownTraits = $derived(ordered.map((r) => byId.get(r.id)).filter((t): t is TraitRow => Boolean(t)));

  /** Each body's score on the current measure, for the bar in column two. */
  const scores = $derived(
    new Map(
      ordered.map((r) => [
        r.id,
        { text: formatMeasure(measure, r.measures[measure]), frac: r.measures[measure] / top, band: r.band },
      ]),
    ),
  );
</script>

<div class="atlas">
  <!-- Filters in ONE row above the chart, which is where a reader looks for
       them and what the site's other dashboards do. -->
  <div class="at-controls">
    <div class="at-measures pa-seg" role="radiogroup" aria-label="Redraw the chart on">
      <span class="at-controls-label">Rank by</span>
      {#each ACTOR_MEASURES as m (m.key)}
        <button
          type="button"
          role="radio"
          aria-checked={measure === m.key}
          class="at-measure"
          class:on={measure === m.key}
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

  <!--
    ONE TABLE. The bar chart that used to sit here drew the same nine bodies
    the grid below it already listed, opening with the same two columns — so a
    reader scrolled 456px past a ranking to reach a table that re-stated it.
    The ranking lives in the grid's second column now, and the switcher above
    re-ranks the whole thing.
  -->
  <CastTable
    rows={shownTraits}
    {onopen}
    onplays={onplays ?? (() => {})}
    rankBy={{ label: current.label, term: measure, values: scores }}
  />

  {#if silent > 0}
    <p class="at-note">
      {silent} further {silent === 1 ? 'body scores' : 'bodies score'} nothing on this measure and {silent === 1 ? 'sits' : 'sit'} at
      the foot without a bar rather than being drawn as a zero — an empty bar reads as something the
      assessment measured. {silent === 1 ? 'It answers' : 'They answer'} the six questions like any other.
    </p>
  {/if}
  {#if !ordered.length}
    <p class="at-empty">
      No body matches those filters. Clear them above, or read the structural checks, which do not depend on
      a body having been profiled.
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
  /* `.pa-seg` in the layout owns the layout and the states. */
  .at-controls-label,
  .at-toggle {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
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

  /*
   * On paper a filter row is a decoration — nothing can be pressed — and the
   * reader wants all five measures at once rather than the one the screen
   * happened to be sorted by, so the disclosure opens into the full table.
   */
  @media print {
    .at-controls {
      display: none !important;
    }
    .at-table-wrap summary {
      display: none;
    }
  }
</style>
