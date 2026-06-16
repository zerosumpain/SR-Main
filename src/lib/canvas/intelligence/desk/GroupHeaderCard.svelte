<!-- src/lib/canvas/intelligence/desk/GroupHeaderCard.svelte -->
<!--
  One unified "group heading" card for EVERY grouping dimension (cluster, theme,
  entity type, sentiment, co-occurrence, similarity). Bolder + slightly larger
  than an artefact card. Clicking it spreads the group's cards into open space
  to explore them; clicking again (or the focused state) collapses them back.
-->
<script lang="ts">
  let {
    title,
    count,
    summary = '',
    focused = false,
    onclick,
  }: {
    title: string;
    count: number;
    summary?: string;
    focused?: boolean;
    onclick?: () => void;
  } = $props();
</script>

<button
  type="button"
  class="group-header-card"
  class:focused
  title={summary || title}
  aria-pressed={focused}
  onclick={onclick}
>
  <div class="ghc-bar"></div>
  <div class="ghc-row">
    <span class="ghc-title">{title}</span>
    <span class="ghc-count">{count}</span>
  </div>
  {#if summary}
    <p class="ghc-summary">{summary}</p>
  {/if}
  <span class="ghc-hint">{focused ? '✕ close' : '⤢ explore'}</span>
</button>

<style>
  .group-header-card {
    /* Slightly larger than the 220–240px artefact cards. */
    width: 264px;
    box-sizing: border-box;
    text-align: left;
    display: block;
    background: var(--surface-elevated, #faf6ee);
    border: 2px solid var(--text-primary, #1a1008);
    border-radius: 5px;
    box-shadow: 4px 5px 0 rgba(26, 16, 8, 0.16);
    padding: 9px 12px 11px;
    cursor: pointer;
    overflow: hidden;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    transition: box-shadow 140ms ease, transform 140ms ease, border-color 140ms ease;
  }
  .group-header-card:hover {
    transform: translate(-1px, -1px);
    box-shadow: 5px 6px 0 rgba(26, 16, 8, 0.2);
    border-color: var(--accent, #c4570a);
  }
  .group-header-card:focus-visible {
    outline: none;
    border-color: var(--accent, #c4570a);
  }
  .group-header-card.focused {
    border-color: var(--accent, #c4570a);
    box-shadow: 4px 5px 0 var(--accent-tint-25, rgba(196, 87, 10, 0.25));
  }
  .ghc-bar {
    height: 4px;
    width: 34px;
    background: var(--accent, #c4570a);
    border-radius: 2px;
    margin-bottom: 8px;
  }
  .ghc-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .ghc-title {
    font-family: var(--font-display, 'Archivo Black', sans-serif);
    font-size: 15px;
    line-height: 1.15;
    letter-spacing: -0.01em;
    color: var(--text-primary, #1a1008);
    /* keep a long title to ~2 lines */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .ghc-count {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 12px;
    font-weight: 700;
    color: var(--accent, #c4570a);
    flex: 0 0 auto;
  }
  .ghc-summary {
    margin: 7px 0 0;
    font-family: var(--font-body, 'DM Sans', sans-serif);
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--text-secondary, rgba(26, 16, 8, 0.78));
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    max-height: 50px;
  }
  .ghc-hint {
    display: inline-block;
    margin-top: 8px;
    font-size: 9.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-ghost, rgba(26, 16, 8, 0.45));
  }
  .group-header-card:hover .ghc-hint,
  .group-header-card.focused .ghc-hint {
    color: var(--accent, #c4570a);
  }
</style>
