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
  //
  // AND WHEN THERE IS NO SHAPE, IT SAYS SO. A grid draws pairs, and a policy
  // written as beneficiaries-and-machinery states almost none: Best Start in
  // Life had 32 body-to-body relationships in 452, thin enough that the best
  // possible grid holds four live cells. The page used to draw 144 empty ones
  // under "0 of 452 (0%)", which a reader can only take as a broken chart. Below
  // `MIN_GRID_EDGES` the frame is dropped and the relationships are listed
  // instead — the same content, and the absence of a mesh stated as the finding
  // it is rather than left to be inferred from blank cells.
  import { axisLabel, cellSentence, type Adjacency, type AdjacencyCell, type BodyLink } from '$lib/policy-analysis/matrix';
  import { RELATION_FAMILIES, familyTermKey, type RelationFamilyKey } from '$lib/policy-analysis/glossary';

  import ExplainLabel from './ExplainLabel.svelte';

  interface Props {
    grid: Adjacency;
    /** Every body-to-body relationship, for the list the grid degrades to. */
    links?: BodyLink[];
    onopen: (id: string) => void;
  }

  let { grid, links = [], onopen }: Props = $props();

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

  // Against `placeable`, never against `total`. Every relationship running from
  // a body to a piece of machinery was never grid material, and counting it in
  // the denominator turns the cap's share into an indictment of the extraction.
  const shownShare = $derived(grid.placeable ? Math.round((grid.shown / grid.placeable) * 100) : 0);
  const bodyShare = $derived(grid.total ? Math.round((grid.placeable / grid.total) * 100) : 0);
  const shownLinks = $derived(links.filter((l) => !only || l.families.includes(only)));
  /** A long list is a scroll, not a reading; the family filter reaches the rest. */
  const LINKS = 40;
  /**
   * A row labels itself only where it DIFFERS from what the list mostly is.
   *
   * Same rule as `traitCoverage`'s dominant origin, and for the same reason: the
   * first cut of this list wrote "one way only" against all thirty-two rows,
   * which is thirty-two repetitions of one true label hiding the pairs that are
   * actually closed. One-way is the ordinary state of a policy graph, so the
   * count is stated once in the reading and only a return leg marks its row.
   */
  const closed = $derived(shownLinks.filter((l) => l.reciprocated).length);
</script>

<div class="ag">
  <div class="ag-controls pa-seg">
    <span class="ag-controls-label">Show</span>
    <button type="button" class:on={only === null} onclick={() => (only = null)}>Every link</button>
    {#each RELATION_FAMILIES as family (family.key)}
      <button
        type="button"
        class:on={only === family.key}
        onclick={() => (only = only === family.key ? null : family.key)}
      >
        <span class="ag-glyph" aria-hidden="true">{GLYPH[family.key]}</span>
        {family.label}
      </button>
    {/each}
  </div>

  <p class="ag-caption">
    The paper states <strong>{grid.total}</strong>
    {grid.total === 1 ? 'relationship' : 'relationships'}, of which
    <strong>{grid.placeable}</strong> ({bodyShare}%) run between two bodies — the only kind a grid of bodies
    against bodies can hold. The rest run from a body to a piece of machinery or to a claim.
    {#if grid.legible}
      The {grid.bodies.length} busiest of those bodies are drawn here, each row acting on the columns, carrying
      {grid.shown} of the {grid.placeable} ({shownShare}%).
      <strong>{grid.reciprocal}</strong>
      {grid.reciprocal === 1 ? 'pair is' : 'pairs are'} stated in both directions and
      <strong>{grid.oneWay}</strong>
      in one only — a one-way link is a counterpart the paper does not close, which is a gap in the document
      rather than proof that no such arrangement exists.
    {/if}
  </p>

  {#if !grid.legible}
    <!--
      THE STAR STATE. Not an error and not an empty state in the usual sense —
      the assessment found plenty, it simply found a document that names who
      benefits and what will be done far more often than it names who answers to
      whom. Saying that in words and listing what the paper does state is a
      better answer to "how do they connect" than a frame with four live cells.
    -->
    <section class="ag-star">
      <h3>{grid.placeable ? 'This policy is a star, not a mesh' : 'The paper wires no two bodies together'}</h3>
      <p class="ag-star-reading">
        {#if grid.placeable}
          {grid.placeable}
          {grid.placeable === 1 ? 'relationship runs' : 'relationships run'} between two bodies, spread across
          {links.length}
          {links.length === 1 ? 'pair' : 'pairs'} — too thin for a grid to show a shape, so they are listed
          instead, the busiest pair first.
          {#if closed}
            {closed} of them {closed === 1 ? 'is' : 'are'} stated in both directions and marked; the rest run one
            way only, which is a counterpart the paper does not close rather than proof that none exists.
          {:else}
            Not one is stated in both directions: every link below is a counterpart the paper leaves open.
          {/if}
        {:else}
          Not one of the {grid.total}
          {grid.total === 1 ? 'relationship' : 'relationships'} runs between two bodies. Every one of them runs
          from a body to a piece of machinery or to a claim, so there is nothing a grid of bodies against bodies
          could hold.
        {/if}
        That is a fact about the document rather than a gap in the assessment: a paper written as beneficiaries
        and delivery has little institutional wiring to draw. Where the machinery
        <em>is</em> wired is in the readings below, and in the family breakdown under them.
      </p>
      {#if shownLinks.length}
        <ul class="ag-star-list">
          {#each shownLinks.slice(0, LINKS) as link (link.fromId + '|' + link.toId)}
            <li>
              <button type="button" class="ag-star-end" onclick={() => onopen(link.fromId)}>{link.fromLabel}</button>
              <span class="ag-star-verb">{link.relations.map((r) => r.replaceAll('_', ' ')).join(', ')}</span>
              <button type="button" class="ag-star-end" onclick={() => onopen(link.toId)}>{link.toLabel}</button>
              <span class="ag-star-meta">
                {#each link.families as family (family)}<span class="ag-glyph" aria-hidden="true">{GLYPH[family]}</span>{/each}
                {#if link.reciprocated}<span class="ag-star-back">stated both ways</span>{/if}
              </span>
              <button type="button" class="ag-star-open" onclick={() => onopen(link.ids[0])}>Open →</button>
            </li>
          {/each}
        </ul>
        {#if shownLinks.length > LINKS}
          <p class="ag-star-note">
            Listing the first {LINKS} of {shownLinks.length}. Narrow by family to reach the rest — none is dropped.
          </p>
        {/if}
      {:else if grid.placeable}
        <p class="ag-star-note">No body-to-body relationship uses that family.</p>
      {/if}
    </section>
  {:else}
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
              <button class="ag-axis" title={body.label} onclick={() => onopen(body.id)}>
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
              <button class="ag-axis" title={from.label} onclick={() => onopen(from.id)}>
                {axisLabel(from.label, 30)}
              </button>
              <!--
                The count beside a row is the one the ORDER is made of — how many
                relationships this body has to another body — not its total. They
                differ by an order of magnitude on a star-shaped policy, and a
                visible number that does not explain the ranking beside it is the
                "two numbers for one quantity" defect in a smaller form.
              -->
              <span class="ag-degree" title={`${from.links} to another body, ${from.degree} in all`}>{from.links}</span>
            </th>
            {#each grid.bodies as to, j (to.id)}
              {@const cell = visible(grid.rows[i][j])}
              <td class:self={i === j} class:live={Boolean(cell)}>
                {#if cell}
                  <!--
                    A button, so the cell is reachable by keyboard — and its own
                    sentence is the `title`, not a styled card. A grid this size
                    can hold 144 live cells, and a popover on each was the
                    clutter that made the dense views tiring; the click still
                    opens the relationship in full.
                  -->
                  <button
                    class="ag-cell"
                    style={`--ag-weight: ${Math.min(1, cell.ids.length / 3)}`}
                    title={cellSentence(from.label, to.label, cell)}
                    aria-label={cellSentence(from.label, to.label, cell)}
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
  {/if}

  <div class="ag-legend">
    {#each RELATION_FAMILIES as family (family.key)}
      <span class="ag-key">
        <span class="ag-glyph" aria-hidden="true">{GLYPH[family.key]}</span>
        <ExplainLabel term={familyTermKey(family.key)} text={family.label} />
      </span>
    {/each}
  </div>

  {#if grid.legible && grid.omitted.length}
    <p class="ag-omitted">
      {grid.omitted.length} further {grid.omitted.length === 1 ? 'body is' : 'bodies are'} not on the grid,
      each carrying fewer relationships to another body than the {grid.bodies.length} above: {grid.omitted
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

  /* THE STAR STATE — a reading, not an error panel. It carries the same border
     as the grid wrapper it replaces so the tab keeps its rhythm, and the list
     inside it is the grid's content in one dimension. */
  .ag-star {
    border: 1px solid var(--line-strong);
    padding: clamp(14px, 1.8vw, 20px);
  }
  .ag-star h3 {
    margin: 0 0 8px;
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    line-height: 1.15;
    color: var(--text-primary);
  }
  .ag-star-reading {
    margin: 0 0 16px;
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 78ch;
  }
  .ag-star-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line-hair);
  }
  .ag-star-list li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto auto;
    align-items: baseline;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--line-hair);
    font-size: var(--fs-label);
  }
  /* Name, verb, name — the triple reads as a relationship rather than as two
     columns with a gap between them. */
  .ag-star-list li > .ag-star-end:first-child {
    justify-self: end;
    text-align: right;
  }
  .ag-star-end {
    justify-self: start;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    text-align: left;
    color: var(--text-primary);
    cursor: pointer;
    border-bottom: 1px solid var(--line-strong);
  }
  .ag-star-end:hover {
    color: var(--accent);
  }
  .ag-star-verb {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .ag-star-meta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  /* Petrol, never the accent: the accent already carries magnitude inside a
     cell, and a two-hue pair of accent and success fails colourblind
     separation. */
  .ag-star-back {
    color: var(--accent-ink);
  }
  .ag-star-open {
    border: 0;
    background: none;
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
  }
  .ag-star-open:hover {
    color: var(--accent);
  }
  .ag-star-note {
    margin: 10px 0 0;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    max-width: 90ch;
  }
  @media (max-width: 720px) {
    .ag-star-list li {
      grid-template-columns: minmax(0, 1fr);
      gap: 4px;
    }
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
