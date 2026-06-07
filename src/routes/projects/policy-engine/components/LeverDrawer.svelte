<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import LeverRail from './LeverRail.svelte';
  import AgeIdentification from './AgeIdentification.svelte';
  import ScenarioBar from './ScenarioBar.svelte';
  import SavedScenarios from './SavedScenarios.svelte';
  import { LEVERS, policyLevers } from '../lib/levers';
  import { downloadJSON } from '../lib/scenarios';

  let tipOpen = $state(false);
  let importErr = $state<string | null>(null);
  const railLeverCount = LEVERS.filter((l) => l.group !== 'identification').length;

  function exportJson() {
    downloadJSON(`epm-${(app.activePreset ?? 'custom').replace(/\s+/g, '-').toLowerCase()}.json`, JSON.stringify({ levers: app.levers }, null, 2));
  }
  function importJson() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        const incoming = obj && obj.levers ? obj.levers : obj;
        if (!incoming || typeof incoming !== 'object') throw new Error('No levers found.');
        app.optimizeResult = null; app.levers = { ...policyLevers(), ...incoming }; importErr = null;
      } catch (e) { importErr = e instanceof Error ? e.message : 'Bad file'; }
    };
    input.click();
  }
</script>

{#if app.drawerOpen && !app.drawerPinned}
  <button class="backdrop" aria-label="Close levers" onclick={() => app.closeDrawer()}></button>
{/if}

<aside class="drawer" class:open={app.drawerOpen} class:pinned={app.drawerPinned} aria-hidden={!app.drawerOpen}>
  <div class="d-head">
    <span class="d-title">Policy levers</span>
    <span class="d-sub">{railLeverCount} levers</span>
    <div class="d-actions">
      <button class="d-pin" class:on={app.drawerPinned} onclick={() => (app.drawerPinned = !app.drawerPinned)} title={app.drawerPinned ? 'Unpin (overlay)' : 'Pin open (dock)'}>{app.drawerPinned ? '📌' : '📍'}</button>
      <button class="d-close" onclick={() => app.closeDrawer()} aria-label="Close levers">✕</button>
    </div>
  </div>

  <div class="d-body">
    <section class="blk">
      <h3>Start from a stance</h3>
      <ScenarioBar activeName={app.activePreset} onApply={(p) => app.applyPreset(p)} />
      <div class="opt-ctl" title="Set a budget, then click 'Best value' to preview the gap-optimal allocation, then 'Apply'">
        <span class="oc-lab">Best-value £</span>
        <input class="oc-slider" type="range" min="1" max="15" step="0.5" value={app.optimizeBudget}
               oninput={(e) => (app.optimizeBudget = Number((e.currentTarget as HTMLInputElement).value))}
               onchange={() => app.previewOptimize()} aria-label="Best-value budget" />
        <span class="oc-val">£{app.optimizeBudget.toFixed(1)}bn/yr</span>
      </div>
      {#if app.optimizeResult}
        <div class="opt-res">
          <button class="opt-note" type="button" onclick={() => (tipOpen = !tipOpen)} aria-expanded={tipOpen}>
            {app.optimizeApplied ? '✓ applied:' : '◷ best £' + app.optimizeResult.budget.toFixed(1) + 'bn would'}
            close {app.optimizeResult.closed.toFixed(1)}mo ({app.optimizeResult.baselineGap.toFixed(1)}→{app.optimizeResult.gap.toFixed(1)}) by {app.optimizeResult.horizon} ▾
          </button>
          {#if tipOpen}
            <div class="opt-tip">
              {#each app.optimizeResult.breakdown as r (r.id)}
                <span class="tip-row"><i style="background:{r.colour}"></i><span class="tl">{r.label}</span><b>{r.display}</b><em>£{r.costBn.toFixed(2)}bn</em></span>
              {/each}
            </div>
          {/if}
          <button class="opt-apply" onclick={() => app.applyOptimized()} disabled={app.optimizeApplied}>{app.optimizeApplied ? '✓ Applied' : 'Apply to sliders →'}</button>
        </div>
      {/if}
      <div class="io-row">
        <SavedScenarios saved={app.saved} suggestedName={app.scenarioName} onSave={(n) => app.saveCurrentAs(n)} onLoad={(s) => app.loadSavedScenario(s)} onPin={(s) => app.pinSavedAsB(s)} onDelete={(id) => app.deleteSaved(id)} />
        <button class="mini" onclick={exportJson}>Export</button>
        <button class="mini" onclick={importJson}>Import</button>
        <button class="mini danger" onclick={() => app.resetAll()}>Reset</button>
      </div>
      {#if importErr}<span class="imp-err">Import failed: {importErr}</span>{/if}
    </section>

    <section class="blk">
      <div class="rail-head"><h3>The levers</h3><span class="rh-sub">ⓘ = evidence &amp; how the model treats it</span></div>
      <LeverRail levers={app.levers} onChange={(id, v) => app.setLever(id, v)} onResetLever={(id) => app.resetLever(id)} />
      <div class="ageid"><AgeIdentification levers={app.levers} onChange={(id, v) => app.setLever(id, v)} onReset={() => app.resetAgeId()} /></div>
    </section>
  </div>
</aside>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 90; background: rgba(28,22,17,0.28); border: none; cursor: pointer; padding: 0; }
  .drawer {
    position: fixed; left: 0; top: 0; bottom: 0; width: 372px; max-width: 88vw; z-index: 100;
    background: var(--paper, #f1ead6); border-right: 1px solid rgba(28,22,17,0.18);
    box-shadow: 8px 0 30px -16px rgba(0,0,0,0.4); display: flex; flex-direction: column;
    transform: translateX(-100%); transition: transform 0.24s ease; will-change: transform;
  }
  .drawer.open { transform: translateX(0); }
  @media (prefers-reduced-motion: reduce) { .drawer { transition: none; } }
  .d-head { display: flex; align-items: baseline; gap: 8px; padding: 12px 14px 10px; border-bottom: 1px solid rgba(28,22,17,0.12); flex-shrink: 0; }
  .d-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; color: var(--ink, #1c1611); }
  .d-sub { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28,22,17,0.45); }
  .d-actions { margin-left: auto; display: inline-flex; gap: 4px; }
  .d-pin, .d-close { background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.2); border-radius: 6px; width: 28px; height: 26px; cursor: pointer; font-size: 12px; color: var(--ink, #1c1611); }
  .d-pin.on { background: #2f6f97; border-color: #2f6f97; }
  .d-body { overflow-y: auto; padding: 12px 14px 40px; flex: 1; min-height: 0; }
  .blk { margin-bottom: 18px; }
  h3 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 13.5px; margin: 0 0 8px; color: var(--ink, #1c1611); }
  .rail-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .rh-sub { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.45); }
  .opt-ctl { display: inline-flex; align-items: center; gap: 7px; padding: 4px 9px; margin-top: 10px; border: 1px solid rgba(47,125,79,0.35); border-radius: 14px; background: rgba(47,125,79,0.06); }
  .oc-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: #2f7d4f; }
  .oc-slider { -webkit-appearance: none; appearance: none; width: 90px; height: 4px; border-radius: 3px; background: rgba(47,125,79,0.25); outline: none; cursor: pointer; }
  .oc-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 13px; height: 13px; border-radius: 50%; background: #2f7d4f; cursor: pointer; }
  .oc-slider::-moz-range-thumb { width: 13px; height: 13px; border-radius: 50%; background: #2f7d4f; border: none; }
  .oc-val { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 600; color: #2f7d4f; }
  .opt-res { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .opt-note { color: #2f7d4f; font-size: 10.5px; font-family: 'JetBrains Mono', monospace; background: none; border: none; padding: 0; cursor: pointer; text-align: left; line-height: 1.4; }
  .opt-tip { display: flex; flex-direction: column; gap: 3px; background: var(--paper-deep, #e7decc); border: 1px solid rgba(28,22,17,0.2); border-radius: 7px; padding: 8px 10px; }
  .tip-row { display: grid; grid-template-columns: 9px 1fr auto auto; align-items: baseline; gap: 6px; font-size: 10.5px; color: rgba(28,22,17,0.8); }
  .tip-row i { width: 8px; height: 8px; border-radius: 50%; align-self: center; }
  .tip-row b { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ink); white-space: nowrap; }
  .tip-row em { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-style: normal; color: #2f7d4f; text-align: right; }
  .opt-apply { align-self: flex-start; font-family: 'DM Sans', sans-serif; font-size: 11px; padding: 5px 12px; border-radius: 14px; border: 1px solid #2f7d4f; background: #2f7d4f; color: #fff; cursor: pointer; }
  .opt-apply:disabled { background: rgba(47,125,79,0.14); color: #2f7d4f; border-color: rgba(47,125,79,0.3); cursor: default; }
  .io-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
  .mini { background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.2); border-radius: 5px; padding: 5px 9px; color: var(--ink); font-family: 'JetBrains Mono', monospace; font-size: 10px; cursor: pointer; }
  .mini.danger { border-color: rgba(177,69,94,0.4); color: #b1455e; }
  .imp-err { display: block; margin-top: 6px; color: #8a2d22; font-size: 11px; }
  .ageid { margin-top: 12px; }
</style>
