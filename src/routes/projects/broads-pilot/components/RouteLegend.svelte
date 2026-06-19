<script lang="ts">
  // Key for the styled route line: colour = cumulative travel-time band,
  // dash = posted speed limit. Shown only while a route is on the map.
  import { app } from '../lib/appState.svelte';
  import { TIME_BANDS, DASH_BANDS } from '../lib/route-style';

  let collapsed = $state(false);
  // "from your position" once cruising (the clock zeroes at the live fix).
  const live = $derived(app.cruiseActive && !!app.userPosition);
</script>

<section class="bp-legend" class:collapsed aria-label="Route line key">
  <button class="bp-legend-head" onclick={() => (collapsed = !collapsed)} aria-expanded={!collapsed}>
    <span class="bp-legend-title">Route key</span>
    <span class="bp-legend-from">{live ? 'from your position' : 'from start'}</span>
    <span class="bp-legend-caret">{collapsed ? '▸' : '▾'}</span>
  </button>

  {#if !collapsed}
    <div class="bp-legend-body">
      <div class="bp-legend-row">
        <span class="bp-legend-label">Time</span>
        <div class="bp-legend-items">
          {#each TIME_BANDS as b (b.label)}
            <span class="bp-legend-item"><i class="sw" style="background:{b.color}"></i>{b.label}</span>
          {/each}
        </div>
      </div>
      <div class="bp-legend-row">
        <span class="bp-legend-label">Speed</span>
        <div class="bp-legend-items">
          {#each DASH_BANDS as d (d.label)}
            <span class="bp-legend-item">
              <svg class="dash" width="26" height="6" viewBox="0 0 26 6" aria-hidden="true">
                <line x1="1" y1="3" x2="25" y2="3" stroke="var(--text-secondary)" stroke-width="3" stroke-linecap="round" stroke-dasharray={d.dash ?? undefined} />
              </svg>{d.label}
            </span>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .bp-legend {
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: 0.5rem;
    box-shadow: 0 2px 10px rgba(26, 16, 8, 0.18);
    overflow: hidden;
    width: max-content;
    max-width: min(92vw, 30rem);
  }
  .bp-legend-head {
    display: flex; align-items: center; gap: 0.5rem;
    width: 100%; border: none; cursor: pointer;
    background: transparent; padding: 0.45rem 0.6rem;
    font-family: var(--font-mono);
  }
  .bp-legend-title { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); }
  .bp-legend-from { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
  .bp-legend-caret { margin-left: auto; color: var(--text-muted); font-size: 0.7rem; }
  .bp-legend-body { display: flex; flex-direction: column; gap: 0.35rem; padding: 0 0.6rem 0.55rem; }
  .bp-legend-row { display: flex; align-items: center; gap: 0.5rem; }
  .bp-legend-label {
    flex: none; width: 2.8rem;
    font-family: var(--font-mono); font-size: 0.58rem; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--text-muted);
  }
  .bp-legend-items { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem 0.55rem; }
  .bp-legend-item {
    display: inline-flex; align-items: center; gap: 0.28rem;
    font-family: var(--font-mono); font-size: 0.64rem; color: var(--text-secondary);
  }
  .sw { width: 14px; height: 5px; border-radius: 2px; display: inline-block; }
  .dash { display: block; }
</style>
