<svelte:options css="injected" />

<script lang="ts">
  // The notes sheet typed up (HeroNotes): every reading as a plain term,
  // value and note, in the sentence's order. Shown by "fair copy", and what
  // prints, ink on paper with every number legible.
  import type { FairRow } from '$lib/landing/notes';

  let { rows }: { rows: FairRow[] } = $props();
</script>

<dl class="hn-fair" aria-label="The live numbers, typed up">
  {#each rows as row (row.id)}
    <div class="hn-fair-r">
      <dt>{row.term}</dt>
      <dd><b>{row.value}</b>{#if row.note}<span>{row.note}</span>{/if}</dd>
    </div>
  {/each}
</dl>

<style>
  .hn-fair {
    display: none;
    margin: 0;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px 32px;
    align-content: start;
  }
  .hn-fair-r {
    display: grid;
    gap: 2px;
    padding-top: 8px;
    border-top: 1px solid var(--on-ink-16);
  }
  .hn-fair dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .hn-fair dd {
    display: grid;
    align-content: start;
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: 1.4;
    color: var(--on-ink-70);
  }
  .hn-fair b {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 22px;
    letter-spacing: -0.02em;
    color: var(--bg);
  }
  :global(.hn[data-fair]) .hn-fair {
    display: grid;
  }

  @media (min-width: 761px) {
    .hn-fair {
      grid-row: 2 / 5;
      grid-column: 2;
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (min-width: 1100px) {
    .hn-fair {
      grid-row: 2 / 4;
      grid-column: 2 / 4;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media print {
    .hn-fair {
      display: grid;
      grid-row: auto;
      grid-column: 1 / -1;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      align-items: start;
      margin-top: 18px;
    }
    .hn-fair-r {
      border-top-color: rgba(26, 16, 8, 0.3);
    }
    .hn-fair dt,
    .hn-fair dd,
    .hn-fair b {
      color: #1a1008;
    }
  }
</style>
