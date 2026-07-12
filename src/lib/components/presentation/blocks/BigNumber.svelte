<script lang="ts">
  // One huge count-up numeral — the VitalTile Tween pattern at presentation
  // scale (Fraunces numeral, mono unit/label, dur() collapses under
  // reduced motion).
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { dur } from '$lib/motion';
  import type { BigNumberBlock } from '$lib/presentation/types';

  let { block }: { block: BigNumberBlock } = $props();

  const tween = new Tween(0, { duration: dur(900), easing: cubicOut });
  $effect(() => {
    tween.target = block.value;
  });
  const dp = $derived(block.dp ?? 0);
  const shown = $derived(
    dp > 0 ? tween.current.toFixed(dp) : Math.round(tween.current).toLocaleString('en-GB'),
  );
</script>

<div class="bn">
  <div class="bn-value">
    <span class="bn-num">{shown}</span>
    {#if block.unit}<span class="bn-unit">{block.unit}</span>{/if}
  </div>
  <span class="bn-label">{block.label}</span>
  {#if block.sub}<p class="bn-sub">{block.sub}</p>{/if}
</div>

<style>
  .bn { display: flex; flex-direction: column; align-items: flex-start; }
  :global(.slide[data-layout='center']) .bn { align-items: center; text-align: center; }
  .bn-value { display: flex; align-items: baseline; gap: 14px; }
  .bn-num {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: 160px;
    line-height: 0.95;
    letter-spacing: -0.03em;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .bn-unit {
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .bn-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--ink-soft);
    margin-top: 12px;
  }
  .bn-sub {
    font-size: 17px;
    line-height: 1.55;
    color: var(--ink-soft);
    margin: 10px 0 0;
    max-width: 48ch;
  }
</style>
