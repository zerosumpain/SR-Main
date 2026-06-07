<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import LeverRail from '../components/LeverRail.svelte';
  import AgeIdentification from '../components/AgeIdentification.svelte';
  import ScenarioBar from '../components/ScenarioBar.svelte';
  import SavedScenarios from '../components/SavedScenarios.svelte';
  import { LEVERS, policyLevers } from '../lib/levers';
  import { downloadJSON } from '../lib/scenarios';

  let tipOpen = $state(false);
  let importErr = $state<string | null>(null);
  const railLeverCount = LEVERS.filter((l) => l.group !== 'identification').length;

  function exportJson() {
    downloadJSON(`epm-${(app.activePreset ?? 'custom').replace(/\s+/g, '-').toLowerCase()}.json`, JSON.stringify({ levers: app.levers }, null, 2));
  }
  function importJson() {
    if (typeof document === 'undefined') return;
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

<svelte:head><title>Build — Education Policy Modelling</title></svelte:head>

<div class="pe-route wide">
  <span class="pe-eyebrow">Build a scenario</span>
  <h1 class="pe-h1">Move the levers</h1>
  <div class="pe-prose">
    <p>
      Thirty-five policy levers, each tied to a real DfE programme and carrying its own evidence. Start from a named stance, let the
      optimiser spend a fixed budget for you, or build your own package — the headline numbers in the bar above update as you move.
      Click the small <b>ⓘ</b> on any lever to see what it does, what the research says, and — importantly — <b>how the model treats it</b>:
      which outcomes it moves, and why (for instance, core funding buys teacher capacity rather than buying attainment directly).
    </p>
  </div>

  <section class="block">
    <h2 class="pe-h2">Start from a stance</h2>
    <p class="blurb">Each preset is a defensible position a government could take. “Best value” runs a live optimiser that closes the most gap within a budget you set.</p>
    <ScenarioBar activeName={app.activePreset} onApply={(p) => app.applyPreset(p)} />
    <div class="opt-row">
      <div class="opt-ctl" title="Set the annual budget, then click 'Best value' (or drag) to preview the gap-optimal allocation, then 'Apply to sliders'">
        <span class="oc-lab">Best-value budget</span>
        <input class="oc-slider" type="range" min="1" max="15" step="0.5" value={app.optimizeBudget}
               oninput={(e) => (app.optimizeBudget = Number((e.currentTarget as HTMLInputElement).value))}
               onchange={() => app.previewOptimize()} aria-label="Best-value budget" />
        <span class="oc-val">£{app.optimizeBudget.toFixed(1)}bn/yr</span>
      </div>
      {#if app.optimizeResult}
        <span class="opt-note-wrap" class:open={tipOpen}>
          <button class="opt-note" type="button" onclick={() => (tipOpen = !tipOpen)} aria-expanded={tipOpen}>
            {app.optimizeApplied ? '✓ applied:' : '◷ best £' + app.optimizeResult.budget.toFixed(1) + 'bn would'}
            close {app.optimizeResult.closed.toFixed(1)}mo of the gap ({app.optimizeResult.baselineGap.toFixed(1)}→{app.optimizeResult.gap.toFixed(1)})
            by {app.optimizeResult.horizon} for £{app.optimizeResult.cost.toFixed(1)}bn/yr <span class="tip-caret">▾</span>
          </button>
          <span class="opt-tip" role="tooltip">
            <span class="tip-head">Optimised allocation · £{app.optimizeResult.cost.toFixed(2)}bn/yr across {app.optimizeResult.breakdown.length} levers</span>
            {#each app.optimizeResult.breakdown as r (r.id)}
              <span class="tip-row"><i style="background:{r.colour}"></i><span class="tip-label">{r.label}</span><b>{r.display}</b><em>£{r.costBn.toFixed(2)}bn</em></span>
            {/each}
          </span>
        </span>
        <button class="opt-apply" onclick={() => app.applyOptimized()} disabled={app.optimizeApplied}>{app.optimizeApplied ? '✓ Applied' : 'Apply to sliders →'}</button>
      {/if}
      <div class="spacer"></div>
      <SavedScenarios saved={app.saved} suggestedName={app.scenarioName} onSave={(n) => app.saveCurrentAs(n)} onLoad={(s) => app.loadSavedScenario(s)} onPin={(s) => app.pinSavedAsB(s)} onDelete={(id) => app.deleteSaved(id)} />
      <button class="mini" onclick={exportJson}>Export</button>
      <button class="mini" onclick={importJson}>Import</button>
      {#if importErr}<span class="imp-err">Import failed: {importErr}</span>{/if}
    </div>
  </section>

  <section class="block">
    <div class="rail-head">
      <h2 class="pe-h2">The {railLeverCount} levers</h2>
      <span class="rail-sub">ⓘ for evidence &amp; model mechanism · the | tick = announced policy · groups collapse</span>
    </div>
    <LeverRail levers={app.levers} onChange={(id, v) => app.setLever(id, v)} onResetLever={(id) => app.resetLever(id)} multicol />
    <div class="ageid"><AgeIdentification levers={app.levers} onChange={(id, v) => app.setLever(id, v)} onReset={() => app.resetAgeId()} /></div>
  </section>

  <a class="pe-next" href="/projects/policy-engine/outcomes">See what happens → Outcomes</a>
</div>

<style>
  .block { margin: 22px 0; }
  .blurb { margin: 0 0 10px; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.62); max-width: 80ch; }
  .opt-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
  .spacer { flex: 1; }
  .opt-ctl { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border: 1px solid rgba(47,125,79,0.35); border-radius: 14px; background: rgba(47,125,79,0.06); }
  .oc-lab { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #2f7d4f; white-space: nowrap; }
  .oc-slider { -webkit-appearance: none; appearance: none; width: 100px; height: 4px; border-radius: 3px; background: rgba(47,125,79,0.25); outline: none; cursor: pointer; }
  .oc-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 13px; height: 13px; border-radius: 50%; background: #2f7d4f; cursor: pointer; }
  .oc-slider::-moz-range-thumb { width: 13px; height: 13px; border-radius: 50%; background: #2f7d4f; border: none; cursor: pointer; }
  .oc-val { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; color: #2f7d4f; min-width: 64px; }
  .opt-note-wrap { position: relative; display: inline-block; }
  .opt-note { color: #2f7d4f; font-size: 11px; font-family: 'JetBrains Mono', monospace; background: none; border: none; padding: 0; cursor: pointer; text-align: left; line-height: 1.4; }
  .opt-note:hover { text-decoration: underline dotted; }
  .tip-caret { font-size: 8px; opacity: 0.7; }
  .opt-tip { display: none; position: absolute; top: calc(100% + 6px); left: 0; z-index: 60; min-width: min(290px, calc(100vw - 28px)); max-width: 360px;
    background: var(--paper-deep, #e7decc); border: 1px solid rgba(28,22,17,0.25); border-radius: 7px; padding: 9px 11px; box-shadow: 0 8px 24px rgba(0,0,0,0.18); flex-direction: column; gap: 3px; }
  .opt-note-wrap:hover .opt-tip, .opt-note-wrap.open .opt-tip { display: flex; }
  .tip-head { font-family: 'Fraunces', serif; font-weight: 600; font-size: 12px; margin-bottom: 4px; }
  .tip-row { display: grid; grid-template-columns: 10px 1fr auto auto; align-items: baseline; gap: 7px; font-size: 11px; color: rgba(28,22,17,0.8); }
  .tip-row i { width: 8px; height: 8px; border-radius: 50%; align-self: center; }
  .tip-row b { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--ink); white-space: nowrap; }
  .tip-row em { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-style: normal; color: #2f7d4f; white-space: nowrap; text-align: right; }
  .opt-apply { font-family: 'DM Sans', sans-serif; font-size: 11px; padding: 5px 12px; border-radius: 14px; border: 1px solid #2f7d4f; background: #2f7d4f; color: #fff; cursor: pointer; white-space: nowrap; }
  .opt-apply:disabled { background: rgba(47,125,79,0.14); color: #2f7d4f; border-color: rgba(47,125,79,0.3); cursor: default; }
  .mini { background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.2); border-radius: 5px; padding: 5px 10px; color: var(--ink); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; cursor: pointer; }
  .imp-err { color: #8a2d22; font-size: 11px; }
  .rail-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
  .rail-sub { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28,22,17,0.5); }
  .ageid { margin-top: 12px; max-width: 640px; }
</style>
