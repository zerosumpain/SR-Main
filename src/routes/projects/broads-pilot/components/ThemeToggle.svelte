<script lang="ts">
  // Two segmented controls: map theme (Warm | Nautical) and distance units
  // (mi/ft | km/m). Each segment writes straight to the shared store; the
  // active segment gets an accent fill.
  import { app } from '../lib/appState.svelte';
  import type { Units } from '../lib/format';

  const THEMES: { value: 'warm' | 'nautical' | 'schematic'; label: string }[] = [
    { value: 'warm', label: 'Warm' },
    { value: 'nautical', label: 'Nautical' },
    { value: 'schematic', label: 'Schematic' },
  ];
  const UNITS: { value: Units; label: string }[] = [
    { value: 'imperial', label: 'mi / ft' },
    { value: 'metric', label: 'km / m' },
  ];
</script>

<section class="theme" aria-label="Display preferences">
  <div class="control">
    <span class="kicker">Map theme</span>
    <div class="seg" role="group" aria-label="Map theme">
      {#each THEMES as t (t.value)}
        <button
          class="seg-btn"
          class:active={app.mapTheme === t.value}
          aria-pressed={app.mapTheme === t.value}
          onclick={() => (app.mapTheme = t.value)}
        >
          {t.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="control">
    <span class="kicker">Units</span>
    <div class="seg" role="group" aria-label="Distance units">
      {#each UNITS as u (u.value)}
        <button
          class="seg-btn"
          class:active={app.units === u.value}
          aria-pressed={app.units === u.value}
          onclick={() => (app.units = u.value)}
        >
          {u.label}
        </button>
      {/each}
    </div>
  </div>
</section>

<style>
  .theme {
    display: flex;
    flex-wrap: wrap;
    gap: 0.85rem 1.4rem;
    padding: 0.85rem 1rem;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    color: var(--text-primary);
  }
  .control { display: flex; flex-direction: column; gap: 0.4rem; }
  .kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
  }
  .seg {
    display: inline-flex;
    flex-wrap: wrap;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    overflow: hidden;
    background: var(--card-bg);
  }
  .seg-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    min-height: 40px;
    padding: 0.45rem 0.85rem;
    cursor: pointer;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .seg-btn + .seg-btn { border-left: 1px solid var(--card-border); }
  .seg-btn:hover { color: var(--text-primary); }
  .seg-btn.active {
    background: var(--accent);
    color: #fff;
  }
</style>
