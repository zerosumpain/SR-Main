<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './lib/appState.svelte';
  import { encodePlan, decodePlan } from './lib/permalink';
  import BroadsMap from './components/BroadsMap.svelte';
  import BoatPicker from './components/BoatPicker.svelte';
  import SafetyBanner from './components/SafetyBanner.svelte';
  import LayersControl from './components/LayersControl.svelte';
  import ThemeToggle from './components/ThemeToggle.svelte';
  import Reachability from './components/Reachability.svelte';
  import PlanPanel from './components/PlanPanel.svelte';
  import ItineraryBuilder from './components/ItineraryBuilder.svelte';
  import MooringCard from './components/MooringCard.svelte';
  import PoiCard from './components/PoiCard.svelte';
  import RestrictionCallout from './components/RestrictionCallout.svelte';

  let mapComp = $state<ReturnType<typeof BroadsMap> | null>(null);
  let panelOpen = $state(true);
  let geoBusy = $state(false);

  onMount(async () => {
    await app.load();
    const url = new URL(window.location.href);
    if ([...url.searchParams.keys()].length) {
      decodePlan(app, url.searchParams);
    } else {
      try {
        const saved = JSON.parse(localStorage.getItem('broads-pilot') || 'null');
        if (saved) app.restore(saved);
      } catch { /* ignore */ }
    }
  });

  // Persist to localStorage + keep the shareable URL in sync.
  $effect(() => {
    if (app.loading) return;
    const snap = app.snapshot();
    try { localStorage.setItem('broads-pilot', JSON.stringify(snap)); } catch { /* ignore */ }
    const target = '/projects/broads-pilot' + encodePlan(app);
    if (location.pathname + location.search !== target) history.replaceState(history.state, '', target);
  });

  function useMyLocation() {
    if (!navigator.geolocation) return;
    geoBusy = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => { app.setOrigin(pos.coords.latitude, pos.coords.longitude, 'My location'); geoBusy = false; },
      () => { geoBusy = false; alert('Could not get your location. Tap the map to set your start instead.'); },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function dismissOnboarding() { app.onboarded = true; }
</script>

<svelte:head>
  <title>Broads Pilot — Norfolk Broads Route Planner</title>
  <meta name="description" content="Plan a Norfolk Broads boating trip: pick your hire boat and see where you can safely reach — true waterway routing, bridge clearances, speed limits, moorings, pubs and dog-friendly walks." />
</svelte:head>

<div class="bp-planner">
  <BroadsMap bind:this={mapComp} />

  <SafetyBanner />

  {#if app.loading}
    <div class="bp-status">Loading the Broads…</div>
  {:else if app.error}
    <div class="bp-status bp-error">Couldn't load map data: {app.error}</div>
  {/if}

  <!-- top-right controls -->
  <div class="bp-controls">
    <ThemeToggle />
    <LayersControl />
  </div>

  <!-- left / bottom panel -->
  <div class="bp-panel" class:open={panelOpen}>
    <button class="bp-panel-handle" onclick={() => (panelOpen = !panelOpen)} aria-label="Toggle panel">
      {panelOpen ? '▾' : '▴'} Plan
    </button>
    {#if panelOpen}
      <div class="bp-panel-body">
        <BoatPicker />
        <div class="bp-origin-row">
          <button class="bp-loc-btn" onclick={useMyLocation} disabled={geoBusy}>
            {geoBusy ? 'Locating…' : '◉ Use my location'}
          </button>
          {#if app.origin}<span class="bp-origin-label">{app.origin.label}</span>{:else}<span class="bp-hint">or tap the map to set your start</span>{/if}
        </div>
        {#if app.route}<PlanPanel />{/if}
        {#if app.itinerary.length}<ItineraryBuilder />{/if}
        {#if app.origin && app.boat}<Reachability />{/if}
      </div>
    {/if}
  </div>

  <!-- selection drawer -->
  {#if app.selected}
    <div class="bp-drawer">
      {#if app.selected.kind === 'mooring'}<MooringCard />
      {:else if app.selected.kind === 'poi'}<PoiCard />
      {:else if app.selected.kind === 'bridge' || app.selected.kind === 'lock'}<RestrictionCallout />
      {/if}
    </div>
  {/if}

  <!-- first-run onboarding -->
  {#if !app.loading && !app.onboarded}
    <div class="bp-onboard">
      <div class="bp-onboard-card">
        <p class="bp-kicker">Welcome aboard</p>
        <h2>Plan your Broads trip</h2>
        <ol>
          <li><strong>Pick your boat</strong> — its air draft decides which bridges you can pass.</li>
          <li><strong>Set your start</strong> — use your location or tap the map (try Stalham, the Richardsons base).</li>
          <li><strong>Tap a destination</strong> — see the route, time, fuel and every bridge en route.</li>
        </ol>
        <button class="bp-go" onclick={dismissOnboarding}>Start planning</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .bp-planner { position: absolute; inset: 0; overflow: hidden; }

  .bp-status { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 600; background: var(--surface-elevated); border: 1px solid var(--card-border); border-radius: 0.5rem; padding: 0.8rem 1.2rem; font-family: var(--font-mono); font-size: 0.85rem; color: var(--text-secondary); }
  .bp-error { color: var(--error, #c62828); }

  .bp-controls { position: absolute; top: 0.6rem; right: 0.6rem; z-index: 500; display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-end; max-width: 60vw; }

  .bp-panel { position: absolute; z-index: 500; background: var(--surface-elevated); border: 1px solid var(--card-border); box-shadow: 0 6px 24px rgba(26, 16, 8, 0.18); }
  .bp-panel-handle { width: 100%; border: none; background: var(--accent); color: #fff; font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.1em; font-size: 0.7rem; padding: 0.5rem; cursor: pointer; text-align: left; }
  .bp-panel-body { overflow-y: auto; padding: 0.7rem; display: flex; flex-direction: column; gap: 0.7rem; }

  .bp-origin-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .bp-loc-btn { background: var(--accent); color: #fff; border: none; border-radius: 0.4rem; padding: 0.45rem 0.7rem; font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; cursor: pointer; }
  .bp-loc-btn:disabled { opacity: 0.6; }
  .bp-origin-label { font-family: var(--font-mono); font-size: 0.75rem; color: var(--accent); }
  .bp-hint { font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-muted); }

  .bp-drawer { position: absolute; z-index: 700; background: var(--surface-elevated); border: 1px solid var(--card-border); box-shadow: 0 6px 24px rgba(26, 16, 8, 0.22); overflow-y: auto; }

  .bp-onboard { position: absolute; inset: 0; z-index: 900; display: grid; place-items: center; background: rgba(26, 16, 8, 0.35); padding: 1rem; }
  .bp-onboard-card { background: var(--surface-elevated); border: 1px solid var(--card-border); border-radius: 0.6rem; padding: 1.4rem; max-width: 26rem; }
  .bp-kicker { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.2em; font-size: 0.6rem; color: var(--accent); margin: 0 0 0.3rem; }
  .bp-onboard-card h2 { font-family: var(--font-display); text-transform: uppercase; font-size: 1.2rem; color: var(--text-primary); margin: 0 0 0.8rem; }
  .bp-onboard-card ol { margin: 0 0 1rem; padding-left: 1.2rem; }
  .bp-onboard-card li { font-family: var(--font-body); color: var(--text-secondary); line-height: 1.5; font-size: 0.9rem; margin: 0.35rem 0; }
  .bp-onboard-card strong { color: var(--text-primary); }
  .bp-go { background: var(--accent); color: #fff; border: none; border-radius: 0.4rem; padding: 0.55rem 1rem; font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.78rem; cursor: pointer; }

  /* desktop: panel left column, drawer right column */
  @media (min-width: 760px) {
    .bp-panel { top: 0.6rem; left: 0.6rem; width: 22rem; max-height: calc(100% - 1.2rem); border-radius: 0.6rem; display: flex; flex-direction: column; }
    .bp-panel-handle { border-radius: 0.6rem 0.6rem 0 0; }
    .bp-panel-body { max-height: calc(100vh - 8rem); }
    .bp-drawer { top: 0.6rem; right: 0.6rem; width: 23rem; max-height: calc(100% - 1.2rem); border-radius: 0.6rem; }
  }
  /* mobile: panel + drawer as bottom sheets */
  @media (max-width: 759px) {
    .bp-panel { left: 0; right: 0; bottom: 0; max-height: 58vh; border-radius: 0.6rem 0.6rem 0 0; display: flex; flex-direction: column; }
    .bp-panel-body { max-height: calc(58vh - 2.2rem); }
    .bp-drawer { left: 0; right: 0; bottom: 0; max-height: 70vh; border-radius: 0.6rem 0.6rem 0 0; }
    .bp-controls { top: 0.5rem; right: 0.5rem; }
  }
</style>
