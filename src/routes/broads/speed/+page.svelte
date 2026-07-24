<script lang="ts">
  import { onMount } from 'svelte';

  let data: any = null;
  let loading = true;
  let error = '';

  // Broads bounding box
  const BBOX = { minLat: 52.45, maxLat: 52.79, minLng: 1.28, maxLng: 1.78 };
  const CENTER: [number, number] = [52.62, 1.53];
  const ZOOM = 12;

  let map: any = null;
  let routeLine: any = null;
  let currentMarker: any = null;
  let mapContainer: HTMLDivElement;

  // Speed chart data
  let chartCanvas: HTMLCanvasElement;

  const BROADS_PLACES: Array<{ name: string; lat: number; lng: number }> = [
    { name: 'Wroxham', lat: 52.7114, lng: 1.4081 },
    { name: 'Horning', lat: 52.704, lng: 1.464 },
    { name: 'Potter Heigham', lat: 52.714, lng: 1.584 },
    { name: 'Ludham', lat: 52.714, lng: 1.537 },
    { name: 'Ranworth', lat: 52.681, lng: 1.486 },
    { name: 'Acle', lat: 52.64, lng: 1.554 },
    { name: 'Thurne', lat: 52.687, lng: 1.555 },
    { name: 'Reedham', lat: 52.56, lng: 1.573 },
    { name: 'Norwich YS', lat: 52.63, lng: 1.3 },
  ];

  onMount(() => {
    initMap();
    fetchData();
    setInterval(fetchData, 30_000);
  });

  async function fetchData() {
    try {
      const res = await fetch('/api/broads/current');
      const json = await res.json();
      if (json.success) {
        data = json.data;
        error = '';
        updateMap();
        updateChart();
      } else {
        error = json.error || 'Failed to load';
      }
    } catch (e: any) {
      error = e.message || 'Network error';
    } finally {
      loading = false;
    }
  }

  function initMap() {
    if (!mapContainer) return;
    // @ts-ignore
    const L = (window as any).L;
    if (!L) return;

    map = L.map(mapContainer, {
      center: CENTER,
      zoom: ZOOM,
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    // Draw geofence
    L.rectangle(
      [[BBOX.minLat, BBOX.minLng], [BBOX.maxLat, BBOX.maxLng]],
      {
        color: '#c4570a',
        weight: 1,
        fill: false,
        dashArray: '4 6',
        opacity: 0.5,
      }
    ).addTo(map);

    // Broads landmarks
    BROADS_PLACES.forEach((p) => {
      L.circleMarker([p.lat, p.lng], {
        radius: 2,
        color: 'rgba(26,16,8,0.3)',
        weight: 1,
      }).addTo(map);
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: 'place-label',
          html: p.name,
          iconSize: [0, 0],
        }),
      }).addTo(map);
    });

    // Initial route line (empty)
    routeLine = L.polyline([], {
      color: '#c4570a',
      weight: 3,
      opacity: 0.8,
    }).addTo(map);

    // Current position marker
    currentMarker = L.circleMarker([0, 0], {
      radius: 7,
      color: '#c4570a',
      fillColor: '#c4570a',
      fillOpacity: 1,
      weight: 2,
    }).addTo(map);
  }

  function updateMap() {
    if (!map || !data) return;
    // @ts-ignore
    const L = (window as any).L;
    if (!L) return;

    const active = data.activeJourney;
    const samples = active?.samples || [];

    // Build route from samples that have lat/lng
    const routePoints: Array<[number, number]> = [];
    for (const s of samples) {
      if (s.lat && s.lng) {
        routePoints.push([s.lat, s.lng]);
      }
    }

    if (routeLine) {
      routeLine.setLatLngs(routePoints);
    }

    // Update current position
    if (data.currentPosition) {
      currentMarker.setLatLng([data.currentPosition.lat, data.currentPosition.lng]);
      currentMarker.setStyle({
        radius: 7,
        color: '#c4570a',
        fillColor: '#c4570a',
        fillOpacity: 1,
      });
    }

    // Fit bounds to route if there are points
    if (routePoints.length > 1) {
      const bounds = L.latLngBounds(routePoints);
      map.fitBounds(bounds.pad(0.2));
    } else if (data.currentPosition) {
      map.setView([data.currentPosition.lat, data.currentPosition.lng], map.getZoom());
    }
  }

  function updateChart() {
    if (!chartCanvas || !data) return;
    const active = data.activeJourney;
    const samples = active?.samples || [];
    if (samples.length < 2) return;

    const ctx = chartCanvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = chartCanvas.getBoundingClientRect();
    chartCanvas.width = rect.width * dpr;
    chartCanvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const pad = { top: 20, right: 20, bottom: 30, left: 45 };

    ctx.clearRect(0, 0, w, h);

    const mphs = samples.map((s: any) => s.mph);
    const maxMph = Math.max(...mphs, 1);
    const minMph = Math.min(...mphs, 0);
    const range = Math.max(maxMph - minMph, 1);

    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    function x(i: number) { return pad.left + (i / (samples.length - 1)) * plotW; }
    function y(v: number) { return pad.top + plotH - ((v - minMph) / range) * plotH; }

    // Grid lines
    ctx.strokeStyle = 'rgba(26,16,8,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gy = pad.top + (i / 4) * plotH;
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(w - pad.right, gy);
      ctx.stroke();
      // Labels
      const val = maxMph - (i / 4) * range;
      ctx.fillStyle = 'rgba(26,16,8,0.45)';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(1), pad.left - 4, gy + 4);
    }

    // Area fill
    ctx.beginPath();
    ctx.moveTo(x(0), y(mphs[0]));
    for (let i = 1; i < samples.length; i++) {
      ctx.lineTo(x(i), y(mphs[i]));
    }
    ctx.lineTo(x(samples.length - 1), pad.top + plotH);
    ctx.lineTo(x(0), pad.top + plotH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(196,87,10,0.12)';
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(x(0), y(mphs[0]));
    for (let i = 1; i < samples.length; i++) {
      ctx.lineTo(x(i), y(mphs[i]));
    }
    ctx.strokeStyle = '#c4570a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dots
    for (let i = 0; i < samples.length; i++) {
      ctx.beginPath();
      ctx.arc(x(i), y(mphs[i]), 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#c4570a';
      ctx.fill();
    }

    // X-axis time labels
    ctx.fillStyle = 'rgba(26,16,8,0.45)';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    const labelCount = Math.min(6, samples.length);
    const step = Math.max(1, Math.floor(samples.length / labelCount));
    for (let i = 0; i < samples.length; i += step) {
      const t = new Date(samples[i].ts);
      const label = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      ctx.fillText(label, x(i), h - 6);
    }

    // Y-axis label
    ctx.save();
    ctx.translate(10, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(26,16,8,0.45)';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('mph', 0, 0);
    ctx.restore();
  }

  function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }

  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m ago`;
  }

  $: active = data?.activeJourney;
  $: past = data?.recentJourneys || [];
  $: pos = data?.currentPosition;
</script>

<svelte:head>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" />
  <title>Broads Speed — sr.</title>
</svelte:head>

<div class="page">
  <div class="sr-monogram">sr.</div>
  <h1 class="title">Broads speed</h1>

  <div class="layout">
    <!-- Map panel -->
    <div class="map-panel nm-sec">
      <div class="label-row">
        <span class="sr-label-tight">track</span>
        {#if active}
          <span class="live-badge">live</span>
        {/if}
      </div>
      <div class="map-wrap" bind:this={mapContainer} />
    </div>

    <!-- Stats column -->
    <div class="stats-col">
      {#if loading}
        <div class="nm-sec">
          <p class="loading-text">Loading...</p>
        </div>
      {:else if error}
        <div class="nm-sec">
          <p class="error-text">{error}</p>
        </div>
      {:else}
        <!-- Active journey -->
        <div class="nm-sec">
          <span class="sr-label-tight">current journey</span>
          {#if active}
            <div class="stat-grid">
              <div class="stat">
                <span class="stat-value">{active.avgMph}</span>
                <span class="stat-label">avg mph</span>
              </div>
              <div class="stat">
                <span class="stat-value">{active.maxMph}</span>
                <span class="stat-label">max mph</span>
              </div>
              <div class="stat">
                <span class="stat-value">{active.avgKn}</span>
                <span class="stat-label">avg kn</span>
              </div>
              <div class="stat">
                <span class="stat-value">{active.sampleCount}</span>
                <span class="stat-label">samples</span>
              </div>
              <div class="stat">
                <span class="stat-value">{active.durationMinutes}</span>
                <span class="stat-label">min</span>
              </div>
            </div>
            {#if active.samples.length >= 2}
              <div class="chart-wrap">
                <canvas bind:this={chartCanvas} class="speed-chart" />
              </div>
            {/if}
            {#if pos}
              <div class="pos-info">
                <span class="sr-label-tight">last fix</span>
                <span class="pos-coords">{pos.lat.toFixed(4)}, {pos.lng.toFixed(4)}</span>
                <span class="pos-speed">{pos.speed.toFixed(1)} km/h</span>
              </div>
            {/if}
          {:else}
            <p class="idle-text">No active journey. Last seen {timeAgo(data.updatedAt)}.</p>
          {/if}
        </div>

        <!-- Speed chart (for active journey) -->
        {#if active && active.samples.length >= 2}
          <div class="nm-sec">
            <span class="sr-label-tight">speed over time</span>
            <canvas bind:this={chartCanvas} class="speed-chart full" />
          </div>
        {/if}

        <!-- Past journeys -->
        <div class="nm-sec">
          <span class="sr-label-tight">past journeys</span>
          {#if past.length > 0}
            <div class="journey-list">
              {#each past as j}
                <div class="journey-row">
                  <div class="journey-date">{formatDate(j.startTime)}</div>
                  <div class="journey-meta">
                    <span>{formatTime(j.startTime)}–{formatTime(j.endTime)}</span>
                    <span class="dot">·</span>
                    <span>{j.durationMinutes} min</span>
                    <span class="dot">·</span>
                    <span>{j.avgMph} mph avg</span>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <p class="idle-text">No past journeys recorded.</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  :global(body) {
    background: #ede4d4;
    color: #1a1008;
    font-family: 'DM Sans', system-ui, sans-serif;
    margin: 0;
    padding: 0;
  }
  :global(.place-label) {
    background: none;
    border: none;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    color: rgba(26, 16, 8, 0.5);
    letter-spacing: 0.04em;
    white-space: nowrap;
    margin-left: 4px;
    margin-top: -2px;
  }

  .page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1.5rem 1.25rem;
  }
  .sr-monogram {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: rgba(26, 16, 8, 0.45);
    margin-bottom: 0.5rem;
  }
  .title {
    font-family: 'Archivo Black', Impact, sans-serif;
    font-size: 2rem;
    margin: 0 0 1.25rem 0;
    color: #1a1008;
  }
  .nm-sec {
    background: rgba(26, 16, 8, 0.04);
    border: 1px solid rgba(26, 16, 8, 0.18);
    padding: 1rem 1.1rem 1.15rem;
    margin-bottom: 1.25rem;
  }
  .sr-label-tight {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: rgba(26, 16, 8, 0.45);
    display: block;
    margin-bottom: 0.5rem;
  }
  .label-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .live-badge {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #c4570a;
    border: 1px solid #c4570a;
    padding: 1px 5px;
  }

  .layout {
    display: grid;
    grid-template-columns: 1fr 360px;
    gap: 1.25rem;
    align-items: start;
  }
  @media (max-width: 800px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }

  .map-panel {
    padding: 0.75rem;
  }
  .map-wrap {
    height: 480px;
    width: 100%;
    background: #e8dfcf;
  }
  :global(.map-wrap .leaflet-container) {
    background: #e8dfcf;
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .stat {
    text-align: center;
  }
  .stat-value {
    display: block;
    font-family: 'Archivo Black', Impact, sans-serif;
    font-size: 1.4rem;
    color: #1a1008;
    line-height: 1.2;
  }
  .stat-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(26, 16, 8, 0.45);
  }

  .chart-wrap {
    margin-top: 0.5rem;
  }
  .speed-chart {
    width: 100%;
    height: 120px;
    display: block;
  }
  .speed-chart.full {
    height: 160px;
  }

  .pos-info {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid rgba(26, 16, 8, 0.08);
  }
  .pos-coords {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: rgba(26, 16, 8, 0.65);
  }
  .pos-speed {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: rgba(26, 16, 8, 0.65);
    margin-left: auto;
  }

  .journey-list {
    margin-top: 0.5rem;
  }
  .journey-row {
    padding: 0.5rem 0;
    border-bottom: 1px solid rgba(26, 16, 8, 0.08);
  }
  .journey-row:last-child {
    border-bottom: none;
  }
  .journey-date {
    font-family: 'Archivo Black', Impact, sans-serif;
    font-size: 0.9rem;
    color: #1a1008;
  }
  .journey-meta {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: rgba(26, 16, 8, 0.65);
    margin-top: 2px;
  }
  .dot {
    margin: 0 0.25rem;
    opacity: 0.4;
  }

  .loading-text {
    color: rgba(26, 16, 8, 0.45);
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
  }
  .error-text {
    color: #c4570a;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
  }
  .idle-text {
    color: rgba(26, 16, 8, 0.45);
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    margin: 0;
  }
</style>