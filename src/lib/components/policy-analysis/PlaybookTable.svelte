<script lang="ts">
  // THE PLAYBOOK, AS A RANKED TABLE.
  //
  // Eleven plays were eleven cards and 5,321px of page — the tallest workspace
  // in the assessment — each card repeating four labelled bars and a "what would
  // close it" box. So the ranking, which is the entire point of the playbook,
  // could not be read: by the time a reader reached rank 4 the top three were
  // three screens behind them.
  //
  // One row per play. The four factors are numbers AND a bar in the same cell —
  // a bar alone cannot be read off precisely enough to argue with, a number
  // alone cannot be scanned down a column — and the row ends with the figure
  // computed from them, so the arithmetic reads left to right. The play's own
  // sentence, what it gains, what it costs, what would close it and its
  // provenance are all in the drill, one click from the row.
  //
  // The column headers carry `ExplainLabel`, and they lead with the PLAIN name:
  // "How hard it is to spot", with "concealment" underneath. The reader is a
  // policy professional, not a game theorist, and the term is worth learning —
  // but not worth guessing at.
  import { explain } from '$lib/policy-analysis/glossary';
  import { PLAY_FACTORS, type PlayRow } from '$lib/policy-analysis/matrix';
  import { BAND_FILL, BAND_LABEL, type Band } from '$lib/policy-analysis/view';

  import ExplainLabel from './ExplainLabel.svelte';
  import Grid from './Grid.svelte';

  interface Props {
    rows: PlayRow[];
    /** How many plays exist before any filter — the caption has to say so. */
    total: number;
    onopen: (id: string) => void;
  }

  let { rows, total, onopen }: Props = $props();

  const columns = [
    { key: 'play', head: 'The play', width: '20rem' },
    { key: 'actor', head: 'Who would run it', width: '11rem', term: 'actor' },
    ...PLAY_FACTORS.map((key) => ({ key, head: explain(key)?.plain ?? key, width: '8.5rem', term: key })),
    { key: 'exposure', head: 'Overall risk', width: '8rem', term: 'exposure', align: 'right' as const },
    { key: 'legality', head: 'Breaks a rule?', width: '8.5rem', term: 'legality' },
  ];

  const LEGALITY: Record<string, string> = {
    compliant: 'No — as written',
    grey: 'Arguable',
    breach: 'Yes — a breach',
  };

  const caption = $derived(
    rows.length === total
      ? `All ${total} plays, worst first. Each is something one named body could do to serve itself at the policy's expense; the four middle columns are the judgements behind the ranking, and the risk figure is computed from them. Click a row to open the play, what it gains, what it costs the policy and what would close it.`
      : `${rows.length} of ${total} plays, worst first — a filter is active. Clear it above to see the rest.`,
  );
</script>

<Grid
  {columns}
  {rows}
  id={(row) => (row as PlayRow).id}
  {caption}
  empty="No exploitation play has been produced yet. The playbook is the eleventh of fourteen stages, so it arrives late in a run."
>
  {#snippet head(column)}
    {#if column.term}
      {@const entry = explain(column.term)}
      <ExplainLabel term={column.term} text={column.head} />
      <!-- The technical word under the plain one. A reader who meets
           "concealment" in the exported table needs to have been shown it, not
           shielded from it. -->
      {#if entry && entry.plain && entry.label !== column.head}
        <span class="pt-formal">{entry.label}</span>
      {/if}
    {:else}
      {column.head}
    {/if}
  {/snippet}

  {#snippet cell(row, column)}
    {@const r = row as PlayRow}
    {#if column.key === 'play'}
      <span class="pt-rank">{String(r.rank).padStart(2, '0')}</span>
      <button class="pt-name" data-pa-peek={`play:${r.id}`} onclick={() => onopen(r.id)}>{r.label}</button>
      <span class="pt-summary">{r.summary}</span>
    {:else if column.key === 'actor'}
      {#if r.actor}
        <button class="pt-actor" data-pa-peek={`actor:${r.actor.id}`} onclick={() => onopen(r.actor!.id)}>{r.actor.label}</button>
      {:else}
        <span class="pt-muted">Body not resolved</span>
      {/if}
      <!-- Only when it is more than one. Eleven rows each reading "aims at 1
           part of the machinery" is a column of noise; "aims at 3 parts" is a
           finding about a play with several ways to land. -->
      {#if r.targets > 1}
        <span class="pt-targets">aims at {r.targets} parts of the machinery</span>
      {/if}
    {:else if column.key === 'exposure'}
      <span
        class="pt-band"
        style={`background: ${BAND_FILL[r.band as Band]}`}
        class:on-dark={r.band === 'severe'}
        data-pa-peek="term:exposure"
      >{r.exposure}</span>
      <span class="pt-band-word">{BAND_LABEL[r.band as Band]}</span>
    {:else if column.key === 'legality'}
      <span class="pt-legality" class:compliant={r.legality === 'compliant'}>{LEGALITY[r.legality] ?? '—'}</span>
    {:else}
      {@const factor = r.factors.find((f) => f.key === column.key)}
      <!-- Number and bar in one cell: the number to argue with, the bar to
           scan. The bar is one hue stepped by width because a factor is a
           magnitude, not a category. -->
      <span class="pt-fig">{factor?.value ?? 0}</span>
      <span class="pt-track"><span class="pt-fill" style={`width: ${factor?.value ?? 0}%`}></span></span>
    {/if}
  {/snippet}
</Grid>

<style>
  .pt-formal {
    display: block;
    margin-top: 3px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-ghost, var(--text-muted));
    opacity: 0.8;
  }

  .pt-rank {
    float: left;
    margin-right: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
    font-variant-numeric: tabular-nums;
    line-height: 1.5;
  }
  .pt-name {
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
  .pt-name:hover {
    color: var(--accent);
  }
  .pt-summary {
    display: block;
    clear: both;
    margin-top: 3px;
    font-size: var(--fs-label);
    line-height: 1.4;
    color: var(--text-secondary);
  }

  .pt-actor {
    font: inherit;
    display: block;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    color: var(--accent-ink);
    cursor: pointer;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }
  .pt-actor:hover {
    color: var(--accent);
  }
  .pt-targets,
  .pt-muted {
    display: block;
    margin-top: 3px;
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    line-height: 1.3;
  }

  .pt-fig {
    display: block;
    font-family: var(--font-display);
    font-size: var(--fs-num-sm, 1.1rem);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .pt-track {
    display: block;
    margin-top: 5px;
    height: 4px;
    background: var(--line-hair);
  }
  .pt-fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .pt-band {
    display: inline-block;
    padding: 3px 7px;
    font-family: var(--font-display);
    font-size: var(--fs-num-sm, 1.1rem);
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    cursor: help;
  }
  .pt-band.on-dark {
    color: var(--bg);
  }
  .pt-band-word {
    display: block;
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .pt-legality {
    font-size: var(--fs-label);
    line-height: 1.35;
    color: var(--text-secondary);
  }
  /* "Stays within the rules" is the WORST case, not the best — there is no
     enforcement answer to it — so it is the one that gets the accent rule. */
  .pt-legality.compliant {
    border-left: 2px solid var(--accent);
    padding-left: 7px;
    color: var(--text-primary);
  }

  @media print {
    .pt-track {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
