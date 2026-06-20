<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { app } from './lib/appState.svelte';
  import { encodePlan, decodePlan } from './lib/permalink';
  import { fmtTime } from './lib/format';
  import BroadsMap from './components/BroadsMap.svelte';
  import PilotSheet from './components/PilotSheet.svelte';
  import PilotHeader from './components/PilotHeader.svelte';
  import BoatSheet from './components/BoatSheet.svelte';
  import LayersControl from './components/LayersControl.svelte';
  import ThemeToggle from './components/ThemeToggle.svelte';
  import Reachability from './components/Reachability.svelte';
  import PlanPanel from './components/PlanPanel.svelte';
  import ItineraryBuilder from './components/ItineraryBuilder.svelte';
  import CruiseBanner from './components/CruiseBanner.svelte';
  import MooringCard from './components/MooringCard.svelte';
  import PoiCard from './components/PoiCard.svelte';
  import RestrictionCallout from './components/RestrictionCallout.svelte';
  import GuideChat from './components/GuideChat.svelte';
  import Logbook from './components/Logbook.svelte';
  import SearchBar from './components/SearchBar.svelte';
  import RouteLegend from './components/RouteLegend.svelte';
  import { logbook } from './lib/logbook.svelte';
  import type { SearchEntry } from './lib/search';
  import type { Selection } from './lib/appState.svelte';

  let mapComp = $state<ReturnType<typeof BroadsMap> | null>(null);
  let sheetSnap = $state<'peek' | 'half' | 'full'>('peek');
  let mapOptionsOpen = $state(false);
  let boatSheetOpen = $state(false);
  let startMenuOpen = $state(false);
  let guideOpen = $state(false);
  let logbookOpen = $state(false);
  let geoBusy = $state(false);
  let watchId: number | null = null;
  let firstFix = true;

  // headline warning count for the ROUTE peek line
  const routeWarnings = $derived.by(() => {
    const r = app.route;
    if (!r) return 0;
    if (!r.edges.length) return 1;
    let n = r.bridges.filter((b) => b.verdict !== 'pass').length;
    if (r.crossesBreydon) n++;
    if (r.time_s * 2 > app.daylightSeconds) n++;
    return n;
  });

  // FABs ride up with the mobile sheet (desktop overrides to a fixed bottom).
  const fabBottomPx = $derived(app.cruiseActive ? 168 : Math.min(app.sheetPx + 14, 520));

  // show the route-line key whenever a route (single or multi-stop) is drawn
  const hasRoute = $derived(!!app.route?.edges.length || app.itineraryLegs.some((l) => l.edges.length > 0));

  // a search pick: open the feature's detail drawer and fly the map to it
  // (flyTo also frees the home-base lock).
  function handleSearchPick(e: SearchEntry) {
    app.select({ kind: e.kind, id: e.id } as Selection);
    mapComp?.flyTo(e.lat, e.lng, 14);
  }

  // Capture the incoming URL params SYNCHRONOUSLY, before any await — the
  // persistence effect below rewrites the URL once data loads, so reading
  // window.location after `await app.load()` would see the stripped query.
  let hydrated = $state(false);

  onMount(async () => {
    const initialParams = new URL(window.location.href).searchParams;
    sheetSnap = window.matchMedia('(max-width: 759px)').matches ? 'peek' : 'half';
    logbook.load();
    await app.load();
    if ([...initialParams.keys()].length) decodePlan(app, initialParams);
    else {
      try { const saved = JSON.parse(localStorage.getItem('broads-pilot') || 'null'); if (saved) app.restore(saved); } catch { /* ignore */ }
    }
    // fall back to the Stalham home base only if nothing was restored — done here
    // (one synchronous pass) so the locked map pins once on the final origin.
    app.ensureDefaultOrigin();
    hydrated = true; // now safe to persist/rewrite the URL
  });

  $effect(() => {
    // wait until the initial restore/decode has run, else this strips the
    // incoming ?from/&to/&stops before decodePlan reads them.
    if (app.loading || !hydrated) return;
    const snap = app.snapshot();
    try { localStorage.setItem('broads-pilot', JSON.stringify(snap)); } catch { /* ignore */ }
    const target = '/projects/broads-pilot' + encodePlan(app);
    if (location.pathname + location.search !== target) history.replaceState(history.state, '', target);
  });

  // when a destination/trip is chosen on mobile, lift the sheet so it's visible
  $effect(() => {
    if ((app.mode === 'route' || app.mode === 'trip') && sheetSnap === 'peek' && window.matchMedia('(max-width: 759px)').matches) sheetSnap = 'half';
  });

  // ensure the GPS watch is cleared (and the logbook finalised) whenever cruise
  // stops — including via the banner's Stop button, which calls app.stopCruise()
  // directly. logbook.stop() is idempotent (guarded on recording), so this is
  // safe alongside the explicit call in stopWatch().
  $effect(() => {
    if (!app.cruiseActive) {
      if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
      if (logbook.recording) logbook.stop();
    }
  });

  function useMyLocation() {
    startMenuOpen = false;
    if (!navigator.geolocation) return;
    geoBusy = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        app.setOrigin(pos.coords.latitude, pos.coords.longitude, 'My location');
        mapComp?.flyTo(pos.coords.latitude, pos.coords.longitude, 14); // centre on it (also unlocks)
        geoBusy = false;
      },
      () => { geoBusy = false; alert('Could not get your location. Tap the map to set your start instead.'); },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  const TIER_LABEL: Record<string, string> = { hire_yard: 'Hire base', yacht_station: 'Yacht station', marina: 'Marina' };

  // Set-start picker actions
  function chooseStart(s: { nodeId: string; name: string; lat: number; lng: number }) {
    app.setOriginNode(s.nodeId, s.name);
    mapComp?.flyTo(s.lat, s.lng, 13);
    startMenuOpen = false;
  }
  function pickOnMap() {
    startMenuOpen = false;
    app.beginPickStart(); // unlocks the map; the next tap sets the start
    sheetSnap = window.matchMedia('(max-width: 759px)').matches ? 'peek' : sheetSnap;
  }

  function toggleCruise() {
    if (app.cruiseActive) { stopWatch(); return; }
    if (!navigator.geolocation) { app.geoError = 'Geolocation is not available on this device.'; app.cruiseActive = true; return; }
    app.startCruise();
    logbook.start(app.boat);
    firstFix = true;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        app.geoError = null;
        app.setUserPosition(pos.coords);
        // use the app's best speed (device-reported, else derived from deltas) so
        // the logbook's top speed matches the live readout.
        logbook.addPoint(pos.coords.latitude, pos.coords.longitude, app.userPosition?.speed ?? pos.coords.speed ?? null);
        if (firstFix) { mapComp?.flyTo(pos.coords.latitude, pos.coords.longitude, 14); firstFix = false; }
      },
      (err) => { app.geoError = err.code === 1 ? 'Location permission denied — enable it to go live.' : 'Waiting for GPS signal…'; },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 },
    );
  }
  function stopWatch() {
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    logbook.stop();
    app.stopCruise();
  }
  onDestroy(stopWatch);

  function applyGuidePlan(stopNodeIds: string[]) {
    app.itinerary = stopNodeIds;
    app.destinationNode = null;
    guideOpen = false;
    sheetSnap = 'half';
    const pts: [number, number][] = [];
    if (app.origin) pts.push([app.origin.lat, app.origin.lng]);
    for (const id of stopNodeIds) { const n = app.data?.graph.nodes.find((x) => x.id === id); if (n) pts.push([n.lat, n.lng]); }
    mapComp?.fitTo(pts);
  }
</script>

<svelte:head>
  <title>Broads Pilot — Norfolk Broads Route Planner</title>
  <meta name="description" content="Plan a Norfolk Broads boating trip: pick your hire boat and see where you can safely reach — true waterway routing, bridge clearances, speed limits, moorings, pubs and dog-friendly walks." />
</svelte:head>

<div class="bp-planner">
  <BroadsMap bind:this={mapComp} />

  <!-- top-centre: feature search + home-base lock (lock hidden in live mode,
       where follow-the-boat owns the camera) -->
  <div class="bp-topbar">
    <SearchBar onPick={handleSearchPick} />
    {#if !app.cruiseActive}
      <button
        class="bp-lock"
        class:locked={app.mapLocked}
        onclick={() => app.toggleLock()}
        aria-pressed={app.mapLocked}
        title={app.mapLocked
          ? `Map pinned on ${app.origin?.label ?? 'home'} — tap to roam freely`
          : `Map free to roam — tap to re-pin on ${app.origin?.label ?? 'home'}`}
      >
        <span class="bp-lock-ic" aria-hidden="true">{app.mapLocked ? '🔒' : '🔓'}</span>
        <span class="bp-lock-lbl">{app.mapLocked ? 'Locked' : 'Free'}</span>
      </button>
    {/if}
  </div>

  <!-- route line key (colour = travel-time band, dash = speed limit) -->
  {#if hasRoute && !app.loading}
    <div class="bp-legend-wrap"><RouteLegend /></div>
  {/if}

  <!-- map options (layers + theme) behind one button, both breakpoints -->
  <div class="bp-mapbtn-wrap">
    <button class="bp-mapbtn" onclick={() => (mapOptionsOpen = !mapOptionsOpen)} aria-expanded={mapOptionsOpen} aria-label="Map options">⚙ Map</button>
    <button class="bp-mapbtn" class:rec={logbook.recording} onclick={() => (logbookOpen = true)} aria-label="Open cruise logbook">
      {#if logbook.recording}<span class="rec-dot"></span>{/if}📖 Log{#if logbook.entries.length}<span class="log-count">{logbook.entries.length}</span>{/if}
    </button>
    {#if mapOptionsOpen}
      <div class="bp-mapopts">
        <ThemeToggle />
        <LayersControl />
      </div>
    {/if}
  </div>

  <!-- floating action stack -->
  <div class="bp-fabs" style:--fab-bottom="{fabBottomPx}px">
    <button class="fab fab-primary" onclick={() => (guideOpen = true)} aria-label="Plan my day with AI">
      <span class="fab-ic">✨</span><span class="fab-lbl">Plan my day</span>
    </button>
    <button class="fab" onclick={useMyLocation} disabled={geoBusy} aria-label="Centre on my location" title="My location">◉</button>
    <button class="fab fab-live" class:on={app.cruiseActive} onclick={toggleCruise} aria-pressed={app.cruiseActive} aria-label={app.cruiseActive ? 'Stop live mode' : 'Go live'} title={app.cruiseActive ? 'Live' : 'Go live'}>
      <span class="live-dot" class:on={app.cruiseActive}></span>
    </button>
  </div>

  {#if app.loading}
    <div class="bp-status">Loading the Broads…</div>
  {:else if app.error}
    <div class="bp-status bp-error">Couldn't load map data: {app.error}</div>
  {/if}

  <!-- LIVE mode: a compact cruise strip, no planning chrome -->
  {#if app.cruiseActive}
    <div class="bp-cruise-strip"><CruiseBanner /></div>
  {:else if !app.loading}
    <!-- the single mode-aware sheet -->
    <PilotSheet bind:snap={sheetSnap}>
      {#snippet header()}
        <PilotHeader onBoat={() => (boatSheetOpen = true)} onStart={() => (startMenuOpen = true)} />
      {/snippet}
      {#snippet summary()}
        {#if app.mode === 'route'}
          <div class="bp-sum">
            <span class="leg">{app.origin?.label ?? 'Start'} → {app.destinationNode ? app.nodeLabel(app.destinationNode) : ''}</span>
            <span class="meta">
              {#if app.route && app.route.edges.length}{fmtTime(app.route.time_s)}{:else}Not reachable{/if}
              {#if routeWarnings > 0}<span class="warn-dot">● {routeWarnings} to check</span>{:else if app.route?.edges.length}<span class="ok-dot">● all clear</span>{/if}
            </span>
          </div>
        {:else if app.mode === 'trip'}
          <div class="bp-sum">
            <span class="leg">Your trip · {app.itinerary.length} stop{app.itinerary.length === 1 ? '' : 's'}</span>
            <span class="meta">
              {#if app.itinerarySummary}{fmtTime(app.itinerarySummary.time_s)} cruising{/if}
              {#if app.itinerarySummary?.blocked || app.itinerarySummary?.overDaylight}<span class="warn-dot">● check warnings</span>{/if}
            </span>
          </div>
        {:else}
          <div class="bp-sum bp-sum-explore">Tap a destination on the map, or ✨ <strong>Plan my day</strong>.</div>
        {/if}
      {/snippet}

      {#if app.mode === 'route'}<PlanPanel />
      {:else if app.mode === 'trip'}<ItineraryBuilder />
      {:else}{#if app.origin && app.boat}<Reachability />{/if}{/if}
    </PilotSheet>
  {/if}

  <!-- start-location picker -->
  {#if startMenuOpen}
    <div class="bp-mini-backdrop" role="presentation" onclick={() => (startMenuOpen = false)}>
      <div class="bp-start-menu" role="dialog" aria-label="Set start location" onclick={(e) => e.stopPropagation()}>
        <header class="bp-start-head">
          <span class="bp-start-kicker">Start location</span>
          <span class="bp-start-cur">Now: <strong>{app.origin?.label ?? 'not set'}</strong></span>
        </header>
        <div class="bp-start-acts">
          <button class="bp-start-act primary" onclick={useMyLocation} disabled={geoBusy}>{geoBusy ? 'Locating…' : '📍 Use my location'}</button>
          <button class="bp-start-act" onclick={pickOnMap}>🗺️ Pick on map</button>
        </div>
        {#if app.startPoints.length}
          <div class="bp-start-listlbl">Boatyards &amp; marinas</div>
          <ul class="bp-start-list">
            {#each app.startPoints as s (s.id)}
              <li>
                <button class="bp-start-row" class:active={s.nodeId === app.origin?.nodeId} onclick={() => chooseStart(s)}>
                  <span class="nm">{s.name}</span>
                  <span class="tier">{TIER_LABEL[s.tier] ?? 'Mooring'}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}

  <!-- pick-a-point hint while arming the start tap -->
  {#if app.pickingStart}
    <div class="bp-pick-hint" role="status">
      <span>Tap the map to set your start</span>
      <button onclick={() => app.cancelPickStart()}>Cancel</button>
    </div>
  {/if}

  <!-- selection drawer -->
  {#if app.selected}
    <div class="bp-drawer">
      {#if app.selected.kind === 'mooring'}<MooringCard onStarted={(lat, lng) => mapComp?.flyTo(lat, lng, 13)} />
      {:else if app.selected.kind === 'poi'}<PoiCard />
      {:else if app.selected.kind === 'bridge' || app.selected.kind === 'lock'}<RestrictionCallout />
      {/if}
    </div>
  {/if}

  <!-- boat sheet (boat + specs + bridge-fit matrix on demand) -->
  {#if boatSheetOpen}<BoatSheet onClose={() => (boatSheetOpen = false)} />{/if}

  <!-- AI day planner -->
  {#if guideOpen}<GuideChat onClose={() => (guideOpen = false)} onApply={applyGuidePlan} />{/if}

  <!-- cruise logbook -->
  {#if logbookOpen}<Logbook onClose={() => (logbookOpen = false)} />{/if}

  <!-- first-run onboarding -->
  {#if !app.loading && !app.onboarded}
    <div class="bp-onboard">
      <div class="bp-onboard-card">
        <p class="bp-kicker">Welcome aboard</p>
        <h2>Plan your Broads trip</h2>
        <ol>
          <li>Tap the <strong>boat chip</strong> to set your boat — its air draft decides which bridges you can pass.</li>
          <li>Your start is <strong>Stalham</strong> (the Richardsons base). Tap the <strong>◉ Start</strong> chip to use your location, choose a boatyard, or pick a point.</li>
          <li>Tap a destination, or hit <strong>✨ Plan my day</strong> to have the AI build an itinerary.</li>
          <li>On the water? Tap <strong>Live</strong> for nearby pubs, moorings &amp; walks as you cruise.</li>
        </ol>
        <button class="bp-go" onclick={() => (app.onboarded = true)}>Start planning</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .bp-planner { position: absolute; inset: 0; overflow: hidden; }
  .bp-status { position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%); z-index: 600; background: var(--surface-elevated); border: 1px solid var(--card-border); border-radius: 0.5rem; padding: 0.8rem 1.2rem; font-family: var(--font-mono); font-size: 0.85rem; color: var(--text-secondary); }

  /* top-centre: search box + home-base lock toggle. Mobile-first = full-width
     bar; desktop centres it in the open map area (see the min-width rule, which
     reserves space for the left sheet + the right map buttons). Kept below the
     600-level FABs/map-options so the search click-away backdrop never blocks them. */
  .bp-topbar { position: absolute; top: 0.6rem; left: 0.6rem; right: 0.6rem; z-index: 550; display: flex; align-items: flex-start; justify-content: center; gap: 0.4rem; }
  .bp-topbar :global(.bp-search) { flex: 1 1 auto; min-width: 0; }
  .bp-lock { flex: none; display: inline-flex; align-items: center; gap: 0.3rem; min-height: 44px; padding: 0 0.6rem; background: var(--surface-elevated); border: 1px solid var(--card-border); border-radius: 0.5rem; cursor: pointer; box-shadow: 0 2px 8px rgba(26, 16, 8, 0.15); font-family: var(--font-mono); font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); }
  .bp-lock.locked { border-color: var(--accent); color: var(--text-primary); background: color-mix(in srgb, var(--accent) 12%, var(--surface-elevated)); }
  .bp-lock-ic { font-size: 0.9rem; }

  /* route key — centred just beneath the search bar */
  .bp-legend-wrap { position: absolute; top: 3.7rem; left: 0.6rem; right: 0.6rem; z-index: 560; display: flex; justify-content: center; }
  .bp-error { color: var(--error, #c62828); }

  /* map options button + popover (top-right) */
  .bp-mapbtn-wrap { position: absolute; top: 0.6rem; right: 0.6rem; z-index: 600; display: flex; flex-direction: column; align-items: flex-end; gap: 0.4rem; }
  .bp-mapbtn { display: inline-flex; align-items: center; gap: 0.35rem; font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; background: var(--surface-elevated); color: var(--text-primary); border: 1px solid var(--card-border); border-radius: 0.45rem; padding: 0.5rem 0.7rem; min-height: 40px; cursor: pointer; box-shadow: 0 2px 8px rgba(26, 16, 8, 0.15); }
  .bp-mapbtn.rec { border-color: #c62828; }
  .bp-mapbtn .rec-dot { width: 8px; height: 8px; border-radius: 50%; background: #c62828; animation: bp-rec 1.3s ease-out infinite; }
  @keyframes bp-rec { 0% { box-shadow: 0 0 0 0 rgba(198, 40, 40, 0.5); } 100% { box-shadow: 0 0 0 6px rgba(198, 40, 40, 0); } }
  .bp-mapbtn .log-count { background: var(--accent); color: #fff; border-radius: 999px; font-size: 0.58rem; padding: 0.05rem 0.35rem; min-width: 1.1rem; text-align: center; }
  .bp-mapopts { display: flex; flex-direction: column; gap: 0.5rem; width: min(88vw, 22rem); }

  /* FAB stack (bottom-right, thumb zone) */
  .bp-fabs { position: absolute; right: 0.7rem; bottom: var(--fab-bottom, 9.8rem); z-index: 600; display: flex; flex-direction: column; gap: 0.6rem; align-items: flex-end; transition: bottom 0.24s cubic-bezier(0.4, 0, 0.2, 1); }
  .fab { display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; background: var(--surface-elevated); color: var(--text-primary); border: 1px solid var(--card-border); border-radius: 999px; min-height: 48px; min-width: 48px; padding: 0 0.85rem; cursor: pointer; box-shadow: 0 3px 12px rgba(26, 16, 8, 0.22); font-family: var(--font-mono); }
  .fab-primary { background: var(--accent); color: #fff; border: none; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
  .fab-primary:hover { background: var(--accent-hover); }
  .fab-ic { font-size: 1rem; }
  .fab:disabled { opacity: 0.6; }
  .fab-live.on { background: #2e7d32; border-color: #2e7d32; }
  .live-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
  .fab-live.on .live-dot { background: #fff; animation: fab-pulse 1.4s ease-out infinite; }
  @keyframes fab-pulse { 0% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7); } 100% { box-shadow: 0 0 0 8px rgba(255, 255, 255, 0); } }

  /* peek summary line */
  .bp-sum { display: flex; flex-direction: column; gap: 0.1rem; }
  .bp-sum .leg { font-family: var(--font-body); font-weight: 600; font-size: 0.92rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bp-sum .meta { font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-muted); display: flex; gap: 0.5rem; align-items: center; }
  .warn-dot { color: var(--warn, #e69500); }
  .ok-dot { color: #2e7d32; }
  .bp-sum-explore { font-family: var(--font-body); font-size: 0.88rem; color: var(--text-secondary); line-height: 1.4; }

  /* cruise strip (live mode) */
  .bp-cruise-strip { position: absolute; left: 0.5rem; right: 0.5rem; bottom: 0.5rem; z-index: 500; }
  @media (min-width: 760px) { .bp-cruise-strip { left: 0.6rem; right: auto; width: 24rem; } }

  /* selection drawer */
  .bp-drawer { position: absolute; z-index: 700; background: var(--surface-elevated); border: 1px solid var(--card-border); box-shadow: 0 6px 24px rgba(26, 16, 8, 0.22); overflow-y: auto; }

  /* mini start menu */
  .bp-mini-backdrop { position: absolute; inset: 0; z-index: 950; background: rgba(26, 16, 8, 0.35); display: grid; place-items: center; padding: 1rem; }

  /* set-start picker */
  .bp-start-menu { background: var(--surface-elevated); border: 1px solid var(--card-border); border-radius: 0.6rem; padding: 1rem; width: min(24rem, 92vw); max-height: min(80vh, 34rem); display: flex; flex-direction: column; gap: 0.6rem; box-shadow: 0 10px 30px rgba(26, 16, 8, 0.3); }
  .bp-start-head { display: flex; flex-direction: column; gap: 0.15rem; }
  .bp-start-kicker { font-family: var(--font-mono); font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.16em; color: var(--accent); }
  .bp-start-cur { font-family: var(--font-body); font-size: 0.82rem; color: var(--text-muted); }
  .bp-start-cur strong { color: var(--text-primary); }
  .bp-start-acts { display: flex; gap: 0.5rem; }
  .bp-start-act { flex: 1; background: var(--card-bg); color: var(--text-primary); border: 1px solid var(--card-border); border-radius: 0.45rem; padding: 0.6rem 0.5rem; font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; cursor: pointer; min-height: 44px; }
  .bp-start-act:hover { border-color: var(--accent); }
  .bp-start-act.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  .bp-start-act:disabled { opacity: 0.6; }
  .bp-start-listlbl { font-family: var(--font-mono); font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); margin-top: 0.2rem; }
  .bp-start-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 0.3rem; }
  .bp-start-row { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.5rem 0.6rem; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 0.4rem; cursor: pointer; text-align: left; color: var(--text-primary); min-height: 42px; }
  .bp-start-row:hover { border-color: var(--text-muted); }
  .bp-start-row.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--surface-elevated)); }
  .bp-start-row .nm { font-family: var(--font-body); font-size: 0.86rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bp-start-row .tier { flex: none; font-family: var(--font-mono); font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }

  /* pick-a-point hint (while arming the start tap) */
  .bp-pick-hint { position: absolute; top: 0.6rem; left: 50%; transform: translateX(-50%); z-index: 620; display: flex; align-items: center; gap: 0.7rem; background: var(--accent); color: #fff; border-radius: 0.5rem; padding: 0.5rem 0.6rem 0.5rem 0.9rem; box-shadow: 0 4px 16px rgba(26, 16, 8, 0.3); font-family: var(--font-mono); font-size: 0.74rem; max-width: calc(100vw - 1.2rem); }
  .bp-pick-hint button { background: rgba(255, 255, 255, 0.2); color: #fff; border: 1px solid rgba(255, 255, 255, 0.5); border-radius: 0.35rem; padding: 0.3rem 0.6rem; font-family: var(--font-mono); font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; }

  /* onboarding */
  .bp-onboard { position: absolute; inset: 0; z-index: 900; display: grid; place-items: center; background: rgba(26, 16, 8, 0.35); padding: 1rem; }
  .bp-onboard-card { background: var(--surface-elevated); border: 1px solid var(--card-border); border-radius: 0.6rem; padding: 1.4rem; max-width: 27rem; }
  .bp-kicker { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.2em; font-size: 0.6rem; color: var(--accent); margin: 0 0 0.3rem; }
  .bp-onboard-card h2 { font-family: var(--font-display); text-transform: uppercase; font-size: 1.2rem; color: var(--text-primary); margin: 0 0 0.8rem; }
  .bp-onboard-card ol { margin: 0 0 1rem; padding-left: 1.2rem; }
  .bp-onboard-card li { font-family: var(--font-body); color: var(--text-secondary); line-height: 1.5; font-size: 0.9rem; margin: 0.35rem 0; }
  .bp-onboard-card strong { color: var(--text-primary); }
  .bp-go { background: var(--accent); color: #fff; border: none; border-radius: 0.4rem; padding: 0.55rem 1rem; font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.78rem; cursor: pointer; }

  @media (min-width: 760px) {
    .bp-drawer { top: 0.6rem; right: 0.6rem; width: 23rem; max-height: calc(100% - 1.2rem); border-radius: 0.6rem; }
    .bp-fabs { bottom: 0.9rem; }
    .bp-mapopts { width: 22rem; }
    /* centre the search/legend in the open map area: clear the left docked sheet
       (~23.6rem) and the right map-buttons stack (~10rem) so neither overlaps. */
    .bp-topbar { left: 24.2rem; right: 11rem; }
    .bp-topbar :global(.bp-search) { flex: 0 1 26rem; }
    .bp-legend-wrap { left: 24.2rem; right: 11rem; }
  }
  @media (max-width: 759px) {
    .bp-drawer { left: 0; right: 0; bottom: 0; max-height: 72vh; border-radius: 0.7rem 0.7rem 0 0; z-index: 800; }
    /* clear the top-right ⚙MAP / 📖LOG button stack so the search doesn't run
       under it; drop the route key below that stack. */
    .bp-topbar { right: 5.6rem; }
    .bp-legend-wrap { top: 6.6rem; }
  }
</style>
