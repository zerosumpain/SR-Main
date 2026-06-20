<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { CAPABILITY_AREAS } from '../lib/capabilities';

  // Relative-emphasis sliders across the capability areas. The pot is finite: the
  // engine works on each area's SHARE of the total, so the displayed % is what matters.
  const total = $derived(app.allocTotal || 1);
  const share = (id: string) => (app.state.allocation[id] ?? 0) / total;

  const COLORS: Record<string, string> = {
    governance: '#8a2d3a',
    platform: '#2f6f97',
    skills: '#9a7b1f',
    interoperability: '#2f6155',
    quality: '#b4632e',
    ethics: '#7a5aa6',
    sharing: '#3a5fa8',
    value: '#2f7d4f',
  };
</script>

<div class="ad">
  <div class="ad-bar" aria-hidden="true">
    {#each CAPABILITY_AREAS as a}
      <span class="seg" style="width:{share(a.id) * 100}%; background:{COLORS[a.id] ?? '#2f6155'}" title={`${a.name}: ${Math.round(share(a.id) * 100)}%`}></span>
    {/each}
  </div>
  {#each CAPABILITY_AREAS as a}
    <div class="row" class:hl={app.highlightArea === a.id}>
      <div class="r-head">
        <span class="dot" style="background:{COLORS[a.id] ?? '#2f6155'}"></span>
        <span class="r-name" title={a.description}>{a.short}</span>
        <span class="r-pct">{Math.round(share(a.id) * 100)}%</span>
      </div>
      <input
        class="r-range"
        type="range"
        min="0"
        max="30"
        step="1"
        value={app.state.allocation[a.id] ?? 0}
        oninput={(e) => app.setAllocation(a.id, +e.currentTarget.value)}
        style="accent-color:{COLORS[a.id] ?? '#2f6155'}"
        aria-label={`${a.name} effort`}
      />
    </div>
  {/each}
</div>

<style>
  .ad { padding: 4px 2px; }
  .ad-bar { display: flex; height: 10px; border-radius: var(--radius-round); overflow: hidden; margin: 2px 0 12px; background: rgba(28,22,17,0.08); }
  .ad-bar .seg { display: block; height: 100%; transition: width 0.18s ease; }
  .row { padding: 5px 4px; border-radius: var(--radius-round); }
  .row.hl { background: var(--accent-tint-20); animation: flash 1.4s ease; }
  @keyframes flash { 0% { background: var(--accent-tint-25); } 100% { background: var(--accent-tint-08); } }
  .r-head { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
  .dot { width: 7px; height: 7px; border-radius: var(--radius-sharp); flex-shrink: 0; }
  .r-name { font-family: 'DM Sans', sans-serif; font-size: 11.5px; font-weight: 600; color: rgba(28,22,17,0.78); }
  .r-pct { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(28,22,17,0.6); }
  .r-range { width: 100%; cursor: pointer; }
</style>
