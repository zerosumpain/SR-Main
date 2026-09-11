<script lang="ts">
  // THE TWELVE STRUCTURAL CHECKS, AS A TABLE — worst first.
  //
  // These are the only figures on the page no model produced: each walks the
  // relationships the paper itself states and asks whether the counterpart it
  // relies on is there. That makes the wording matter more than usual — a check
  // with nothing to look at is NOT a pass, and the row says so in those words
  // rather than colouring itself green.
  //
  // It was twelve stacked blocks of prose, about 250px each. As four columns the
  // whole set is comparable: run down "What it found" and the pattern in a
  // paper's gaps shows up, which reading twelve paragraphs in sequence does not
  // give you. The full wording of any cell is one hover away and the
  // relationships each check read are one click away, in the drill.
  //
  // Status colour is the site's reserved good/warn/error and every row carries
  // its verdict in WORDS as well, so nothing here is encoded by colour alone.
  import type { Artefact } from '$lib/policy-analysis/contracts';
  import { clip } from '$lib/policy-analysis/matrix';
  import { TEST_RESULTS } from '$lib/policy-analysis/view';

  import ExplainLabel from './ExplainLabel.svelte';
  import Grid from './Grid.svelte';

  interface Props {
    checks: Artefact[];
    inspect: (id: string) => void;
  }

  let { checks, inspect }: Props = $props();
  const meta = (result: string) => TEST_RESULTS.find((r) => r.key === result) ?? TEST_RESULTS[3];
  const counts = $derived(TEST_RESULTS.map((r) => ({ ...r, count: checks.filter((c) => c.data.result === r.key).length })));

  const columns = [
    { key: 'verdict', head: 'Verdict', width: '10rem' },
    { key: 'check', head: 'What it tested', width: '15rem' },
    { key: 'found', head: 'What it found', width: '26rem' },
    { key: 'fix', head: 'What would answer it', width: '20rem' },
  ];

  const caption = $derived(
    `${checks.length} tests over the paper's own wiring, worst first. No model produced any of these — each ` +
      'walks the relationships the document states and asks whether the counterpart it depends on is present. ' +
      'Cells are clipped; hover for the full wording, click a row to see which relationships it read.',
  );
</script>

{#if checks.length}
  <div class="summary" role="img" aria-label={counts.filter((c) => c.count).map((c) => `${c.count} ${c.label}`).join(', ')}>
    {#each counts.filter((c) => c.count) as c (c.key)}
      <span class="chip"><span class="dot" style="background: {c.hue}"></span>{c.count} {c.label}</span>
    {/each}
  </div>

  <Grid
    {columns}
    rows={checks}
    id={(row) => (row as Artefact).id}
    {caption}
      empty="No structural check has run yet."
  >
    {#snippet cell(row, column)}
      {@const check = row as Artefact}
      {@const m = meta(String(check.data.result))}
      {#if column.key === 'verdict'}
        <span class="verdict">
          <span class="dot" style="background: {m.hue}"></span>
          <ExplainLabel term={String(check.data.result)} text={m.label} />
        </span>
      {:else if column.key === 'check'}
        <button class="ck-name" onclick={() => inspect(check.id)}>{check.label}</button>
        <span class="ck-refs">{check.refs.length} {check.refs.length === 1 ? 'relationship' : 'relationships'} read</span>
      {:else if column.key === 'found'}
        {@const found = clip(check.statement, 190)}
        <button
          class="ck-text"
          class:clipped={found.clipped}
          title={found.clipped ? check.statement : undefined}
          onclick={() => inspect(check.id)}
        >{found.text}</button>
      {:else}
        {#if check.data.mitigation}
          {@const fix = clip(String(check.data.mitigation), 150)}
          <!-- Clipped, so it has to be openable: a shortened value with no way
               to reach the rest of it is worse than a long one. -->
          <button
            class="ck-fix"
            class:clipped={fix.clipped}
            title={fix.clipped ? String(check.data.mitigation) : undefined}
            onclick={() => inspect(check.id)}
          >{fix.text}</button>
        {:else}
          <span class="ck-silent">The assessment offers none</span>
        {/if}
      {/if}
    {/snippet}
  </Grid>
{/if}

<style>
  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    margin: 1rem 0 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  .dot {
    width: 0.7rem;
    height: 0.7rem;
    /* Pills only — the one radius in this system that is not 0. */
    border-radius: 100px;
    flex: none;
    border: 1px solid var(--line-strong);
  }

  .verdict {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }

  .ck-name {
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
  .ck-name:hover {
    color: var(--accent);
  }
  .ck-refs {
    display: block;
    margin-top: 3px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .ck-text {
    font: inherit;
    display: block;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    line-height: 1.45;
    color: var(--text-primary);
    cursor: pointer;
  }
  .ck-text.clipped {
    border-bottom: 1px dotted var(--line-strong);
  }
  .ck-text:hover {
    color: var(--accent);
  }

  .ck-fix {
    font: inherit;
    display: block;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0 0 0 0.6rem;
    line-height: 1.45;
    color: var(--text-secondary);
    border-left: 2px solid var(--line-strong);
    cursor: pointer;
  }
  .ck-fix:hover {
    color: var(--accent);
    border-left-color: var(--accent);
  }
  .ck-fix.clipped {
    border-bottom: 1px dotted var(--line-strong);
  }
  .ck-silent {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  @media print {
    .dot {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .ck-text.clipped,
    .ck-fix.clipped {
      border-bottom: 0;
    }
  }
</style>
