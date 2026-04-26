<script lang="ts">
  let { mode = $bindable<'watch' | 'tinker' | 'drive'>('watch') }: {
    mode?: 'watch' | 'tinker' | 'drive';
  } = $props();

  const MODES: Array<{ key: 'watch' | 'tinker' | 'drive'; label: string; enabled: boolean }> = [
    { key: 'watch', label: 'Watch', enabled: true },
    { key: 'tinker', label: 'Tinker', enabled: false },
    { key: 'drive', label: 'Drive', enabled: false },
  ];
</script>

<div class="seg" role="group" aria-label="Build interaction mode">
  {#each MODES as m (m.key)}
    <button
      class="seg-btn"
      class:active={mode === m.key}
      disabled={!m.enabled}
      title={m.enabled ? '' : 'Coming soon — Phase 2'}
      onclick={() => {
        if (m.enabled) mode = m.key;
      }}
      type="button"
    >
      {m.label}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    border: 1px solid var(--card-border);
  }
  .seg-btn {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 6px 14px;
    background: transparent;
    color: var(--text-primary);
    border: none;
    cursor: pointer;
  }
  .seg-btn:hover:not(:disabled) {
    background: var(--accent-tint-08);
  }
  .seg-btn.active {
    background: var(--accent);
    color: var(--bg);
  }
  .seg-btn:disabled {
    color: var(--text-ghost);
    cursor: not-allowed;
  }
</style>
