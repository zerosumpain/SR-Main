<!-- src/lib/canvas/intelligence/desk/ThemeHeader.svelte -->
<!--
  World-space header for an "Arrange by theme" cluster. Purely decorative:
  pointer-events are disabled so it never intercepts pan/drag on the desk.
-->
<script lang="ts">
  let {
    label,
    count,
  }: { label: string; count: number } = $props();
</script>

<div class="theme-header" aria-hidden="true">
  <div class="bar"></div>
  <div class="row">
    <span class="label">{label}</span>
    <span class="count">{count}</span>
  </div>
</div>

<style>
  .theme-header {
    width: 240px;
    box-sizing: border-box;
    padding: 4px 2px 8px;
    pointer-events: none;
    user-select: none;
  }
  .bar {
    height: 3px;
    width: 32px;
    background: var(--accent, #c4570a);
    border-radius: 2px;
    margin-bottom: 6px;
  }
  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .label {
    font-family: var(--font-display, 'Archivo Black', sans-serif);
    font-size: var(--fs-body-sm);
    line-height: 1.1;
    letter-spacing: 0.01em;
    text-transform: uppercase;
    color: var(--text-primary, #1a1008);
  }
  .count {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--fs-label);
    color: var(--accent, #c4570a);
    flex: 0 0 auto;
  }
</style>
