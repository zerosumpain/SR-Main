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
  ];

  function toggle(key: LayerKey) {
    app.layers = { ...app.layers, [key]: !app.layers[key] };
  }
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
</section>

<style>
  .layers {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.85rem 1rem;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: 0.6rem;
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
    border-radius: 0.4rem;
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
</style>
