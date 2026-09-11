<script lang="ts">
  // BODIES × BODIES — the shape of the policy, at last.
  //
  // The network workspace ran to 4,481px and never drew the network: six family
  // small-multiples, six prose readings, and a 37-row list of "A REGULATES B".
  // All of that is true and none of it answers the question a reader brings to a
  // policy graph, which is structural: who is everything wired through, who
  // answers to nobody, and which links does the paper state in one direction
  // only.
  //
  // A grid answers all three by shape. A full row is a body that acts on
  // everything; an empty column is a body nothing acts on; a cell with no
  // partner across the diagonal is a one-way relationship. The reader does not
  // have to be told — it is visible.
  //
  // FAMILIES ARE GLYPHS, NOT COLOURS. The site has exactly four validated
  // categorical hues and there are seven families, so colouring them would mean
  // inventing three — the one thing the chart rules forbid outright. Each family
  // gets an initial in mono, and the accent is used only for density (how many
  // relationships the cell holds), which is a magnitude and may have a ramp.
  //
  // It is CAPPED, because a grid is legible only while both axes fit. The
  // busiest twelve bodies are drawn, the rest are named underneath, and the
  // caption says what share of the graph is on screen — a picture of half a
  // graph that does not say so is worse than a list.
  import { axisLabel, cellSentence, type Adjacency, type AdjacencyCell } from '$lib/policy-analysis/matrix';
  import { RELATION_FAMILIES, familyTermKey, type RelationFamilyKey } from '$lib/policy-analysis/glossary';

  import ExplainLabel from './ExplainLabel.svelte';

  interface Props {
    grid: Adjacency;
    onopen: (id: string) => void;
  }

  let { grid, onopen }: Props = $props();

  /** One letter per family, in the canonical order, for the cell glyphs. */
  const GLYPH: Record<string, string> = {
    authority: 'A',
    money: 'M',
    delivery: 'D',
    accountability: 'R',
    influence: 'I',
    dependence: 'P',
    evidence: 'E',
  };

  /** Which family the reader has isolated, or null for all of them. */
  let only = $state<RelationFamilyKey | null>(null);

  const visible = (cell: AdjacencyCell | null) =>
    cell && (!only || cell.families.includes(only)) ? cell : null;

  const shownShare = $derived(grid.total ? Math.round((grid.shown / grid.total) * 100) : 0);
</script>

<div class="ag">
  <div class="ag-controls pa-seg">
    <span class="ag-controls-label">Show</span>
    <button type="button" class:on={only === null} onclick={() => (only = null)}>Every link</button>
    {#each RELATION_FAMILIES as family (family.key)}
      <button
        type="button"
        class:on={only === family.key}
        data-pa-peek={`term:${familyTermKey(family.key)}`}
        onclick={() => (only = only === family.key ? null : family.key)}
      >
        <span class="ag-glyph" aria-hidden="true">{GLYPH[family.key]}</span>
        {family.label}
      </button>
    {/each}
  </div>

  <p class="ag-caption">
    The {grid.bodies.length} bodies the most relationships run through, each row acting on the columns.
    {grid.shown} of {grid.total} stated relationships ({shownShare}%) have both ends on this grid.
    <strong>{grid.reciprocal}</strong>
    {grid.reciprocal === 1 ? 'pair is' : 'pairs are'} stated in both directions and
    <strong>{grid.oneWay}</strong>
    in one only — a one-way link is a counterpart the paper does not close, which is a gap in the document
    rather than proof that no such arrangement exists.
  </p>

  <div class="ag-wrap">
    <table class="ag-table">
      <caption class="sr-only">
        Relationships between the {grid.bodies.length} busiest bodies. Rows act on columns.
      </caption>
      <thead>
        <tr>
          <th scope="col" class="ag-corner">
            <span class="ag-corner-from">Row acts on ↓</span>
            <span class="ag-corner-to">→ Column</span>
          </th>
          {#each grid.bodies as body (body.id)}
            <th scope="col" class="ag-col-head">
              <button class="ag-axis" data-pa-peek={`actor:${body.id}`} onclick={() => onopen(body.id)}>
                <span class="ag-axis-text">{axisLabel(body.label, 22)}</span>
              </button>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each grid.bodies as from, i (from.id)}
          <tr>
            <th scope="row" class="ag-row-head">
              <button class="ag-axis" data-pa-peek={`actor:${from.id}`} onclick={() => onopen(from.id)}>
                {axisLabel(from.label, 30)}
              </button>
              <span class="ag-degree">{from.degree}</span>
            </th>
            {#each grid.bodies as to, j (to.id)}
              {@const cell = visible(grid.rows[i][j])}
              <td class:self={i === j} class:live={Boolean(cell)}>
                {#if cell}
                  <!-- A button, so the cell is reachable by keyboard: a
                       `data-pa-peek` on a non-focusable element never fires
                       `onfocusin` and the explainer does not exist without a
                       pointer. -->
                  <button
                    class="ag-cell"
                    style={`--ag-weight: ${Math.min(1, cell.ids.length / 3)}`}
                    title={cellSentence(from.label, to.label, cell)}
                    aria-label={cellSentence(from.label, to.label, cell)}
                    data-pa-peek={`artefact:${cell.ids[0]}`}
                    onclick={() => onopen(cell.ids[0])}
                  >
                    {#each cell.families as family (family)}<span class="ag-g">{GLYPH[family]}</span>{/each}
                    {#if !cell.families.length}<span class="ag-g">·</span>{/if}
                    {#if cell.ids.length > 1}<span class="ag-n">{cell.ids.length}</span>{/if}
                  </button>
                {:else if i === j}
                  <span class="ag-diag" aria-hidden="true"></span>
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="ag-legend">
    {#each RELATION_FAMILIES as family (family.key)}
      <span class="ag-key">
        <span class="ag-glyph" aria-hidden="true">{GLYPH[family.key]}</span>
        <ExplainLabel term={familyTermKey(family.key)} text={family.label} />
      </span>
    {/each}
  </div>

  {#if grid.omitted.length}
    <p class="ag-omitted">
      {grid.omitted.length} further {grid.omitted.length === 1 ? 'body is' : 'bodies are'} not on the grid,
      each with fewer relationships than the {grid.bodies.length} above: {grid.omitted
        .slice(0, 8)
        .map((b) => b.label)
        .join(', ')}{grid.omitted.length > 8 ? `, and ${grid.omitted.length - 8} more` : ''}. Every
      relationship they carry is in the full list below.
    </p>
  {/if}
</div>

<style>
  .ag {
    margin-top: clamp(14px, 1.8vw, 20px);
  }

  /* `.pa-seg` in the layout owns the layout and the states. */
  .ag-controls {
    margin-bottom: 12px;
  }
  .ag-controls-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .ag-caption {
    margin: 0 0 12px;
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 90ch;
  }

  /* The scroll is on the wrapper; the page never scrolls sideways for a grid. */
  .ag-wrap {
    overflow-x: auto;
    border: 1px solid var(--line-strong);
  }
  /* Fills the column. A nine-body grid of 2.6rem cells used a third of the
     width and read as a thumbnail of itself; the cells spread instead, which
     also makes them easier to hit. The wrapper still scrolls when a twelve-body
     grid outgrows a narrow window. */
  .ag-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: var(--fs-label);
  }

  .ag-corner,
  .ag-col-head {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--surface-elevated);
    border-bottom: 2px solid var(--text-primary);
    vertical-align: bottom;
    padding: 8px 4px;
  }
  .ag-corner {
    left: 0;
    z-index: 3;
    width: 13rem;
    min-width: 13rem;
    text-align: left;
    border-right: 1px solid var(--line-strong);
  }
  .ag-corner-from,
  .ag-corner-to {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    font-weight: 500;
    color: var(--text-muted);
  }

  /* Column heads are rotated, which is what makes twelve of them fit: a
     horizontal head would need 12 × 9rem and the grid would be wider than any
     monitor. The rotation is on an inner span so the sticky cell itself stays a
     normal box. */
  .ag-col-head {
    min-width: 2.6rem;
    height: 9.5rem;
    padding: 0;
  }
  .ag-axis-text {
    display: block;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    max-height: 9rem;
    overflow: hidden;
    text-align: left;
  }

  .ag-row-head {
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--surface-elevated);
    border-right: 1px solid var(--line-strong);
    border-bottom: 1px solid var(--line-hair);
    text-align: left;
    font-weight: 400;
    padding: 6px 8px;
    display: table-cell;
  }
  .ag-axis {
    font: inherit;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    text-align: left;
    color: var(--text-primary);
    cursor: pointer;
    line-height: 1.25;
  }
  .ag-axis:hover {
    color: var(--accent);
  }
  .ag-degree {
    margin-left: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .ag-table td {
    min-width: 2.6rem;
    height: 2.4rem;
    padding: 0;
    text-align: center;
    border-right: 1px solid var(--line-hair);
    border-bottom: 1px solid var(--line-hair);
  }
  /* The diagonal is not data. A body relating to itself is a modelling error,
     so the cell is struck out rather than left as an inviting blank. */
  .ag-table td.self {
    background: repeating-linear-gradient(
      45deg,
      transparent,
      transparent 3px,
      var(--line-hair) 3px,
      var(--line-hair) 4px
    );
  }

  .ag-cell {
    font: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1px;
    width: 100%;
    height: 100%;
    min-height: 2.4rem;
    border: 0;
    border-radius: 0;
    padding: 0;
    cursor: pointer;
    /* Density is a magnitude, so it is the one accent ramp on this grid. */
    background: color-mix(in oklab, var(--accent) calc(18% + var(--ag-weight, 0) * 52%), var(--bg));
  }
  .ag-cell:hover {
    outline: 2px solid var(--text-primary);
    outline-offset: -2px;
  }
  .ag-g {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    letter-spacing: 0;
    color: var(--text-primary);
  }
  .ag-n {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-primary);
    opacity: 0.7;
  }

  .ag-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin-top: 10px;
  }
  .ag-key {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .ag-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.15rem;
    height: 1.15rem;
    border: 1px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    color: var(--text-primary);
    flex: none;
  }

  .ag-omitted {
    margin: 10px 0 0;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    max-width: 90ch;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  @media print {
    .ag-controls {
      display: none !important;
    }
    .ag-wrap {
      overflow: visible;
      border-color: #000;
    }
    .ag-corner,
    .ag-col-head,
    .ag-row-head {
      position: static;
      background: #fff;
    }
    /* A cell's fill IS the reading here, so it must survive the printer's
       default of dropping backgrounds. */
    .ag-cell,
    .ag-table td.self {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .ag-table {
      break-inside: avoid;
    }
  }
</style>
