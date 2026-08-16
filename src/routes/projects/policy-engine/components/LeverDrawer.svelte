<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import LeverRail from './LeverRail.svelte';
  import AgeIdentification from './AgeIdentification.svelte';
  import ScenarioBar from './ScenarioBar.svelte';
  import SavedScenarios from './SavedScenarios.svelte';
  import { LEVERS, policyLevers, LEVER_ELI5_NAME } from '../lib/levers';
  import { downloadJSON } from '../lib/scenarios';
  const rname = (id: string, label: string) => (app.narrative === 'eli5' ? LEVER_ELI5_NAME[id] ?? label : label);

  let tipOpen = $state(false);
  let importErr = $state<string | null>(null);
  let importOk = $state(false);
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
        app.optimizeResult = null; app.basePreset = null; app.levers = { ...policyLevers(), ...incoming }; importErr = null;
        importOk = true; setTimeout(() => (importOk = false), 1700);
      } catch (e) { importErr = e instanceof Error ? e.message : 'Bad file'; }
    };
    input.click();
  }
</script>

<div class="panel">
  <div class="d-head">
    <div class="d-title-wrap">
      <span class="d-title">Policy levers</span>
      <span class="d-sub">{railLeverCount} levers · move one and watch the data →</span>
    </div>
    <button class="d-close" onclick={() => app.peekDrawer()} title="Collapse to the changed-levers rail" aria-label="Collapse levers">‹</button>
  </div>

  <div class="d-body">
    <section class="blk">
      <h3>Start from a stance</h3>
      <ScenarioBar activeName={app.activePreset} onApply={(p) => app.applyPreset(p)} />
      {#if app.basePreset && app.basePresetLevers && app.changedFromBase.length > 0}
        <div class="base-row">
          <span class="base-note">{app.changedFromBase.length} change{app.changedFromBase.length === 1 ? '' : 's'} vs “{app.scenarioBaseDisplay}”</span>
          <button class="base-reset" onclick={() => app.resetToBase()}>↺ back to {app.scenarioBaseDisplay}</button>
        </div>
      {/if}

      <!-- The "Best value" scenario IS the budget slider: one cohesive control. -->
      <div class="bestval" class:on={!!app.optimizeResult}>
        <div class="bv-head">
          <span class="bv-title">⚙ {app.narrative === 'eli5' ? 'Best bang for the buck' : 'Best value'}</span>
          <span class="bv-sub">{app.narrative === 'eli5'
            ? 'Pick a yearly budget — the computer finds the mix that closes the gap most, and skips poor-value spending.'
            : 'Set a yearly budget — the optimiser allocates it to the most gap-efficient levers, then “Apply to sliders”.'}</span>
        </div>
        <div class="opt-ctl">
          <span class="oc-lab">Budget</span>
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
                  <span class="tip-row"><i style="background:{r.colour}"></i><span class="tl">{rname(r.id, r.label)}</span><b>{r.display}</b><em>£{r.costBn.toFixed(2)}bn</em></span>
                {/each}
              </div>
            {/if}
            <button class="opt-apply" onclick={() => app.applyOptimized()} disabled={app.optimizeApplied}>{app.optimizeApplied ? '✓ Applied' : 'Apply to sliders →'}</button>
          </div>
        {:else}
          <button class="opt-find" onclick={() => app.previewOptimize()}>Find the best mix →</button>
        {/if}
      </div>
      <div class="io-row">
        <SavedScenarios saved={app.saved} suggestedName={app.scenarioName} onSave={(n) => app.saveCurrentAs(n)} onLoad={(s) => app.loadSavedScenario(s)} onPin={(s) => app.pinSavedAsB(s)} onDelete={(id) => app.deleteSaved(id)} />
        <button class="mini" onclick={exportJson}>Export</button>
        <button class="mini" class:ok={importOk} onclick={importJson}>{importOk ? '✓ Imported' : 'Import'}</button>
        <button class="mini danger" onclick={() => app.resetAll()}>Reset</button>
      </div>
      <span class="io-hint">JSON shape: {'{ "levers": { "<lever-id>": value } }'}</span>
      {#if importErr}<span class="imp-err">Import failed: {importErr}</span>{/if}
    </section>

    <section class="blk">
      <div class="rail-head"><h3>The levers</h3><span class="rh-sub">ⓘ = evidence &amp; how the model treats it</span></div>
      <LeverRail levers={app.levers} onChange={(id, v) => app.setLever(id, v)} onResetLever={(id) => app.resetLever(id)} />
      <div class="ageid"><AgeIdentification levers={app.levers} onChange={(id, v) => app.setLever(id, v)} onReset={() => app.resetAgeId()} /></div>
    </section>
  </div>
</div>

<style>
  .panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .d-head { display: flex; align-items: center; gap: 8px; padding: 11px 14px 10px; border-bottom: 1px solid rgba(28,22,17,0.12); flex-shrink: 0; }
  .d-title-wrap { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .d-title { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body-sm); color: var(--ink); }
  .d-sub { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }
  .d-close { margin-left: auto; background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-sharp); width: 26px; height: 26px; cursor: pointer; font-size: var(--fs-body); line-height: 1; color: var(--ink); flex-shrink: 0; }
  .d-close:hover { background: rgba(28,22,17,0.06); }
  .d-body { overflow-y: auto; overscroll-behavior: contain; padding: 12px 14px 40px; flex: 1; min-height: 0; }
  .blk { margin-bottom: 18px; }
  h3 { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-label); margin: 0 0 8px; color: var(--ink); }
  .rail-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .rh-sub { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.45); }
  .bestval { margin-top: 12px; padding: 10px 12px; border: 1px solid var(--success-border); border-radius: var(--radius-sharp); background: var(--success-bg); display: flex; flex-direction: column; gap: 8px; }
  .bestval.on { border-color: var(--success-border); background: var(--success-bg); }
  .bv-head { display: flex; flex-direction: column; gap: 2px; }
  .bv-title { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-label); color: var(--success); }
  .bv-sub { font-size: var(--fs-label-xs); line-height: 1.4; color: rgba(28,22,17,0.6); }
  .opt-find { align-self: flex-start; font-family: var(--font-body); font-size: var(--fs-label-xs); padding: 5px 12px; border-radius: var(--radius-sharp); border: 1px solid var(--success); background: var(--success-bg); color: var(--success); cursor: pointer; }
  .opt-find:hover { background: var(--success-border); }
  .opt-ctl { display: flex; align-items: center; gap: 8px; }
  .oc-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em; color: var(--success); }
  .oc-slider { -webkit-appearance: none; appearance: none; flex: 1; min-width: 70px; height: 4px; border-radius: var(--radius-sharp); background: var(--success-border); outline: none; cursor: pointer; }
  .oc-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 13px; height: 13px; border-radius: var(--radius-pill); background: var(--success); cursor: pointer; }
  .oc-slider::-moz-range-thumb { width: 13px; height: 13px; border-radius: var(--radius-pill); background: var(--success); border: none; }
  .oc-val { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: var(--success); }
  .opt-res { display: flex; flex-direction: column; gap: 6px; }
  .opt-note { color: var(--success); font-size: var(--fs-label-xs); font-family: var(--font-mono); background: none; border: none; padding: 0; cursor: pointer; text-align: left; line-height: 1.4; }
  .opt-tip { display: flex; flex-direction: column; gap: 3px; background: var(--paper-deep); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-sharp); padding: 8px 10px; }
  .tip-row { display: grid; grid-template-columns: 9px 1fr auto auto; align-items: baseline; gap: 6px; font-size: var(--fs-label-xs); color: rgba(28,22,17,0.8); }
  .tip-row i { width: 8px; height: 8px; border-radius: var(--radius-pill); align-self: center; }
  .tip-row b { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--ink); white-space: nowrap; }
  .tip-row em { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-style: normal; color: var(--success); text-align: right; }
  .opt-apply { align-self: flex-start; font-family: var(--font-body); font-size: var(--fs-label-xs); padding: 5px 12px; border-radius: var(--radius-sharp); border: 1px solid var(--success); background: var(--success); color: #fff; cursor: pointer; }
  .opt-apply:disabled { background: var(--success-bg); color: var(--success); border-color: var(--success-border); cursor: default; }
  .io-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
  .mini { background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-sharp); padding: 5px 9px; color: var(--ink); font-family: var(--font-mono); font-size: var(--fs-label-xs); cursor: pointer; }
  .mini.danger { border-color: var(--error-border); color: var(--error); }
  .mini.ok { border-color: var(--success); color: var(--success); }
  .io-hint { display: block; margin-top: 5px; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.42); }
  .imp-err { display: block; margin-top: 6px; color: var(--error); font-size: var(--fs-label-xs); }
  .base-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: 8px;
    padding: 6px 9px; border: 1px solid var(--accent-ink-tint-22); border-radius: var(--radius-sharp); background: var(--accent-ink-tint-06); }
  .base-note { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); }
  .base-reset { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); background: transparent;
    border: 1px solid var(--accent-ink-tint-35); border-radius: var(--radius-sharp); padding: 3px 7px; cursor: pointer; }
  .base-reset:hover { background: var(--accent-ink-tint-12); }
  .ageid { margin-top: 12px; }
</style>
