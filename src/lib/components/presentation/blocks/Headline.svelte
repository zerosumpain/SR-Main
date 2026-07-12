<script lang="ts">
  // Editorial statement headline — kicker → rule → headline → dek hierarchy
  // (the magazine statement-fact page). Internal stagger mirrors Masthead.
  import { blockIn } from '$lib/presentation/transitions';
  import type { HeadlineBlock } from '$lib/presentation/types';

  let { block }: { block: HeadlineBlock } = $props();

  const align = $derived(block.align ?? 'left');
</script>

<header class="hl" data-align={align}>
  {#if block.kicker}
    <span class="hl-kicker" in:blockIn={{ delay: 0 }}>{block.kicker}</span>
  {/if}
  <span class="hl-rule" aria-hidden="true"></span>
  <h2 class="hl-text" in:blockIn={{ delay: 120 }}>{block.text}</h2>
  {#if block.dek}
    <p class="hl-dek" in:blockIn={{ delay: 280 }}>{block.dek}</p>
  {/if}
</header>

<style>
  .hl {
    display: flex;
    flex-direction: column;
    gap: 13px;
    max-width: 100%;
  }
  .hl[data-align='left'] { align-items: flex-start; text-align: left; }
  .hl[data-align='center'] { align-items: center; text-align: center; }
  .hl[data-align='right'] { align-items: flex-end; text-align: right; }
  .hl-kicker {
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .hl-rule {
    width: 64px;
    height: 4px;
    background: var(--accent);
    transform-origin: left;
  }
  .hl[data-align='right'] .hl-rule { transform-origin: right; }
  .hl[data-align='center'] .hl-rule { transform-origin: center; }
  @media (prefers-reduced-motion: no-preference) {
    .hl-rule { animation: hl-rule-grow 620ms cubic-bezier(0.33, 1, 0.68, 1) 60ms both; }
  }
  @keyframes hl-rule-grow {
    from { transform: scaleX(0); }
    to { transform: scaleX(1); }
  }
  .hl-text {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: 76px;
    line-height: 1.04;
    letter-spacing: -0.02em;
    color: var(--ink);
    margin: 0;
    text-wrap: balance;
    /* measure in ch of the DISPLAY size, so the rag scales with the type */
    max-width: 16ch;
  }
  .hl-dek {
    font-family: 'DM Sans', system-ui, sans-serif;
    font-size: 21px;
    line-height: 1.5;
    color: var(--ink-soft);
    margin: 0;
    max-width: 46ch;
  }
</style>
