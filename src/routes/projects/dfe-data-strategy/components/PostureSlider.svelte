<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import type { PostureAxis } from '../lib/types';

  let { axis }: { axis: PostureAxis } = $props();
  const v = $derived(app.state.postures[axis.id] ?? 0);
  const eli = $derived(app.narrative === 'eli5');
  // 0 = balanced; show the leaning label
  const lean = $derived(
    Math.abs(v) < 0.12
      ? 'Balanced'
      : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? axis.leftLabel : axis.rightLabel}`,
  );
</script>

<div class="ps" title={`${axis.description}\n\nTension: ${axis.tension}`}>
  <div class="ps-head">
    <span class="ps-left">{axis.leftLabel}</span>
    <span class="ps-lean" class:bal={Math.abs(v) < 0.12}>{lean}</span>
    <span class="ps-right">{axis.rightLabel}</span>
  </div>
  <input
    class="ps-range"
    type="range"
    min="-1"
    max="1"
    step="0.1"
    value={v}
    oninput={(e) => app.setPosture(axis.id, +e.currentTarget.value)}
    aria-label={`${axis.leftLabel} to ${axis.rightLabel}`}
  />
  {#if eli && axis.eli5}<p class="ps-eli">{axis.eli5}</p>{/if}
</div>

<style>
  .ps { padding: 8px 2px 10px; border-bottom: 1px solid rgba(28,22,17,0.08); }
  .ps-head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; margin-bottom: 4px; }
  .ps-left, .ps-right { font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 600; color: rgba(28,22,17,0.7); }
  .ps-right { text-align: right; }
  .ps-lean { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #2f6155; white-space: nowrap; }
  .ps-lean.bal { color: rgba(28,22,17,0.4); }
  .ps-range { width: 100%; accent-color: #2f6155; cursor: pointer; }
  .ps-eli { margin: 4px 0 0; font-size: 10.5px; line-height: 1.4; color: rgba(28,22,17,0.55); }
</style>
