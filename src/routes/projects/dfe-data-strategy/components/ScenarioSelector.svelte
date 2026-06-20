<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { PRESETS } from '../lib/scenarios';

  const eli = $derived(app.narrative === 'eli5');
  function onPick(e: Event) {
    const val = (e.currentTarget as HTMLSelectElement).value;
    if (val.startsWith('preset:')) {
      const p = PRESETS.find((x) => x.name === val.slice(7));
      if (p) app.applyPreset(p);
    } else if (val.startsWith('saved:')) {
      const s = app.saved.find((x) => x.id === val.slice(6));
      if (s) app.loadSavedScenario(s);
    }
  }
  const currentValue = $derived(
    app.activePreset ? `preset:${app.activePreset}` : app.matchedSaved ? `saved:${app.saved.find((s) => s.name === app.matchedSaved)?.id}` : 'custom',
  );
</script>

<div class="sel">
  <span class="sel-lab">Strategy</span>
  <select class="sel-input" value={currentValue} onchange={onPick} title="Pick a starting stance or one of your saved strategies">
    {#if !app.activePreset && !app.matchedSaved}
      <option value="custom">{app.scenarioName}</option>
    {/if}
    <optgroup label="Stances">
      {#each PRESETS as p}
        <option value={`preset:${p.name}`}>{eli && p.eli5Name ? p.eli5Name : p.name}</option>
      {/each}
    </optgroup>
    {#if app.saved.length}
      <optgroup label="Saved">
        {#each app.saved as s}
          <option value={`saved:${s.id}`}>{s.name}</option>
        {/each}
      </optgroup>
    {/if}
  </select>
</div>

<style>
  .sel { display: inline-flex; align-items: center; gap: 7px; }
  .sel-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.5); }
  .sel-input { background: rgba(255,255,255,0.7); border: 1px solid rgba(28,22,17,0.25); border-radius: var(--radius-round); padding: 5px 9px;
    font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; color: var(--ink); cursor: pointer; max-width: 240px; }
</style>
