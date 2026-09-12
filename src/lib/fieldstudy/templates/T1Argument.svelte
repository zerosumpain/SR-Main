<script lang="ts">
  /**
   * T1 · Argument — reasoning.
   *
   * Prose carries the beat. Two figures at most; a third means this is a
   * Survey. Never two columns of body text, never a lever.
   */
  import Figure from '../Figure.svelte';
  import PullQuote from '../PullQuote.svelte';
  import { chartFor } from '../charts';
  import type { Beat } from '../study';

  let { beat, depth = 'research' }: { beat: Beat; depth?: 'plain' | 'research' | 'technical' } = $props();

  // Technical falls back to research, research to plain — a beat always has
  // something to say at every depth even when only one register was written.
  function textFor(p: { plain?: string; research: string; technical?: string }): string {
    if (depth === 'plain') return p.plain ?? p.research;
    if (depth === 'technical') return p.technical ?? p.research;
    return p.research;
  }
</script>

{#each beat.prose ?? [] as p, i (i)}
  <p class="fs-body" class:fs-dropcap={p.dropCap}>{textFor(p)}</p>
{/each}

{#each beat.figures ?? [] as fig (fig.no)}
  {@const Chart = chartFor(fig.chart)}
  <Figure no={fig.no} caption={fig.caption} {depth}>
    {#snippet children()}
      <!-- A registered chart draws itself; an unregistered id keeps the
           reserved slot, so a figure whose chart has not been built yet leaves
           a visible gap under its caption rather than a caption under nothing. -->
      {#if Chart}
        <div class="fs-figure-mount" data-chart={fig.chart}>
          <Chart data={fig.data} unit={fig.unit} />
        </div>
      {:else}
        <div class="fs-figure-slot" data-chart={fig.chart}></div>
      {/if}
    {/snippet}
  </Figure>
{/each}

{#if beat.pullQuote}
  <PullQuote>{beat.pullQuote}</PullQuote>
{/if}

<style>
  .fs-body + :global(.fs-body) {
    margin-top: 1.05em;
  }
  /* The figure's own chart mounts here. Reserved rather than collapsed, so a
     chart that fails to mount leaves a visible gap and its caption, instead of
     a caption floating under nothing. */
  .fs-figure-slot {
    min-height: 180px;
    border: 1px dashed var(--line);
    display: flex;
  }
  /* A drawn figure gets a solid frame instead of the reserved slot's dashed
     one: the dash means "nothing mounted here", and it should keep meaning
     that. */
  .fs-figure-mount {
    border: 1px solid var(--line);
    background: var(--card-bg);
    display: block;
    /* Wide figures scroll inside their own frame; the page body never scrolls
       sideways. */
    overflow-x: auto;
  }
</style>
