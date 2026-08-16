<script lang="ts">
  // Vertical timeline — the data-spine .timeline shape: hairline spine,
  // accent dots, mono years. Items cascade in down the spine.
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { dur } from '$lib/motion';
  import type { TimelineBlock } from '$lib/presentation/types';

  let { block }: { block: TimelineBlock } = $props();
</script>

<ol class="tl">
  {#each block.items as item, i (i)}
    <li class="tl-item" in:fly={{ x: -18, duration: dur(460), delay: dur(90 * i), easing: cubicOut }}>
      <span class="tl-dot" aria-hidden="true"></span>
      <span class="tl-year">{item.year}</span>
      <div class="tl-body">
        <span class="tl-label">{item.label}</span>
        {#if item.detail}<p class="tl-detail">{item.detail}</p>{/if}
      </div>
    </li>
  {/each}
</ol>

<style>
  .tl {
    list-style: none;
    margin: 0;
    padding: 0 0 0 10px;
    position: relative;
    max-width: 62ch;
  }
  .tl::before {
    content: '';
    position: absolute;
    left: 13px;
    top: 8px;
    bottom: 8px;
    width: 1px;
    background: rgba(28, 22, 17, 0.2);
  }
  .tl-item {
    position: relative;
    display: grid;
    grid-template-columns: 64px 1fr;
    gap: 4px 24px;
    padding: 0 0 20px 26px;
  }
  .tl-dot {
    position: absolute;
    left: 0;
    top: 5px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-ink);
  }
  .tl-year {
    font-family: 'JetBrains Mono', monospace;
    font-size: var(--fs-label);
    letter-spacing: 0.08em;
    color: var(--accent-ink);
    padding-top: 1px;
  }
  .tl-label {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: 20px;
    line-height: 1.25;
    color: var(--ink);
  }
  .tl-detail {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--ink-soft);
    margin: 4px 0 0;
  }
</style>
