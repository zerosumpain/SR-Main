<script lang="ts">
  import type { EmbedBlock } from '$lib/presentation/types';

  let { block }: { block: EmbedBlock } = $props();
</script>

<div class="embed">
  <div class="embed-fallback">
    <span class="ef-kicker">EMBED RETIRED</span>
    <p>“{block.embed}” is no longer available.</p>
  </div>
</div>

<style>
  .embed { width: 100%; min-height: 200px; }
  .embed-loading,
  .embed-fallback {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 320px;
    border: 1px dashed rgba(28, 22, 17, 0.25);
    border-radius: var(--radius-round);
    color: var(--ink-soft);
  }
  .ef-kicker {
    font-family: 'JetBrains Mono', monospace;
    font-size: var(--fs-label-xs);
    letter-spacing: 0.18em;
    color: var(--ink-soft);
  }
  .embed-fallback p { font-size: var(--fs-nav); margin: 0; }
</style>
