<script lang="ts">
  // THE CAST, AS ONE TABLE — bodies down, what moves them across.
  //
  // This replaces the nine-card board. The cards were 2,600px of the actors
  // panel's 3,541px and they repeated the same six field labels nine times, so
  // the one thing a reader wants to do here — compare two bodies on the same
  // question — meant holding one in their head and scrolling to the other.
  //
  // The grid does it in one eyeful: run a finger down "Judged on" and the
  // gameable measures line up; down "Gains if it fails" and the bodies with no
  // stake in the policy working line up. Every cell is clipped to about six
  // words, with the full sentence on the hover card and in the drill, which is
  // where the depth gradient already put long text.
  //
  // The blanks matter as much as the values, so the caption says how many cells
  // the assessment could fill and names any column it filled for nobody. A grid
  // that is two thirds empty is a thin assessment, not a thin design, and the
  // page has to be the one to say so.
  import { explain } from '$lib/policy-analysis/glossary';
  import { TRAIT_COLUMNS, traitCoverage, type TraitRow } from '$lib/policy-analysis/matrix';
  import { BAND_FILL, BAND_LABEL, type Band } from '$lib/policy-analysis/view';

  import ExplainLabel from './ExplainLabel.svelte';
  import Grid from './Grid.svelte';

  interface Props {
    rows: TraitRow[];
    /** Open the drill on an artefact. */
    onopen: (id: string) => void;
    /** Filter the playbook to one body and switch to it. */
    onplays: (actorId: string) => void;
    /**
     * THE MEASURE THE TABLE IS RANKED ON, and each body's score on it.
     *
     * Supplied by the atlas, whose bar chart this column absorbed: the chart and
     * this grid drew the same nine bodies and opened with the same two columns.
     * Absent, the column is what it always was — the worst play the body can run
     * — so the table still stands on its own.
     */
    rankBy?: { label: string; term: string; values: Map<string, { text: string; frac: number }> } | null;
  }

  let { rows, onopen, onplays, rankBy = null }: Props = $props();

  const coverage = $derived(traitCoverage(rows));

  /**
   * Widths are chosen so the whole grid fits a 1400px measure without
   * scrolling: 11.5 + 13 + six columns of 9rem is about 1,256px. Wider cells
   * would mean a horizontal scroll, and a grid you have to scroll sideways to
   * compare a column in is a grid that has stopped doing its job.
   *
   * THE RANK COLUMN IS SIZED BY ITS LONGEST PAIR, which is "SIGNIFICANT" beside
   * "2 ways →" — eleven characters and eight. At 10.5rem neither the chip nor
   * the link fitted on one line, so the three significant rows wrapped and stood
   * taller than the severe ones either side of them: a ragged table reads as a
   * rendering fault rather than as a ranking.
   */
  const columns = $derived([
    { key: 'body', head: 'Body', width: '11.5rem', term: 'actor' },
    {
      key: 'risk',
      head: rankBy ? rankBy.label : 'Worst it could do',
      width: '13rem',
      term: rankBy ? rankBy.term : 'worst',
    },
    ...TRAIT_COLUMNS.map((c) => ({ key: c.key, head: c.head, width: '9rem', note: c.asks, term: 'profile' })),
  ]);

  const originWords = $derived(coverage.dominantOrigin ? (explain(coverage.dominantOrigin)?.plain ?? '').toLowerCase() : '');

  const caption = $derived(
    `${rows.length} ${rows.length === 1 ? 'body' : 'bodies'} against the six questions that decide how each would behave. ` +
      `${coverage.filled} of ${coverage.total} cells were established by the assessment` +
      (coverage.silent.length ? `; nothing was found for ${coverage.silent.join(' or ').toLowerCase()}` : '') +
      '. ' +
      (coverage.dominantOrigin
        ? `Every cell ${originWords ? `${originWords}` : `is a ${coverage.dominantOrigin.replaceAll('_', ' ')}`}` +
          (coverage.exceptions ? `, except the ${coverage.exceptions} that name a different origin under them. ` : '. ')
        : '') +
      'Cells are clipped — hover one for the full wording, click a body to open its profile.',
  );
</script>

<Grid
  {columns}
  {rows}
  id={(row) => (row as TraitRow).id}
  {caption}
  empty="No body has been profiled yet. Profiles are the fifth of fourteen stages, so they arrive early in a run — if this is empty on a finished assessment, the run log will say why."
>
  {#snippet head(column)}
    {#if column.term}
      <ExplainLabel term={column.term} text={column.head} />
    {:else}
      {column.head}
    {/if}
    {#if column.note}<span class="ct-asks">{column.note}</span>{/if}
  {/snippet}

  {#snippet cell(row, column)}
    {@const r = row as TraitRow}
    {#if column.key === 'body'}
      <button class="ct-name" data-pa-peek={`actor:${r.id}`} onclick={() => onopen(r.profileId ?? r.id)}>
        {r.label}
      </button>
      <span class="ct-type">{r.entityType}</span>
      {#if r.known}<span class="ct-known">Met before</span>{/if}
    {:else if column.key === 'risk'}
      {@const score = rankBy?.values.get(r.id) ?? null}
      <!--
        THE BAR THE CHART USED TO DRAW. One hue, length carrying the magnitude;
        a body scoring nothing gets no bar at all rather than a zero-width one,
        because an empty bar reads as something the assessment measured.
      -->
      {#if score && score.frac > 0}
        <span class="ct-bar-cell">
          <span class="ct-bar" style={`width: ${Math.max(2, score.frac * 100)}%`}></span>
          <span class="ct-bar-val">{score.text}</span>
        </span>
      {:else if rankBy}
        <span class="ct-none">Scores nothing here</span>
      {/if}
      {#if r.topPlay}
        <!-- The band and the way in share a line. Stacked, the rank column was
             three storeys — bar, chip, link — and became the tallest cell in
             every row, which is what a nine-row table cannot afford. -->
        <span class="ct-risk-line">
          <button
            class="ct-band"
            style={`background: ${BAND_FILL[r.topPlay.band as Band]}`}
            class:on-dark={r.topPlay.band === 'severe'}
            data-pa-peek={`play:${r.topPlay.id}`}
            onclick={() => onopen(r.topPlay!.id)}
          >{BAND_LABEL[r.topPlay.band as Band]}{#if !rankBy} · {r.worst}{/if}</button>
          <button class="ct-plays" onclick={() => onplays(r.id)}>
            {r.playCount} {r.playCount === 1 ? 'way' : 'ways'} →
          </button>
        </span>
      {:else if !rankBy}
        <!-- Not a zero. The assessment found no play for this body, which is a
             finding about the paper rather than a score. -->
        <span class="ct-none">None found</span>
      {/if}
    {:else}
      {@const index = TRAIT_COLUMNS.findIndex((c) => c.key === column.key)}
      {@const value = r.cells[index]}
      {#if value}
        <!--
          NO CARD ON A CELL. The ROW keeps its actor and play peeks — John,
          2026-09-11: *"leave hover over for the actors page though that works
          really well"* — but fifty-four cells each opening a styled popover is
          the clutter, and each one only ever held the wording of a single
          field. A clipped cell keeps its dotted rule to say there is more and
          carries the full wording as a native `title`; the profile behind the
          row name holds every field in full.
        -->
        <button
          class="ct-cell"
          class:clipped={value.clipped}
          title={value.clipped ? value.full : undefined}
          onclick={() => onopen(r.profileId ?? r.id)}
        >{value.text}</button>
        <!-- Only when it DIFFERS from the caption's stated origin. Fifty-four
             repetitions of "structural inference" is a true label that hides
             the values it annotates. -->
        {#if value.origin && value.origin !== coverage.dominantOrigin}
          <ExplainLabel term={value.origin} text={explain(value.origin)?.short ?? value.origin.replaceAll('_', ' ')} />
        {/if}
      {:else}
        <span class="ct-silent" aria-label="The assessment established nothing here">—</span>
      {/if}
    {/if}
  {/snippet}
</Grid>

<style>
  /* The question each column is asking, under its own header. Three words of
     mono gets the reader from "informationControlled" to "what does it know
     that others do not" without a hover. */
  .ct-asks {
    display: block;
    margin-top: 4px;
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    letter-spacing: 0;
    text-transform: none;
    line-height: 1.3;
    color: var(--text-ghost, var(--text-muted));
    font-weight: 400;
  }

  /*
   * THE BODY NAME SET THE ROW HEIGHT, and nobody had measured it. A name like
   * "Regulator of Social Housing" wraps to two lines in this column, and at the
   * inherited leading those two lines were 45px — taller than the ranked bar
   * beside them and taller than a two-line trait cell. The leading is the fix;
   * the name itself is not clipped, because it is the row's identity.
   */
  .ct-name {
    font: inherit;
    display: block;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    font-weight: 600;
    font-size: var(--fs-label);
    line-height: 1.3;
    color: var(--text-primary);
    cursor: pointer;
  }
  .ct-name:hover {
    color: var(--accent);
  }
  .ct-type {
    display: block;
    margin-top: 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .ct-known {
    display: inline-block;
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .ct-band {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    border: 0;
    border-radius: 0;
    padding: 2px 5px;
    cursor: pointer;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .ct-band.on-dark {
    color: var(--bg);
  }
  .ct-plays {
    font: inherit;
    display: block;
    margin-top: 5px;
    background: none;
    border: 0;
    padding: 0;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent-ink);
    cursor: pointer;
  }
  .ct-plays:hover {
    color: var(--accent);
  }
  .ct-none {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  /*
   * TWO LINES, AND THE ROW STOPS THERE.
   *
   * `CELL_CHARS` clips the TEXT at 46 characters, which was chosen to tell two
   * bodies apart — but 46 characters in a 9.5rem column is three wrapped lines,
   * so every row stood ~105px tall and nine of them were 1,143px. The clip and
   * the column width had never been measured against each other. Two lines is
   * enough to distinguish "Ministers, through an annual report" from "Its own
   * board", which is what this column is FOR, and the rest is already one hover
   * or one click away.
   */
  .ct-cell {
    font: inherit;
    /* 13px, the grid's label size. At the inherited 15px two lines were 41px and
       the tallest cell in the row set the height of all eight. */
    font-size: var(--fs-label);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    line-height: 1.35;
    color: var(--text-primary);
    cursor: pointer;
  }
  /* A clipped cell says so with a hairline rather than with more words. */
  .ct-cell.clipped {
    border-bottom: 1px dotted var(--line-strong);
  }
  .ct-cell:hover {
    color: var(--accent);
  }
  .ct-silent {
    color: var(--text-ghost, var(--text-muted));
  }
  /*
   * THE ORIGIN BADGE IS A FOOTNOTE, not a second line of content. It appears
   * only where a cell's epistemic status DIFFERS from the one the caption
   * states, and at its inherited leading it added 20px to whichever column
   * carried it — which then set the height of all eight cells in the row.
   */
  .ct-cell + :global(.ex) {
    display: inline-block;
    margin-top: 2px;
    line-height: 1.2;
  }

  /* The bar the atlas chart used to draw, in the column it belongs to. */
  .ct-bar-cell {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 2.2rem;
    align-items: center;
    gap: 8px;
    margin-bottom: 5px;
  }
  .ct-risk-line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 8px;
  }
  /* 4px rounded data-end, anchored square to the baseline at the axis. */
  .ct-bar {
    display: block;
    height: 11px;
    background: var(--accent);
    border-radius: 0 4px 4px 0;
    min-width: 3px;
  }
  .ct-bar-val {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  @media print {
    /* On paper there is no hover, so a clipped cell is simply a shorter cell —
       the full wording is in the profile chapter. The affordance goes. */
    .ct-cell.clipped {
      border-bottom: 0;
    }
    /* Nothing may CLIP on paper: a two-line clamp exists for a fixed ink strip
       that a page does not have, and the clipped half would simply be gone. */
    .ct-cell {
      display: block;
      overflow: visible;
      -webkit-line-clamp: none;
      line-clamp: none;
    }
    .ct-bar {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .ct-plays {
      display: none !important;
    }
  }
</style>
