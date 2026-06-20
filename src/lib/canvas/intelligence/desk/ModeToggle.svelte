<!-- src/lib/canvas/intelligence/desk/ModeToggle.svelte -->
<script lang="ts">
  let {
    mode,
    synthesising = false,
    disabled = false,
    onmode,
  }: {
    mode: 'gather' | 'synthesize';
    synthesising?: boolean;
    disabled?: boolean;
    onmode: (next: 'gather' | 'synthesize') => void;
  } = $props();

  function pick(next: 'gather' | 'synthesize') {
    if (disabled) return;
    if (next === mode) return;
    onmode(next);
  }
</script>

<div class="mode-toggle" role="radiogroup" aria-label="Desk mode" class:disabled>
  <button
    type="button"
    role="radio"
    aria-checked={mode === 'gather'}
    class="seg"
    class:active={mode === 'gather'}
    onclick={() => pick('gather')}
    {disabled}
  >
    <span class="dot gather" class:pulse={mode === 'gather' && !synthesising}></span>
    GATHER
  </button>
  <button
    type="button"
    role="radio"
    aria-checked={mode === 'synthesize'}
    class="seg"
    class:active={mode === 'synthesize'}
    class:busy={synthesising}
    onclick={() => pick('synthesize')}
    {disabled}
  >
    <span class="dot synth" class:pulse={synthesising}></span>
    {synthesising ? 'SYNTHESISING…' : 'SYNTHESIZE'}
  </button>
</div>

<style>
  .mode-toggle {
    display: inline-flex;
    align-items: stretch;
    gap: 0;
    border: 1px solid rgba(26, 16, 8, 0.18);
    border-radius: var(--radius-pill);
    background: var(--surface-elevated, #e8dece);
    padding: 3px;
  }
  .mode-toggle.disabled { opacity: 0.55; }
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
    border-radius: var(--radius-pill);
    padding: 8px 16px;
    cursor: pointer;
    transition: background 160ms ease, color 160ms ease;
    white-space: nowrap;
  }
  .seg:hover:not(:disabled) { color: var(--text-primary, #1a1008); }
  .seg:disabled { cursor: default; }
  .seg.active {
    color: var(--text-primary, #1a1008);
    background: var(--surface-elevated, #faf6ee);
    outline: 1px solid rgba(26, 16, 8, 0.18);
    outline-offset: -1px;
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
