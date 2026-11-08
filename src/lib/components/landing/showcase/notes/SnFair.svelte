<svelte:options css="injected" />

<script lang="ts">
  // One page typed up: every reading the page draws, as a plain list on the
  // rules. Hidden while the drawings show; it takes their place when the
  // hero's "fair copy" is on (the cover's own switch, read through the page,
  // so one press types up the whole notebook), and it is what prints.
  import type { FairRow } from '$lib/landing/showcase-notes';

  let { rows, label }: { rows: FairRow[]; label: string } = $props();
</script>

<dl class="fc" aria-label={label}>
  {#each rows as r, i (i)}
    <div class="fc-r"><dt>{r.k}</dt><dd>{r.v}</dd></div>
  {/each}
</dl>

<style>
  .fc {
    display: none;
    max-width: 920px;
    margin: 32px 0 0;
  }
  .fc-r {
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
    column-gap: 24px;
  }
  dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 32px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
    line-height: 32px;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
  :global(body:has(.hn[data-fair])) .fc {
    display: block;
  }
  @media (max-width: 600px) {
    .fc-r {
      grid-template-columns: minmax(0, 1fr);
    }
    dd {
      margin-bottom: 0;
    }
  }
  @media print {
    .fc {
      display: block;
      margin-top: 10px;
      color: #1a1008;
    }
    .fc-r {
      padding: 2px 0;
      border-bottom: 1px solid rgba(26, 16, 8, 0.25);
      break-inside: avoid;
    }
    dt,
    dd {
      line-height: 1.4;
      font-size: 12px;
      color: #1a1008;
    }
  }
</style>
