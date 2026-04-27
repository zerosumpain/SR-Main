<svelte:head>
  <title>Live Walk — Strange Ramblings</title>
  <link rel="stylesheet" href="/vendor/leaflet.min.css" />
  <script src="/vendor/leaflet.min.js"></script>
</svelte:head>

<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

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

  let liveState = $state<LiveState>({ active: false });
  let mapContainer: HTMLDivElement | undefined = $state(undefined);
  let map: any = null;
  let trackLine: any = null;
  let posMarker: any = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let mapInitialized = false;

  let isLive = $derived(liveState.active && liveState.status !== 'finished');

  onMount(async () => {
    await fetchState();
    pollInterval = setInterval(fetchState, 15000);
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
    map?.remove();
  });

  async function fetchState() {
    try {
      const res = await fetch('/api/live-walk');
      if (res.ok) {
        liveState = await res.json();
        if (isLive && !mapInitialized) {
          await tick(); // wait for DOM to update with the map container
          initMap();
        }
        updateMap();
      }
    } catch {}
  }

  function initMap() {
    if (mapInitialized || !mapContainer) return;
    const L = (window as any).L;
    if (!L) return;

    map = L.map(mapContainer).setView([54.0, -2.0], 7);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18
    }).addTo(map);
    mapInitialized = true;
  }

  function updateMap() {
    const L = (window as any).L;
    if (!map || !L || !liveState.track || liveState.track.length === 0) return;

    const latlngs = liveState.track.map((p: any) => [p.lat, p.lng]);

    if (trackLine) trackLine.remove();
    trackLine = L.polyline(latlngs, {
      color: 'var(--accent, #c4570a)',
      weight: 4,
      opacity: 0.9
    }).addTo(map);

    const last = liveState.track[liveState.track.length - 1];
    if (posMarker) posMarker.remove();
    posMarker = L.circleMarker([last.lat, last.lng], {
      radius: 8,
      fillColor: '#4285f4',
      fillOpacity: 1,
      color: '#fff',
      weight: 2
    }).addTo(map);

    if (liveState.track.length <= 5) {
      map.fitBounds(trackLine.getBounds(), { padding: [40, 40] });
    } else {
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
</script>

<PageHeader title="LIVE" />

<div class="live-page">
  {#if !isLive}
    <div class="live-empty">
      <p class="display text-[24px]" style="color: var(--text-primary);">No active walk</p>
      <p class="text-sm mt-2" style="color: var(--text-secondary);">
        When a walk is in progress, it will appear here in realtime.
      </p>
    </div>
  {:else}
    <div class="live-header">
      <div class="live-header-left">
        <div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="live-dot-sm"></span>
            <span class="live-status-label">
              {liveState.status === 'paused' ? 'PAUSED' : 'LIVE'}
            </span>
          </div>
          <h2 class="display text-[18px] mt-1" style="color: var(--text-primary);">{liveState.routeName}</h2>
        </div>
      </div>
    </div>

    <div class="live-map" bind:this={mapContainer}></div>

    <div class="live-stats">
      <div class="live-stat">
        <div class="live-stat-value">{liveState.stats?.distanceKm?.toFixed(2) ?? '0'}<span class="live-stat-unit">km</span></div>
        <div class="live-stat-label">Distance</div>
      </div>
      <div class="live-stat-divider"></div>
      <div class="live-stat">
        <div class="live-stat-value">{liveState.startedAt ? formatElapsed(liveState.startedAt) : '--'}</div>
        <div class="live-stat-label">Elapsed</div>
      </div>
      <div class="live-stat-divider"></div>
      <div class="live-stat">
        <div class="live-stat-value">+{Math.round(liveState.stats?.elevationGainM ?? 0)}<span class="live-stat-unit">m</span></div>
        <div class="live-stat-label">Elevation</div>
      </div>
      <div class="live-stat-divider"></div>
      <div class="live-stat">
        <div class="live-stat-value">{formatPace(liveState.stats?.avgSpeedKmh ?? 0)}</div>
        <div class="live-stat-label">Pace</div>
      </div>
    </div>

    {#if liveState.routeDistanceKm && liveState.routeDistanceKm > 0 && liveState.stats}
      <div class="live-progress">
        <div class="live-progress-bar">
          <div class="live-progress-fill" style="width: {Math.min(100, (liveState.stats.distanceKm / liveState.routeDistanceKm) * 100).toFixed(1)}%"></div>
        </div>
        <div class="live-progress-text">
          {liveState.stats.distanceKm.toFixed(1)} / {liveState.routeDistanceKm.toFixed(1)} km
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
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: var(--font-body);
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
    border-bottom: 1px solid var(--divider);
  }

  .live-header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .live-dot-sm {
    width: 6px;
    height: 6px;
    background: var(--accent);
    border-radius: 50%;
    animation: pulse-live 1.5s ease-in-out infinite;
    box-shadow: 0 0 6px rgba(196, 87, 10, 0.5);
  }

  @keyframes pulse-live {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .live-status-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--accent);
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
    background: var(--bg-section);
    border-top: 1px solid var(--divider);
  }

  .live-stat {
    text-align: center;
  }

  .live-stat-value {
    font-family: var(--font-mono, monospace);
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .live-stat-unit {
    font-size: 11px;
    color: var(--text-secondary);
    margin-left: 1px;
  }

  .live-stat-label {
    font-size: 10px;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 2px;
  }

  .live-stat-divider {
    width: 1px;
    height: 24px;
    background: var(--divider);
  }

  .live-progress {
    padding: 12px 16px;
    background: var(--bg-section);
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
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.5s ease;
  }

  .live-progress-text {
    font-size: 11px;
    color: var(--text-secondary);
    text-align: center;
    font-family: var(--font-mono, monospace);
  }
</style>
