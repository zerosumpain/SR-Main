<svelte:head>
  <title>Live Walk — Strange Ramblings</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
</svelte:head>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface LiveState {
    active: boolean;
    routeName?: string;
    routeType?: 'hike' | 'cycle';
    routeDistanceKm?: number;
    status?: 'active' | 'paused' | 'finished';
    track?: { lat: number; lng: number; timestamp: number }[];
    stats?: {
      distanceKm: number;
      durationMs: number;
      avgSpeedKmh: number;
      elevationGainM: number;
      elevationLossM: number;
    };
    startedAt?: number;
    updatedAt?: number;
  }

  let state = $state<LiveState>({ active: false });
  let mapContainer: HTMLDivElement;
  let map: any = null;
  let trackLine: any = null;
  let posMarker: any = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let L: any = null;

  onMount(async () => {
    // Load Leaflet from CDN — not installed in this project
    L = await new Promise((resolve) => {
      if ((window as any).L) { resolve((window as any).L); return; }
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => resolve((window as any).L);
      document.head.appendChild(script);
    });

    map = L.map(mapContainer).setView([54.0, -2.0], 7);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18
    }).addTo(map);

    await fetchState();
    pollInterval = setInterval(fetchState, 15000); // 15s poll for live page
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
    map?.remove();
  });

  async function fetchState() {
    try {
      const res = await fetch('/api/live-walk');
      if (res.ok) {
        state = await res.json();
        updateMap();
      }
    } catch {}
  }

  function updateMap() {
    if (!map || !L || !state.track || state.track.length === 0) return;

    const latlngs = state.track.map((p: any) => [p.lat, p.lng]);

    // Update track line
    if (trackLine) trackLine.remove();
    trackLine = L.polyline(latlngs, {
      color: '#3db87a',
      weight: 4,
      opacity: 0.9
    }).addTo(map);

    // Update position marker
    const last = state.track[state.track.length - 1];
    if (posMarker) posMarker.remove();
    posMarker = L.circleMarker([last.lat, last.lng], {
      radius: 8,
      fillColor: '#4285f4',
      fillOpacity: 1,
      color: '#fff',
      weight: 2
    }).addTo(map);

    // Fit bounds on first load or if only a few points
    if (state.track.length <= 5) {
      map.fitBounds(trackLine.getBounds(), { padding: [40, 40] });
    } else {
      // Just pan to latest position
      map.panTo([last.lat, last.lng]);
    }
  }

  function formatDuration(ms: number): string {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatElapsed(startedAt: number): string {
    return formatDuration(Date.now() - startedAt);
  }

  function formatPace(speedKmh: number): string {
    if (speedKmh === 0) return '--';
    const paceMinPerKm = 60 / speedKmh;
    const mins = Math.floor(paceMinPerKm);
    const secs = Math.round((paceMinPerKm - mins) * 60);
    return `${mins}:${String(secs).padStart(2, '0')} /km`;
  }

  let lastUpdatedAgo = $derived(state.updatedAt
    ? Math.round((Date.now() - state.updatedAt) / 60000)
    : null);
</script>

<div class="live-page">
  {#if !state.active}
    <div class="live-empty">
      <p class="display text-[24px]" style="color: var(--text-primary);">No active walk</p>
      <p class="text-sm mt-2" style="color: var(--text-secondary);">
        When a walk is in progress, it will appear here in realtime.
      </p>
      <a href="/" class="nav-link mt-4" style="display: inline-block;">&larr; Back to home</a>
    </div>
  {:else}
    <!-- Header -->
    <div class="live-header">
      <div class="live-header-left">
        <a href="/" class="nav-link">&larr;</a>
        <div>
          <div class="flex items-center gap-2">
            <span class="live-dot-sm"></span>
            <span class="live-status-label">
              {state.status === 'paused' ? 'PAUSED' : 'LIVE'}
            </span>
          </div>
          <h1 class="display text-[18px] mt-1" style="color: var(--text-primary);">{state.routeName}</h1>
        </div>
      </div>
      {#if lastUpdatedAgo !== null}
        <span class="text-xs" style="color: var(--text-secondary);">
          Updated {lastUpdatedAgo < 1 ? 'just now' : `${lastUpdatedAgo}m ago`}
        </span>
      {/if}
    </div>

    <!-- Map -->
    <div class="live-map" bind:this={mapContainer}></div>

    <!-- Stats bar -->
    <div class="live-stats">
      <div class="live-stat">
        <div class="live-stat-value">{state.stats?.distanceKm.toFixed(2) ?? '0'}<span class="live-stat-unit">km</span></div>
        <div class="live-stat-label">Distance</div>
      </div>
      <div class="live-stat-divider"></div>
      <div class="live-stat">
        <div class="live-stat-value">{formatElapsed(state.startedAt!)}</div>
        <div class="live-stat-label">Elapsed</div>
      </div>
      <div class="live-stat-divider"></div>
      <div class="live-stat">
        <div class="live-stat-value">+{Math.round(state.stats?.elevationGainM ?? 0)}<span class="live-stat-unit">m</span></div>
        <div class="live-stat-label">Elevation</div>
      </div>
      <div class="live-stat-divider"></div>
      <div class="live-stat">
        <div class="live-stat-value">{formatPace(state.stats?.avgSpeedKmh ?? 0)}</div>
        <div class="live-stat-label">Pace</div>
      </div>
    </div>

    {#if state.routeDistanceKm && state.stats}
      <div class="live-progress">
        <div class="live-progress-bar">
          <div class="live-progress-fill" style="width: {Math.min(100, (state.stats.distanceKm / state.routeDistanceKm) * 100).toFixed(1)}%"></div>
        </div>
        <div class="live-progress-text">
          {state.stats.distanceKm.toFixed(1)} / {state.routeDistanceKm.toFixed(1)} km
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .live-page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background: var(--bg-primary, #0f0f0f);
  }

  .live-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 24px;
  }

  .live-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--divider, rgba(255,255,255,0.08));
  }

  .live-header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .live-dot-sm {
    width: 6px;
    height: 6px;
    background: #3db87a;
    border-radius: 50%;
    animation: pulse-live 1.5s ease-in-out infinite;
    box-shadow: 0 0 6px rgba(61, 184, 122, 0.6);
  }

  @keyframes pulse-live {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .live-status-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: #3db87a;
  }

  .live-map {
    flex: 1;
    min-height: 300px;
  }

  .live-stats {
    display: flex;
    justify-content: space-around;
    align-items: center;
    padding: 16px;
    background: var(--bg-secondary, #161616);
    border-top: 1px solid var(--divider, rgba(255,255,255,0.08));
  }

  .live-stat {
    text-align: center;
  }

  .live-stat-value {
    font-family: 'JetBrains Mono', 'DM Sans', monospace;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary, #e8eaf0);
  }

  .live-stat-unit {
    font-size: 11px;
    color: var(--text-secondary, #888);
    margin-left: 1px;
  }

  .live-stat-label {
    font-size: 10px;
    color: var(--text-secondary, #888);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 2px;
  }

  .live-stat-divider {
    width: 1px;
    height: 24px;
    background: var(--divider, rgba(255,255,255,0.08));
  }

  .live-progress {
    padding: 12px 16px;
    background: var(--bg-secondary, #161616);
  }

  .live-progress-bar {
    height: 4px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 6px;
  }

  .live-progress-fill {
    height: 100%;
    background: #3db87a;
    border-radius: 2px;
    transition: width 0.5s ease;
  }

  .live-progress-text {
    font-size: 11px;
    color: var(--text-secondary, #888);
    text-align: center;
    font-family: 'JetBrains Mono', monospace;
  }
</style>
