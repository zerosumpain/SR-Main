<script lang="ts">
  /**
   * A small map showing one place, so naming it is a recognition rather than a
   * memory test.
   *
   * Leaflet is loaded from `/vendor/leaflet.min.{js,css}` exactly as
   * MapArtifact.svelte does — vendored locally rather than from a CDN, and
   * shared so a second copy is not fetched when both are on a page. The tile
   * host is the one the service worker already caches for broads-pilot.
   */
  import { onMount } from 'svelte';

  type LeafletMap = {
    setView: (c: [number, number], z: number) => unknown;
    invalidateSize: () => unknown;
    remove: () => unknown;
    scrollWheelZoom: { enable: () => unknown; disable: () => unknown };
  };
  type TileLayer = { addTo: (m: unknown) => unknown; on: (ev: string, fn: () => void) => unknown };
  type LeafletGlobal = {
    map: (el: HTMLElement, opts?: Record<string, unknown>) => LeafletMap;
    tileLayer: (url: string, opts?: Record<string, unknown>) => TileLayer;
    circle: (c: [number, number], opts?: Record<string, unknown>) => { addTo: (m: unknown) => unknown };
    circleMarker: (c: [number, number], opts?: Record<string, unknown>) => { addTo: (m: unknown) => unknown };
  };

  let {
    lat,
    lon,
    radiusM = 200,
    height = '220px',
  }: { lat: number; lon: number; radiusM?: number; height?: string } = $props();

  let container: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);
  /** Tiles that failed. Surfaced rather than left as a grey box — a map that
   *  silently shows nothing is indistinguishable from one that never mounted,
   *  which is exactly the confusion that made the last failure hard to place. */
  let tileErrors = $state(0);

  // Plain `let`, never `$state` — nothing reactive reads it, and a handle that
  // an effect both reads and writes is the classic effect_update_depth loop.
  let mapRef: LeafletMap | null = null;

  function ensureLeaflet(): Promise<LeafletGlobal> {
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
      const done = () => {
        const L = (globalThis as unknown as { L?: LeafletGlobal }).L;
        L ? resolve(L) : reject(new Error('Leaflet loaded but window.L missing'));
      };
      const existingScript = document.querySelector<HTMLScriptElement>('script[data-leaflet]');
      if (existingScript) {
        existingScript.addEventListener('load', done);
        return;
      }
      const script = document.createElement('script');
      script.src = '/vendor/leaflet.min.js';
      script.dataset.leaflet = 'true';
      script.onload = done;
      script.onerror = () => reject(new Error('Failed to load /vendor/leaflet.min.js'));
      document.head.appendChild(script);
    });
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const L = await ensureLeaflet();
        if (cancelled || !container) return;

        // Scroll zoom off: the map sits inside a scrolling list, and a wheel
        // that zooms instead of scrolling traps the page.
        const map = L.map(container, { scrollWheelZoom: false, zoomControl: true });
        mapRef = map;
        map.setView([lat, lon], 17);

        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap',
        });
        tiles.on('tileerror', () => {
          tileErrors++;
        });
        tiles.addTo(map);

        // The scatter the place was clustered from, then its centre. Showing
        // both is the point: a wide circle says "somewhere around here", which
        // is the honest precision of a 200 m cluster.
        L.circle([lat, lon], {
          radius: radiusM,
          color: '#c4570a',
          weight: 1,
          fillColor: '#c4570a',
          fillOpacity: 0.08,
        }).addTo(map);
        L.circleMarker([lat, lon], {
          radius: 5,
          color: '#0e5b66',
          weight: 2,
          fillColor: '#0e5b66',
          fillOpacity: 1,
        }).addTo(map);
        // Leaflet measures its container once, at creation. If that happens
        // while the row is still being laid out — which is easy inside a list
        // that has just expanded — it initialises at zero size and paints
        // nothing. Re-measuring on the next frame and once more after layout
        // settles is the standard remedy, and MapArtifact already does the same
        // after its own resize.
        requestAnimationFrame(() => mapRef?.invalidateSize());
        setTimeout(() => mapRef?.invalidateSize(), 250);
      } catch (err) {
        error = err instanceof Error ? err.message : 'map failed to load';
      }
    })();

    return () => {
      cancelled = true;
      mapRef?.remove();
      mapRef = null;
    };
  });
</script>

{#if error}
  <div class="map-err">Map unavailable — {error}</div>
{:else}
  <div class="place-map" bind:this={container} style="height: {height}"></div>
  {#if tileErrors > 0}
    <p class="tile-err">
      {tileErrors} map tile{tileErrors === 1 ? '' : 's'} failed to load — the position is right,
      the imagery is not.
    </p>
  {/if}
{/if}

<style>
  .place-map {
    width: 100%;
    border: 1px solid var(--line-strong);
    background: var(--surface-sunken);
  }
  .tile-err {
    margin: 0.35rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--warn, #b0892a);
  }
  .map-err {
    padding: 0.75rem;
    border: 1px dashed var(--line-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
</style>
