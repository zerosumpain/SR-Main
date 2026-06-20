<script lang="ts">
  // Compact map-layer visibility control. Each chip toggles a boolean on the
  // shared store; the dog-friendly filter narrows pubs/walks/attractions to
  // dog-welcome places. Active chips get an accent tint.
  import { app } from '../lib/appState.svelte';

  type LayerKey = keyof typeof app.layers;
  const LAYERS: { key: LayerKey; label: string }[] = [
    { key: 'restrictions', label: 'Restrictions' },
    { key: 'moorings', label: 'Moorings' },
    { key: 'pubs', label: 'Pubs' },
    { key: 'walks', label: 'Walks' },
    { key: 'attractions', label: 'Attractions' },
    { key: 'services', label: 'Services' },
    { key: 'speed', label: 'Speed limits' },
  ];

  function toggle(key: LayerKey) {
    app.layers = { ...app.layers, [key]: !app.layers[key] };
  }

  // Only advertise fuel in the Services hint when we actually have fuel points.
  const hasFuel = $derived((app.data?.pois ?? []).some((p) => p.kind === 'fuel'));
</script>

<section class="layers" aria-label="Map layers">
  <span class="kicker">Layers</span>
  <div class="chips" role="group" aria-label="Toggle map layers">
    {#each LAYERS as l (l.key)}
      <button
        class="chip"
        class:active={app.layers[l.key]}
        aria-pressed={app.layers[l.key]}
        onclick={() => toggle(l.key)}
      >
        {l.label}
      </button>
    {/each}
    <button
      class="chip chip-filter"
      class:active={app.dogOnly}
      aria-pressed={app.dogOnly}
      onclick={() => (app.dogOnly = !app.dogOnly)}
    >
      Dog-friendly only
    </button>
  </div>

  {#if app.layers.speed}
    <div class="legend" aria-label="Speed limit key">
      <span class="legend-label">Speed limit</span>
      <span class="key"><i style="background:#c62828"></i>3</span>
      <span class="key"><i style="background:#e69500"></i>4</span>
      <span class="key"><i style="background:#7cb342"></i>5</span>
      <span class="key"><i style="background:#2e7d32"></i>6+ mph</span>
    </div>
  {/if}
  {#if app.layers.services}
    <p class="hint">{#if hasFuel}<strong class="lc-ic"><svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="4" width="7" height="13" rx="1" /><line x1="4.5" y1="8.5" x2="11.5" y2="8.5" /><path d="M11.5 7h2a1.5 1.5 0 0 1 1.5 1.5V13a1.3 1.3 0 0 0 2.6 0V8l-1.6-2" /></svg></strong> fuel · {/if}<strong>P</strong> pump-out · <strong>W</strong> water · <strong>E</strong> shore power</p>
  {/if}
</section>

<style>
  .layers {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.85rem 1rem;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    color: var(--text-primary);
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
  }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chip {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    min-height: 40px;
    padding: 0.45rem 0.7rem;
    border-radius: var(--radius-round);
    cursor: pointer;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .chip:hover { border-color: var(--text-muted); color: var(--text-primary); }
  .chip.active {
    background: color-mix(in srgb, var(--accent) 16%, var(--surface-elevated));
    border-color: var(--accent);
    color: var(--text-primary);
  }
  .chip-filter { flex-basis: 100%; }
  .chip-filter.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.6rem; }
  .legend-label, .hint { font-family: var(--font-mono); font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
  .key { display: inline-flex; align-items: center; gap: 0.25rem; font-family: var(--font-mono); font-size: 0.68rem; color: var(--text-secondary); }
  .key i { width: 14px; height: 4px; border-radius: 2px; display: inline-block; }
  .hint { margin: 0; line-height: 1.5; }
  .hint strong { color: var(--text-secondary); }
  .hint strong.lc-ic { display: inline-flex; vertical-align: -2px; }
</style>
