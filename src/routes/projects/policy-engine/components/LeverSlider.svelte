<script lang="ts">
  // LeverSlider — the canonical styled engine-lever slider, wired to the shared app store.
  // Reads/writes app.levers via app.setLever, shows the live value + unit + a baseline tick,
  // and supports the app.highlightLever "jump to + flash" primitive. Reuses the slider idiom
  // from AgeIdentification so every lever-driven chart speaks the same visual language.
  import { app } from '../lib/appState.svelte';
  import { LEVERS_BY_ID, GROUP_META, LEVER_ELI5_NAME } from '../lib/levers';

  interface Props {
    id: string;
    /** Override the group accent colour. */
    color?: string;
    /** Hide the textual label (chart already names the lever). */
    compact?: boolean;
    /** Show the one-line evidence note under the slider. */
    showNote?: boolean;
  }
  let { id, color, compact = false, showNote = false }: Props = $props();

  const L = $derived(LEVERS_BY_ID[id]);
  const col = $derived(color ?? GROUP_META[L.group]?.colour ?? '#7a5aa6');
  const value = $derived(app.levers[id] ?? L.baseline);
  const name = $derived(app.narrative === 'eli5' ? (LEVER_ELI5_NAME[id] ?? L.label) : L.label);
  const flash = $derived(app.highlightLever === id);

  const pct = $derived(((value - L.min) / (L.max - L.min)) * 100);
  const basePct = $derived(((L.baseline - L.min) / (L.max - L.min)) * 100);
  const policyPct = $derived(((L.policy - L.min) / (L.max - L.min)) * 100);

  function display(v: number): string {
    return L.format ? L.format(v) : `${v}${L.unit === '%' ? '%' : ''}`;
  }
</script>

<div class="lvs" class:flash class:compact>
  {#if !compact}
    <div class="lv-top">
      <span class="lv-name">{name}</span>
      <span class="lv-val" style="color:{col}">{display(value)}{#if L.unit !== '%' && !L.format}<i class="u">{L.unit}</i>{/if}</span>
    </div>
  {/if}
  <div class="slider-wrap">
    <input
      class="slider" type="range" min={L.min} max={L.max} step={L.step} {value}
      style="--fill:{pct}%; --col:{col}"
      aria-label={name}
      oninput={(e) => app.setLever(id, Number((e.currentTarget as HTMLInputElement).value))} />
    <span class="base-tick" style="left:{basePct}%" title="status quo: {display(L.baseline)}"></span>
    {#if L.policy !== L.baseline}
      <span class="policy-tick" style="left:{policyPct}%" title="announced policy: {display(L.policy)}"></span>
    {/if}
    {#if compact}<span class="lv-val-c" style="color:{col}">{display(value)}</span>{/if}
  </div>
  {#if showNote}<p class="lv-note">{L.evidence}</p>{/if}
</div>

<style>
  .lvs { margin: 6px 0; transition: background 0.3s; border-radius: var(--radius-sharp); }
  .lvs.flash { background: var(--accent-tint-20); animation: flash 1.4s ease-out; }
  @keyframes flash { 0% { background: var(--accent-tint-20); } 100% { background: transparent; } }
  .lv-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 1px; }
  .lv-name { font-size: var(--fs-label-xs); color: var(--ink); line-height: 1.25; }
  .lv-val { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; white-space: nowrap; }
  .lv-val .u { font-style: normal; font-size: var(--fs-label-xs); opacity: 0.6; margin-left: 2px; }
  .slider-wrap { position: relative; padding-top: 2px; display: flex; align-items: center; gap: 8px; }
  .compact .slider-wrap { padding-top: 0; }
  .lv-val-c { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; white-space: nowrap; min-width: 52px; text-align: right; }
  .slider {
    -webkit-appearance: none; appearance: none; flex: 1; width: 100%; height: 4px; border-radius: var(--radius-sharp);
    background: linear-gradient(to right, var(--col) 0%, var(--col) var(--fill), rgba(28,22,17,0.14) var(--fill), rgba(28,22,17,0.14) 100%);
    outline: none; cursor: pointer; margin: 5px 0;
  }
  .slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: var(--radius-pill); background: var(--paper); border: 2px solid var(--col); cursor: pointer; }
  .slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: var(--radius-pill); background: var(--paper); border: 2px solid var(--col); cursor: pointer; }
  .base-tick { position: absolute; top: 1px; width: 2px; height: 12px; background: rgba(28,22,17,0.4); transform: translateX(-50%); pointer-events: none; border-radius: var(--radius-sharp); }
  .policy-tick { position: absolute; top: 2px; width: 0; height: 0; border-left: 3px solid transparent; border-right: 3px solid transparent; border-top: 5px solid rgba(28,22,17,0.3); transform: translateX(-50%); pointer-events: none; }
  .lv-note { margin: 2px 0 0; font-size: var(--fs-label-xs); line-height: 1.35; color: rgba(28,22,17,0.5); }
</style>
