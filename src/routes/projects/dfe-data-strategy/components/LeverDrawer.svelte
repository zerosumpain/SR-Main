<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { POSTURE_AXES } from '../lib/postures';
  import { pct } from '../lib/format';
  import PostureSlider from './PostureSlider.svelte';
  import AllocationDial from './AllocationDial.svelte';
  import ScenarioSelector from './ScenarioSelector.svelte';

  const cov = $derived(app.align.overallCoverage);
  function save() {
    const name = prompt('Name this strategy:', app.scenarioName);
    if (name && name.trim()) app.saveCurrentAs(name.trim());
  }
</script>

<div class="ld">
  <div class="ld-top">
    <ScenarioSelector />
    <button class="x" onclick={() => app.closeDrawer()} title="Collapse the levers" aria-label="Close levers">⟨</button>
  </div>

  <div class="ld-cov" title="Severity-weighted share of the pressures your current strategy covers">
    <span class="cov-lab">Overall pressure coverage</span>
    <div class="cov-bar"><span style="width:{cov * 100}%"></span></div>
    <span class="cov-val">{pct(cov)}</span>
  </div>

  <div class="ld-body">
    <section class="grp">
      <h4 class="grp-h">Strategic posture</h4>
      <p class="grp-sub">Where you stand on the core tensions.</p>
      {#each POSTURE_AXES as axis}
        <PostureSlider {axis} />
      {/each}
    </section>

    <section class="grp">
      <h4 class="grp-h">Where the effort goes</h4>
      <p class="grp-sub">Split a finite pot across the capabilities. The bar shows the live share.</p>
      <AllocationDial />
    </section>
  </div>

  <div class="ld-foot">
    <button class="lb" onclick={() => app.resetToBase()} title="Discard changes, back to the stance you started from">↺ Reset to stance</button>
    <button class="lb" onclick={save} title="Save this strategy to compare later">★ Save</button>
    {#if !app.compareB}
      <button class="lb" onclick={() => app.pinAsB()} title="Pin this as B, then change A to compare">⇆ Compare</button>
    {:else}
      <button class="lb danger" onclick={() => app.clearCompare()} title="Stop comparing">✕ Compare</button>
    {/if}
  </div>
</div>

<style>
  .ld { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .ld-top { display: flex; align-items: center; gap: 8px; padding: 12px 14px 8px; border-bottom: 1px solid rgba(28,22,17,0.1); }
  .x { margin-left: auto; background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-sharp); width: 26px; height: 26px; cursor: pointer; color: var(--ink); font-size: var(--fs-label); }
  .ld-cov { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; padding: 10px 14px; border-bottom: 1px solid rgba(28,22,17,0.08); }
  .cov-lab { grid-column: 1 / -1; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.55); }
  .cov-bar { height: 8px; border-radius: var(--radius-sharp); background: rgba(28,22,17,0.1); overflow: hidden; }
  .cov-bar span { display: block; height: 100%; background: linear-gradient(90deg, #b4632e, var(--success)); transition: width 0.2s ease; }
  .cov-val { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body-sm); color: var(--ink); }
  .ld-body { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 14px 10px; }
  .grp { margin-bottom: 14px; }
  .grp-h { margin: 12px 0 2px; font-family: var(--fs-serif); font-size: var(--fs-nav); font-weight: 600; color: var(--ink); }
  .grp-sub { margin: 0 0 8px; font-size: var(--fs-label-xs); line-height: 1.4; color: rgba(28,22,17,0.6); }
  .ld-foot { display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 14px; border-top: 1px solid rgba(28,22,17,0.1); background: rgba(241,234,214,0.6); }
  .lb { background: rgba(255,255,255,0.7); border: 1px solid rgba(28,22,17,0.22); border-radius: var(--radius-sharp); padding: 5px 9px; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--ink); cursor: pointer; }
  .lb:hover { background: rgba(28,22,17,0.06); }
  .lb.danger { border-color: var(--error-border); color: var(--error); }
</style>
