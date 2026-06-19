<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { app } from './lib/appState.svelte';
  import { encodePlan, decodePlan } from './lib/permalink';
  import BroadsMap from './components/BroadsMap.svelte';
  import BoatPicker from './components/BoatPicker.svelte';
  import SafetyBanner from './components/SafetyBanner.svelte';
  import CruiseBanner from './components/CruiseBanner.svelte';
  import LayersControl from './components/LayersControl.svelte';
  import ThemeToggle from './components/ThemeToggle.svelte';
  import Reachability from './components/Reachability.svelte';
  import PlanPanel from './components/PlanPanel.svelte';
  import ItineraryBuilder from './components/ItineraryBuilder.svelte';
  import MooringCard from './components/MooringCard.svelte';
  import PoiCard from './components/PoiCard.svelte';
  import RestrictionCallout from './components/RestrictionCallout.svelte';
  import GuideChat from './components/GuideChat.svelte';

  let mapComp = $state<ReturnType<typeof BroadsMap> | null>(null);
  let panelOpen = $state(false);
  let controlsOpen = $state(false);
  let guideOpen = $state(false);
  let geoBusy = $state(false);
  let watchId: number | null = null;
  let firstFix = true;

  function applyGuidePlan(stopNodeIds: string[]) {
    app.itinerary = stopNodeIds;
    app.destinationNode = null;
    guideOpen = false;
    panelOpen = true;
    // fit the map to the origin + all stops
    const pts: [number, number][] = [];
    if (app.origin) pts.push([app.origin.lat, app.origin.lng]);
    for (const id of stopNodeIds) {
      const n = app.data?.graph.nodes.find((x) => x.id === id);
      if (n) pts.push([n.lat, n.lng]);
    }
    mapComp?.fitTo(pts);
  }

  onMount(async () => {
    panelOpen = !window.matchMedia('(max-width: 759px)').matches; // open on desktop, collapsed on phones
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

  // Live "cruise" mode — continuously watch position so we can pop up nearby
  // attractions when on the Broads + moving.
  function toggleCruise() {
    if (app.cruiseActive) { stopWatch(); return; }
    if (!navigator.geolocation) { app.geoError = 'Geolocation is not available on this device.'; app.cruiseActive = true; return; }
    app.startCruise();
    firstFix = true;
    panelOpen = false; // clear the map
    controlsOpen = false;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        app.geoError = null;
        app.setUserPosition(pos.coords);
        if (firstFix) { mapComp?.flyTo(pos.coords.latitude, pos.coords.longitude, 14); firstFix = false; }
      },
      (err) => { app.geoError = err.code === 1 ? 'Location permission denied — enable it to go live.' : 'Waiting for GPS signal…'; },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 },
    );
  }
  function stopWatch() {
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    app.stopCruise();
  }
  onDestroy(stopWatch);
</script>

<svelte:head>
  <title>Broads Pilot — Norfolk Broads Route Planner</title>
  <meta name="description" content="Plan a Norfolk Broads boating trip: pick your hire boat and see where you can safely reach — true waterway routing, bridge clearances, speed limits, moorings, pubs and dog-friendly walks." />
</svelte:head>

<div class="bp-planner">
  <BroadsMap bind:this={mapComp} />

  <!-- top overlay: tools row + a banner slot (cruise companion or safety note) -->
  <div class="bp-top">
    <div class="bp-top-row">
      <button class="bp-ai-btn" onclick={() => (guideOpen = true)}>✨ Plan my day</button>
      <div class="bp-tools">
        <button class="bp-live-btn" class:on={app.cruiseActive} onclick={toggleCruise}
          aria-pressed={app.cruiseActive}>
          <span class="bp-live-dot" class:on={app.cruiseActive}></span>{app.cruiseActive ? 'Live' : 'Go live'}
        </button>
        <div class="bp-controls-wrap">
          <button class="bp-options-btn" onclick={() => (controlsOpen = !controlsOpen)} aria-expanded={controlsOpen}>⚙ Map</button>
          <div class="bp-controls-pop" class:open={controlsOpen}>
            <ThemeToggle />
            <LayersControl />
          </div>
        </div>
      </div>
    </div>
    <div class="bp-banner-slot">
      {#if app.cruiseActive}<CruiseBanner />{:else}<SafetyBanner />{/if}
    </div>
  </div>

  {#if app.loading}
    <div class="bp-status">Loading the Broads…</div>
  {:else if app.error}
    <div class="bp-status bp-error">Couldn't load map data: {app.error}</div>
  {/if}

  <!-- left / bottom planning panel -->
  <div class="bp-panel" class:open={panelOpen}>
    <button class="bp-panel-handle" onclick={() => (panelOpen = !panelOpen)} aria-expanded={panelOpen}>
      {panelOpen ? '▾' : '▴'} Plan your trip
    </button>
    {#if panelOpen}
      <div class="bp-panel-body">
        <BoatPicker />
        <div class="bp-origin-row">
          <button class="bp-loc-btn" onclick={useMyLocation} disabled={geoBusy}>
            {geoBusy ? 'Locating…' : '◉ Set start to my location'}
          </button>
          {#if app.origin}<span class="bp-origin-label">{app.origin.label}</span>{:else}<span class="bp-hint">or tap the map</span>{/if}
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

  <!-- AI day planner -->
  {#if guideOpen}
    <GuideChat onClose={() => (guideOpen = false)} onApply={applyGuidePlan} />
  {/if}

  <!-- first-run onboarding -->
  {#if !app.loading && !app.onboarded}
    <div class="bp-onboard">
      <div class="bp-onboard-card">
        <p class="bp-kicker">Welcome aboard</p>
        <h2>Plan your Broads trip</h2>
        <ol>
          <li><strong>Pick your boat</strong> — its air draft decides which bridges you can pass.</li>
          <li><strong>Your start is set to Stalham</strong> (the Richardsons base) — tap the map or "my location" to change it.</li>
          <li><strong>Tap a destination</strong> — see the route, time, fuel and every bridge en route.</li>
          <li><strong>On the water?</strong> Tap <em>Go live</em> for nearby pubs, moorings &amp; walks as you cruise.</li>
        </ol>
        <button class="bp-go" onclick={() => (app.onboarded = true)}>Start planning</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .bp-planner { position: absolute; inset: 0; overflow: hidden; }

  .bp-status { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 600; background: var(--surface-elevated); border: 1px solid var(--card-border); border-radius: 0.5rem; padding: 0.8rem 1.2rem; font-family: var(--font-mono); font-size: 0.85rem; color: var(--text-secondary); }
  .bp-error { color: var(--error, #c62828); }

  /* top overlay */
  .bp-top { position: absolute; top: 0; left: 0; right: 0; z-index: 500; padding: 0.55rem; display: flex; flex-direction: column; gap: 0.5rem; pointer-events: none; }
  .bp-top > * { pointer-events: auto; }
  .bp-top-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; }
  .bp-tools { display: flex; gap: 0.5rem; align-items: flex-start; }
  .bp-ai-btn { display: inline-flex; align-items: center; gap: 0.35rem; font-family: var(--font-mono); font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; background: var(--accent); color: #fff; border: none; border-radius: 0.45rem; padding: 0.55rem 0.8rem; min-height: 40px; cursor: pointer; box-shadow: 0 2px 10px rgba(196, 87, 10, 0.4); }
  .bp-ai-btn:hover { background: var(--accent-hover); }
  .bp-live-btn { display: inline-flex; align-items: center; gap: 0.4rem; font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; background: var(--surface-elevated); color: var(--text-primary); border: 1px solid var(--card-border); border-radius: 0.45rem; padding: 0.5rem 0.7rem; min-height: 40px; cursor: pointer; box-shadow: 0 2px 8px rgba(26, 16, 8, 0.15); }
  .bp-live-btn.on { background: #2e7d32; color: #fff; border-color: #2e7d32; }
  .bp-live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
  .bp-live-btn.on .bp-live-dot { background: #fff; animation: live-pulse 1.4s ease-out infinite; }
  @keyframes live-pulse { 0% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7); } 100% { box-shadow: 0 0 0 7px rgba(255, 255, 255, 0); } }

  .bp-controls-wrap { position: relative; }
  .bp-options-btn { display: none; font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; background: var(--surface-elevated); color: var(--text-primary); border: 1px solid var(--card-border); border-radius: 0.45rem; padding: 0.5rem 0.7rem; min-height: 40px; cursor: pointer; box-shadow: 0 2px 8px rgba(26, 16, 8, 0.15); }
  .bp-controls-pop { display: flex; flex-direction: column; gap: 0.5rem; }

  .bp-banner-slot { max-width: 38rem; margin-left: auto; }

  /* planning panel */
  .bp-panel { position: absolute; z-index: 450; background: var(--surface-elevated); border: 1px solid var(--card-border); box-shadow: 0 6px 24px rgba(26, 16, 8, 0.18); }
  .bp-panel-handle { width: 100%; border: none; background: var(--accent); color: #fff; font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.1em; font-size: 0.72rem; padding: 0.6rem; cursor: pointer; text-align: left; }
  .bp-panel-body { overflow-y: auto; padding: 0.7rem; display: flex; flex-direction: column; gap: 0.7rem; }

  .bp-origin-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .bp-loc-btn { background: var(--accent); color: #fff; border: none; border-radius: 0.4rem; padding: 0.5rem 0.7rem; font-family: var(--font-mono); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; min-height: 40px; }
  .bp-loc-btn:disabled { opacity: 0.6; }
  .bp-origin-label { font-family: var(--font-mono); font-size: 0.75rem; color: var(--accent); }
  .bp-hint { font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-muted); }

  .bp-drawer { position: absolute; z-index: 700; background: var(--surface-elevated); border: 1px solid var(--card-border); box-shadow: 0 6px 24px rgba(26, 16, 8, 0.22); overflow-y: auto; }

  .bp-onboard { position: absolute; inset: 0; z-index: 900; display: grid; place-items: center; background: rgba(26, 16, 8, 0.35); padding: 1rem; }
  .bp-onboard-card { background: var(--surface-elevated); border: 1px solid var(--card-border); border-radius: 0.6rem; padding: 1.4rem; max-width: 27rem; }
  .bp-kicker { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.2em; font-size: 0.6rem; color: var(--accent); margin: 0 0 0.3rem; }
  .bp-onboard-card h2 { font-family: var(--font-display); text-transform: uppercase; font-size: 1.2rem; color: var(--text-primary); margin: 0 0 0.8rem; }
  .bp-onboard-card ol { margin: 0 0 1rem; padding-left: 1.2rem; }
  .bp-onboard-card li { font-family: var(--font-body); color: var(--text-secondary); line-height: 1.5; font-size: 0.9rem; margin: 0.35rem 0; }
  .bp-onboard-card strong { color: var(--text-primary); }
  .bp-go { background: var(--accent); color: #fff; border: none; border-radius: 0.4rem; padding: 0.55rem 1rem; font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.78rem; cursor: pointer; }

  /* desktop: panel left column, drawer right column, controls always visible */
  @media (min-width: 760px) {
    .bp-panel { top: 0.6rem; left: 0.6rem; width: 22rem; max-height: calc(100% - 1.2rem); border-radius: 0.6rem; display: flex; flex-direction: column; }
    .bp-panel-handle { border-radius: 0.6rem 0.6rem 0 0; }
    .bp-panel-body { max-height: calc(100vh - 9rem); }
    .bp-drawer { top: 0.6rem; right: 0.6rem; width: 23rem; max-height: calc(100% - 1.2rem); border-radius: 0.6rem; }
    .bp-banner-slot { max-width: 34rem; }
  }
  /* mobile: panel + drawer as bottom sheets; controls collapse behind a button */
  @media (max-width: 759px) {
    .bp-panel { left: 0; right: 0; bottom: 0; max-height: 60vh; border-radius: 0.7rem 0.7rem 0 0; display: flex; flex-direction: column; }
    .bp-panel:not(.open) { width: auto; }
    .bp-panel-body { max-height: calc(60vh - 2.4rem); }
    .bp-drawer { left: 0; right: 0; bottom: 0; max-height: 72vh; border-radius: 0.7rem 0.7rem 0 0; }
    .bp-options-btn { display: inline-flex; align-items: center; }
    .bp-controls-pop { display: none; position: absolute; right: 0; top: calc(100% + 0.4rem); width: min(86vw, 22rem); }
    .bp-controls-pop.open { display: flex; }
    .bp-banner-slot { max-width: none; margin-left: 0; }
  }
</style>
