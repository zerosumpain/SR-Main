<!-- src/lib/canvas/intelligence/desk/CategoryHeader.svelte -->
<script lang="ts">
  let {
    id,
    title,
    summary = '',
    count,
  }: { id: string; title: string; summary?: string; count: number } = $props();
</script>

<div class="cat-header" data-cat-id={id} title={summary}>
  <div class="bar"></div>
  <div class="row">
    <span class="title">{title}</span>
    <span class="count">{count}</span>
  </div>
  {#if summary}
    <p class="summary">{summary}</p>
  {/if}
</div>

<style>
  .cat-header {
    width: 220px;
    box-sizing: border-box;
    background: var(--surface-elevated, #faf6ee);
    border: 1px solid rgba(26, 16, 8, 0.18);
    border-radius: var(--radius-round);
    padding: 8px 10px 10px;
    overflow: hidden;
  }
  .bar {
    height: 3px;
    width: 28px;
    background: var(--accent, #c4570a);
    border-radius: 2px;
    margin-bottom: 7px;
  }
  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .title {
    font-family: var(--font-display, 'Archivo Black', sans-serif);
    font-size: var(--fs-nav);
    line-height: 1.15;
    letter-spacing: -0.01em;
    color: var(--text-primary, #1a1008);
  }
  .count {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--fs-label);
    color: var(--accent, #c4570a);
    flex: 0 0 auto;
  }
  /* The cluster description — "the nature of this cluster". Kept readable
     (up to ~4 lines) and capped in height so a long summary can't overflow
     into the cluster's cards below. */
  .summary {
    margin: 7px 0 0;
    font-family: var(--font-body, 'DM Sans', sans-serif);
    font-size: var(--fs-label);
    line-height: 1.4;
    color: var(--text-secondary, rgba(26, 16, 8, 0.78));
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    /* ~4 lines at 11.5px/1.4 ≈ 64px — a hard cap that survives browsers
       without line-clamp support. */
    max-height: 66px;
  }
</style>
