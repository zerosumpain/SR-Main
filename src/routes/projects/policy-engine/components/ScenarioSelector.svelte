<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { PRESETS } from '../lib/scenarios';

  let open = $state(false);
  function pick(p: (typeof PRESETS)[number]) { app.applyPreset(p); open = false; }
</script>

<div class="sel">
  <button class="trigger" class:open onclick={() => (open = !open)} aria-expanded={open} aria-haspopup="listbox">
    <span class="lab">Scenario</span>
    <span class="name">{app.scenarioDisplayName}</span>
    <span class="chev">▾</span>
  </button>

  {#if open}
    <button class="scrim" aria-label="Close" onclick={() => (open = false)}></button>
    <div class="menu" role="listbox">
      <div class="m-lab">{app.narrative === 'eli5' ? 'Pick a ready-made plan' : 'Choose a stance — each is a defensible position a government could take'}</div>
      {#each PRESETS as p (p.name)}
        <button class="opt" class:active={app.activePreset === p.name} role="option" aria-selected={app.activePreset === p.name} onclick={() => pick(p)}>
          <span class="o-name">{app.narrative === 'eli5' && p.eli5Name ? p.eli5Name : p.name}{#if app.activePreset === p.name} ✓{/if}</span>
          <span class="o-desc">{app.narrative === 'eli5' && p.eli5Desc ? p.eli5Desc : p.description}</span>
        </button>
      {/each}
      {#if app.saved.length}
        <div class="m-lab">Your saved scenarios</div>
        {#each app.saved as s (s.id)}
          <button class="opt" role="option" aria-selected={app.matchedSaved === s.name} onclick={() => { app.loadSavedScenario(s); open = false; }}>
            <span class="o-name">★ {s.name}</span>
          </button>
        {/each}
      {/if}
      <div class="m-foot">Open the <b>Levers</b> drawer to build a custom package.</div>
    </div>
  {/if}
</div>

<style>
  .sel { position: relative; }
  .trigger { display: inline-flex; align-items: center; gap: 7px; background: rgba(255,255,255,0.55); border: 1px solid rgba(28,22,17,0.22);
    border-radius: var(--radius-sharp); padding: 5px 10px; cursor: pointer; color: var(--ink); max-width: 280px; }
  .trigger:hover { background: rgba(255,255,255,0.8); }
  .trigger.open { border-color: var(--ink); }
  .lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.45); }
  .name { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-nav); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chev { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }
  .scrim { position: fixed; inset: 0; z-index: 40; background: transparent; border: none; cursor: default; }
  .menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 50; width: min(420px, calc(100vw - 28px));
    background: var(--paper-deep); border: 1px solid rgba(28,22,17,0.22); border-radius: var(--radius-sharp);
    padding: 8px; max-height: min(70vh, 540px); overflow-y: auto; }
  .m-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); padding: 6px 8px 4px; }
  .opt { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; background: none; border: none; border-radius: var(--radius-sharp); padding: 8px 9px; cursor: pointer; }
  .opt:hover { background: rgba(28,22,17,0.06); }
  .opt.active { background: rgba(28,22,17,0.09); }
  .o-name { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-label); color: var(--ink); }
  .o-desc { font-size: var(--fs-label-xs); line-height: 1.4; color: rgba(28,22,17,0.66); }
  .m-foot { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); padding: 8px 9px 4px; border-top: 1px solid rgba(28,22,17,0.1); margin-top: 4px; }
  .m-foot b { color: var(--ink); }
</style>
