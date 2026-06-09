<script lang="ts">
  import { PRESETS, type Preset } from '../lib/scenarios';
  import { app } from '../lib/appState.svelte';

  interface Props {
    activeName: string | null;
    onApply: (p: Preset) => void;
  }
  let { activeName, onApply }: Props = $props();
  const nm = (p: Preset) => (app.narrative === 'eli5' && p.eli5Name ? p.eli5Name : p.name);
  const desc = (p: Preset) => (app.narrative === 'eli5' && p.eli5Desc ? p.eli5Desc : p.description);
</script>

<div class="bar">
  <span class="lab">Scenario</span>
  <div class="chips">
    {#each PRESETS.filter((p) => !p.optimize) as p (p.name)}
      <button class="chip" class:active={activeName === p.name} title={desc(p)} onclick={() => onApply(p)}>
        {nm(p)}
      </button>
    {/each}
  </div>
</div>

<style>
  .bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .lab { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.5); flex-shrink: 0; }
  .chips { display: flex; gap: 5px; flex-wrap: wrap; }
  .chip {
    font-family: 'DM Sans', system-ui, sans-serif; font-size: 11px; padding: 4px 9px; border-radius: 14px;
    border: 1px solid rgba(28,22,17,0.2); background: rgba(255,255,255,0.4); color: rgba(28,22,17,0.78);
    cursor: pointer; white-space: nowrap; transition: all 0.12s;
  }
  .chip:hover { background: rgba(28,22,17,0.08); border-color: rgba(28,22,17,0.35); }
  .chip.active { background: var(--ink, #1c1611); color: var(--paper, #f1ead6); border-color: var(--ink, #1c1611); }
</style>
