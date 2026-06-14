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
    background: var(--card, #faf6ee);
    border: 1px solid rgba(26, 16, 8, 0.18);
    border-radius: 4px;
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
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
    font-size: 13px;
    line-height: 1.15;
    color: var(--text-primary, #1a1008);
  }
  .count {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 11px;
    color: var(--accent, #c4570a);
    flex: 0 0 auto;
  }
  .summary {
    margin: 6px 0 0;
    font-family: var(--font-body, 'DM Sans', sans-serif);
    font-size: 11px;
    line-height: 1.35;
    color: var(--text-muted, rgba(26, 16, 8, 0.65));
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
