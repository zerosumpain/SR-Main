<script lang="ts">
  // MeasurementPopover — the "how we'd monitor this" affordance on every Briefing
  // chart: data source, latency, the known gap, and what better looks like.
  // Fixed-position panel with an OPAQUE background (paper), per the overlay tokens.
  import { app } from '../lib/appState.svelte';
  import type { Measurement } from '../lib/measurement';

  let { m }: { m: Measurement } = $props();
  const eli = $derived(app.narrative === 'eli5');

  let open = $state(false);
  let trigger: HTMLButtonElement | undefined = $state();
  let pos = $state({ top: 0, left: 0 });

  function toggle() {
    if (!open && trigger) {
      const r = trigger.getBoundingClientRect();
      const width = Math.min(380, window.innerWidth - 24);
      pos = {
        top: Math.min(r.bottom + 8, window.innerHeight - 240),
        left: Math.min(Math.max(12, r.left), window.innerWidth - width - 12),
      };
    }
    open = !open;
  }
  function onKey(e: KeyboardEvent) { if (e.key === 'Escape') open = false; }
</script>

<svelte:window onkeydown={onKey} />

<button class="mp-btn" bind:this={trigger} onclick={toggle} class:on={open}
        title="How would the department monitor this outcome?">⌕ {eli ? 'how we’d track this' : 'how we’d monitor this'}</button>

{#if open}
  <button class="mp-scrim" aria-label="Close" onclick={() => (open = false)}></button>
  <div class="mp-panel" style="top:{pos.top}px; left:{pos.left}px" role="dialog" aria-label="How we'd monitor this">
    {#if eli}
      <p class="mp-eli">{m.eli5}</p>
    {:else}
      <div class="mp-row"><span class="mp-k">Measured by</span><span class="mp-v">{m.sources}</span></div>
      <div class="mp-row"><span class="mp-k">Latency</span><span class="mp-v">{m.latency}</span></div>
      <div class="mp-row"><span class="mp-k">Known gap</span><span class="mp-v gap">{m.gaps}</span></div>
      <div class="mp-row"><span class="mp-k">Better</span><span class="mp-v better">{m.better}</span></div>
    {/if}
    <a class="mp-link" href="/projects/policy-engine/monitor">→ the data spine</a>
  </div>
{/if}

<style>
  .mp-btn { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.04em; color: var(--accent-ink);
    background: var(--accent-ink-tint-12); border: 1px solid var(--accent-ink-tint-35); border-radius: var(--radius-sharp); padding: 2px 8px; cursor: pointer; }
  .mp-btn:hover, .mp-btn.on { background: var(--accent-ink-tint-22); border-color: var(--accent-ink); }
  .mp-scrim { position: fixed; inset: 0; z-index: 190; background: transparent; border: none; cursor: default; }
  .mp-panel { position: fixed; z-index: 200; width: min(380px, calc(100vw - 24px));
    background: var(--paper); border: 1px solid rgba(28,22,17,0.3); border-radius: var(--radius-sharp);
    padding: 12px 14px; display: flex; flex-direction: column; gap: 7px; }
  .mp-row { display: grid; grid-template-columns: 76px 1fr; gap: 8px; align-items: baseline; }
  .mp-k { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.5); }
  .mp-v { font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.8); }
  .mp-v.gap { color: #8a2d3a; }
  .mp-v.better { color: var(--success); }
  .mp-eli { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.8); }
  .mp-link { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; align-self: flex-start; }
</style>
