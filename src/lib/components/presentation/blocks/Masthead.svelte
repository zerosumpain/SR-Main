<script lang="ts">
  // Title-slide header — ported from data-spine StoryMasthead, sized for a
  // full-viewport slide (no eli5 register; decks carry one voice).
  import type { MastheadBlock } from '$lib/presentation/types';

  let { block }: { block: MastheadBlock } = $props();
</script>

<header class="mh">
  {#if block.kicker}<span class="mh-kicker">{block.kicker}</span>{/if}
  <h1 class="mh-title">{block.title}</h1>
  {#if block.thesis}<p class="mh-thesis">{block.thesis}</p>{/if}
  {#if block.asks && block.asks.length}
    <div class="mh-ask">
      <ul>
        {#each block.asks as ask}<li>{ask}</li>{/each}
      </ul>
    </div>
  {/if}
</header>

<style>
  .mh { max-width: 30ch; }
  .mh-kicker {
    display: block;
    font-family: 'JetBrains Mono', monospace;
    font-size: clamp(10px, 1.2vw, 13px);
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--accent-ink);
    margin-bottom: 18px;
  }
  .mh-title {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: clamp(38px, 7vw, 92px);
    line-height: 0.98;
    letter-spacing: -0.025em;
    margin: 0 0 20px;
    color: var(--ink);
  }
  .mh-thesis {
    font-size: clamp(16px, 2vw, 22px);
    line-height: 1.55;
    color: var(--ink-soft);
    margin: 0;
    max-width: 52ch;
  }
  .mh-ask {
    margin-top: 22px;
    border-left: 3px solid var(--accent-ink);
    background: var(--accent-ink-tint-12);
    border-radius: var(--radius-round);
    padding: 12px 18px;
    max-width: 58ch;
  }
  .mh-ask ul { margin: 0; padding-left: 18px; }
  .mh-ask li { font-size: clamp(13px, 1.5vw, 15px); line-height: 1.6; color: var(--ink-soft); margin: 3px 0; }
</style>
