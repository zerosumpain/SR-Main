<script lang="ts">
  // Row of stat chips — the Scorecard/TakeawayBar shape: Fraunces number,
  // mono label, hairline card. Chips pop in sequence.
  import { blockIn } from '$lib/presentation/transitions';
  import type { StatRowBlock } from '$lib/presentation/types';

  let { block }: { block: StatRowBlock } = $props();
</script>

<div class="sr-row" style:--n={block.stats.length}>
  {#each block.stats as stat, i (i)}
    <div class="sr-chip" in:blockIn={{ delay: 90 * i }}>
      <span class="sr-n">{stat.n}</span>
      <span class="sr-lab">{stat.label}</span>
    </div>
  {/each}
</div>

<style>
  .sr-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
    width: 100%;
    max-width: 900px;
  }
  .sr-chip {
    border: 1px solid rgba(28, 22, 17, 0.16);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.45);
    padding: 22px 24px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .sr-n {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: 44px;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .sr-lab {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
</style>
