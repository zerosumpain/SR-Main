<script lang="ts">
  import { onMount } from 'svelte';
  import type { MapArtifact } from '$lib/workflows/site-tools/artifact-types';

  // Loose global typing — Leaflet loaded via static script tag, not npm.
  type LeafletMap = {
    setView: (c: [number, number], z: number) => unknown;
    fitBounds: (b: unknown, opts?: Record<string, unknown>) => unknown;
    invalidateSize: () => unknown;
    scrollWheelZoom: { enable: () => unknown; disable: () => unknown };
    on: (ev: string, fn: () => void) => unknown;
  };
  type LeafletGlobal = {
    map: (el: HTMLElement, opts?: Record<string, unknown>) => LeafletMap;
    tileLayer: (url: string, opts?: Record<string, unknown>) => { addTo: (m: unknown) => unknown };
    marker: (latlng: [number, number], opts?: Record<string, unknown>) => { addTo: (m: unknown) => { bindTooltip: (t: string) => unknown } };
    polyline: (coords: Array<[number, number]>, opts?: Record<string, unknown>) => { addTo: (m: unknown) => unknown; getBounds: () => unknown };
    circleMarker: (latlng: [number, number], opts?: Record<string, unknown>) => { addTo: (m: unknown) => unknown };
    latLngBounds: (corners: Array<[number, number]>) => { extend: (p: [number, number]) => unknown };
  };

  let { artifact }: { artifact: MapArtifact } = $props();

  let container: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);
  let fullscreen = $state(false);
  let scrollZoomActive = $state(false);
  let mapRef: LeafletMap | null = $state(null);

  function toggleFullscreen() {
    fullscreen = !fullscreen;
    // Leaflet needs to recalculate tile layout after the container resizes
    requestAnimationFrame(() => {
      mapRef?.invalidateSize();
    });
  }

  function activateScrollZoom() {
    if (scrollZoomActive) return;
    scrollZoomActive = true;
    mapRef?.scrollWheelZoom.enable();
  }

  function deactivateScrollZoom() {
    if (!scrollZoomActive) return;
    scrollZoomActive = false;
    mapRef?.scrollWheelZoom.disable();
  }

  function ensureLeafletLoaded(): Promise<LeafletGlobal> {
    const existing = (globalThis as unknown as { L?: LeafletGlobal }).L;
    if (existing) return Promise.resolve(existing);

    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/vendor/leaflet.min.css';
      link.dataset.leaflet = 'true';
      document.head.appendChild(link);
    }

    return new Promise((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>('script[data-leaflet]');
      if (existingScript) {
        existingScript.addEventListener('load', () => {
          const L = (globalThis as unknown as { L?: LeafletGlobal }).L;
          L ? resolve(L) : reject(new Error('Leaflet loaded but window.L missing'));
        });
        return;
      }
      const script = document.createElement('script');
      script.src = '/vendor/leaflet.min.js';
      script.dataset.leaflet = 'true';
      script.onload = () => {
        const L = (globalThis as unknown as { L?: LeafletGlobal }).L;
        L ? resolve(L) : reject(new Error('Leaflet loaded but window.L missing'));
      };
      script.onerror = () => reject(new Error('Failed to load /vendor/leaflet.min.js'));
      document.head.appendChild(script);
    });
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const L = await ensureLeafletLoaded();
        if (cancelled || !container) return;
        // scrollWheelZoom starts disabled so page scroll works; user
        // activates it by clicking the map (and deactivates by clicking off).
        // touchZoom / pinch / +- controls / double-click / drag are all
        // default-enabled.
        const map = L.map(container, {
          scrollWheelZoom: false,
          zoomControl: true,
          touchZoom: true,
          doubleClickZoom: true,
          dragging: true,
        });
        mapRef = map;

        map.on('focus', activateScrollZoom);
        map.on('blur', deactivateScrollZoom);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap',
          maxZoom: 19,
        }).addTo(map);

        const allPoints: Array<[number, number]> = [];
        for (const layer of artifact.layers) {
          if (layer.kind === 'points') {
            for (const p of layer.points) {
              const m = L.marker([p.lat, p.lng]).addTo(map);
              if (p.label) m.bindTooltip(p.label);
              allPoints.push([p.lat, p.lng]);
            }
          } else if (layer.kind === 'track') {
            const coords = layer.points.map((p) => [p.lat, p.lng] as [number, number]);
            L.polyline(coords, { color: '#2563eb', weight: 3 }).addTo(map);
            allPoints.push(...coords);
          } else {
            // heatmap — fallback to weighted circle markers (no external plugin in v1)
            for (const p of layer.points) {
              const w = typeof p.weight === 'number' ? p.weight : 1;
              L.circleMarker([p.lat, p.lng], {
                radius: Math.min(Math.max(w * 4, 3), 20),
                fillColor: '#ef4444',
                color: '#b91c1c',
                weight: 1,
                fillOpacity: 0.5,
              }).addTo(map);
              allPoints.push([p.lat, p.lng]);
            }
          }
        }

        if (artifact.center && artifact.zoom != null) {
          map.setView(artifact.center, artifact.zoom);
        } else if (allPoints.length > 0) {
          const [head, ...rest] = allPoints;
          const bounds = L.latLngBounds([head, head]);
          for (const p of rest) bounds.extend(p);
          map.fitBounds(bounds, { padding: [20, 20] });
        } else {
          map.setView([51.5, -0.1], 12);
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    })();
    return () => {
      cancelled = true;
      mapRef = null;
    };
  });
</script>

<figure class="map-artifact" class:fullscreen>
  <div class="map-container" bind:this={container}></div>

  <button
    class="fs-toggle"
    type="button"
    onclick={toggleFullscreen}
    aria-label={fullscreen ? 'Exit fullscreen' : 'Expand map'}
    title={fullscreen ? 'Exit fullscreen' : 'Expand map'}
  >
    {#if fullscreen}
      <!-- collapse icon -->
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>
      </svg>
    {:else}
      <!-- expand icon -->
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
      </svg>
    {/if}
  </button>

  {#if error}
    <p class="error">Map failed to render: {error}</p>
  {/if}
  {#if artifact.caption}
    <figcaption>{artifact.caption}</figcaption>
  {/if}
</figure>

<style>
  .map-artifact {
    position: relative;
    /* Establish a new stacking context so Leaflet's internal tile/pane z-indexes
       (which reach ~600–700) stay contained. Without this, map tiles bleed
       above fixed/absolute overlays like the tool-call drawer. */
    z-index: 0;
    isolation: isolate;
    margin: 0.5rem 0;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    overflow: hidden;
    max-width: 100%;
  }
  .map-container {
    width: 100%;
    height: 360px;
  }
  .map-artifact.fullscreen {
    position: fixed;
    inset: 0;
    margin: 0;
    border-radius: 0;
    border: none;
    z-index: 9999;
    background: #fff;
  }
  .map-artifact.fullscreen .map-container {
    height: 100vh;
  }
  .fs-toggle {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    z-index: 1000; /* above Leaflet layers */
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid rgba(0,0,0,0.2);
    border-radius: 4px;
    background: white;
    color: #333;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0,0,0,0.15);
  }
  .fs-toggle:hover { background: #f5f5f5; }
  figcaption {
    padding: 0.4rem 0.75rem;
    font-size: 0.8rem;
    color: var(--text-muted);
    border-top: 1px solid var(--card-border);
  }
  .map-artifact.fullscreen figcaption {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(255,255,255,0.95);
    border-top: 1px solid var(--card-border);
  }
  .error {
    color: var(--error);
    padding: 0.5rem;
    font-size: 0.85rem;
    margin: 0;
  }
</style>
