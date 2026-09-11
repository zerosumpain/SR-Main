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
  }

  let { rows, onopen, onplays }: Props = $props();

  const coverage = $derived(traitCoverage(rows));

  /**
   * Widths are chosen so the whole grid fits a 1400px measure without
   * scrolling: 12 + 8.5 + six columns of 10rem is about 1,256px. Wider cells
   * would mean a horizontal scroll, and a grid you have to scroll sideways to
   * compare a column in is a grid that has stopped doing its job.
   */
  const columns = $derived([
    { key: 'body', head: 'Body', width: '12rem', term: 'actor' },
    { key: 'risk', head: 'Worst it could do', width: '8.5rem', term: 'worst' },
    ...TRAIT_COLUMNS.map((c) => ({ key: c.key, head: c.head, width: '10rem', note: c.asks, term: 'profile' })),
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
      {#if r.topPlay}
        <button
          class="ct-band"
          style={`background: ${BAND_FILL[r.topPlay.band as Band]}`}
          class:on-dark={r.topPlay.band === 'severe'}
          data-pa-peek={`play:${r.topPlay.id}`}
          onclick={() => onopen(r.topPlay!.id)}
        >{BAND_LABEL[r.topPlay.band as Band]} · {r.worst}</button>
        <button class="ct-plays" onclick={() => onplays(r.id)}>
          {r.playCount} {r.playCount === 1 ? 'way in' : 'ways in'} →
        </button>
      {:else}
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

  .ct-name {
    font: inherit;
    display: block;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    font-weight: 600;
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
    padding: 3px 6px;
    cursor: pointer;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
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

  .ct-cell {
    font: inherit;
    display: block;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    line-height: 1.4;
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

  @media print {
    /* On paper there is no hover, so a clipped cell is simply a shorter cell —
       the full wording is in the profile chapter. The affordance goes. */
    .ct-cell.clipped {
      border-bottom: 0;
    }
    .ct-plays {
      display: none !important;
    }
  }
</style>
