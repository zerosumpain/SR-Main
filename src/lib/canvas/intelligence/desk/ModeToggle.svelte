<!-- src/lib/canvas/intelligence/desk/ModeToggle.svelte -->
<script lang="ts">
  let {
    mode,
    synthStatus,
    onGather,
    onSynthesize,
  }: {
    mode: 'gather' | 'synthesize';
    synthStatus: 'idle' | 'running' | 'complete' | 'failed' | 'cancelled';
    onGather: () => void;
    onSynthesize: () => void;
  } = $props();

  const busy = $derived(synthStatus === 'running');
</script>

<div class="mode-toggle" role="group" aria-label="Desk mode">
  <button
    type="button"
    class="seg"
    class:active={mode === 'gather'}
    aria-pressed={mode === 'gather'}
    onclick={onGather}
  >
    <span class="dot gather" class:pulse={mode === 'gather'}></span>
    GATHER
  </button>
  <button
    type="button"
    class="seg"
    class:active={mode === 'synthesize'}
    class:busy
    aria-pressed={mode === 'synthesize'}
    onclick={onSynthesize}
  >
    <span class="dot synth" class:pulse={busy}></span>
    {busy ? 'SYNTHESISING…' : 'SYNTHESIZE'}
  </button>
</div>

<style>
  .mode-toggle {
    display: inline-flex;
    align-items: stretch;
    gap: 0;
    border: 1px solid rgba(26, 16, 8, 0.18);
    border-radius: 999px;
    background: var(--surface-elevated, #e8dece);
    padding: 3px;
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
  }
  .seg {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted, rgba(26, 16, 8, 0.65));
    background: transparent;
    border: 0;
    border-radius: 999px;
    padding: 8px 16px;
    cursor: pointer;
    transition: background 160ms ease, color 160ms ease;
    white-space: nowrap;
  }
  .seg:hover { color: var(--text-primary, #1a1008); }
  .seg.active {
    color: var(--text-primary, #1a1008);
    background: var(--card, #faf6ee);
    box-shadow: inset 0 0 0 1px rgba(26, 16, 8, 0.18);
  }
  .seg.busy { color: var(--accent, #c4570a); }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: 0 0 auto;
    background: rgba(26, 16, 8, 0.3);
  }
  .dot.gather { background: var(--success, #2d7a3a); }
  .dot.synth { background: var(--accent, #c4570a); }
  .seg:not(.active) .dot { opacity: 0.45; }
  .pulse { animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.5); opacity: 0.5; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse { animation: none; }
  }
</style>
