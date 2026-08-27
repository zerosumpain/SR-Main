<script lang="ts">
  /**
   * The household on one map. Same vendored-Leaflet pattern as
   * PlaceMap.svelte — no CDN, shared window.L, scroll zoom off — with one
   * labelled marker per person, fitted to whoever is currently placed.
   * Positions arrive from the on-demand `family_now` action, never from the
   * page payload: a lat/lon leaves the server for exactly one owner-gated
   * render, which is the same discipline the naming map established.
   */
  import { onMount } from 'svelte';

  export interface FamilyPosition {
    subject: string;
    lat: number;
    lon: number;
    isHome: boolean | null;
    ageMins: number;
  }

  let {
    positions,
    height = '300px',
  }: { positions: FamilyPosition[]; height?: string } = $props();

  type LeafletMap = {
    fitBounds: (b: unknown, opts?: Record<string, unknown>) => unknown;
    setView: (c: [number, number], z: number) => unknown;
    remove: () => unknown;
  };
  type LeafletGlobal = {
    map: (el: HTMLElement, opts?: Record<string, unknown>) => LeafletMap;
    tileLayer: (url: string, opts?: Record<string, unknown>) => { addTo: (m: unknown) => unknown; on: (ev: string, fn: () => void) => unknown };
    circleMarker: (
      c: [number, number],
      opts?: Record<string, unknown>,
    ) => { addTo: (m: unknown) => unknown; bindTooltip: (t: string, o?: Record<string, unknown>) => unknown };
    latLngBounds: (coords: Array<[number, number]>) => unknown;
  };

  let container: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);

  // Plain let — a handle, nothing reactive reads it.
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
        if (cancelled || !container || positions.length === 0) return;
        const map = L.map(container, { scrollWheelZoom: false, zoomControl: true });
        mapRef = map;

        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap',
        }).addTo(map);

        for (const p of positions) {
          const stale = p.ageMins > 60;
          const marker = L.circleMarker([p.lat, p.lon], {
            radius: 8,
            color: '#faf7f1',
            weight: 2,
            fillColor: stale ? '#8a8272' : p.isHome ? '#3a8a56' : '#c4570a',
            fillOpacity: 0.95,
          });
          marker.bindTooltip(
            `${p.subject.charAt(0).toUpperCase()}${p.subject.slice(1)}${stale ? ` · ${p.ageMins}m ago` : ''}`,
            { permanent: true, direction: 'top', offset: [0, -8], className: 'fam-tip' },
          );
          marker.addTo(map);
        }

        if (positions.length === 1) {
          map.setView([positions[0].lat, positions[0].lon], 15);
        } else {
          map.fitBounds(L.latLngBounds(positions.map((p) => [p.lat, p.lon] as [number, number])), {
            padding: [36, 36],
            maxZoom: 15,
          });
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
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
  <p class="map-error">Map failed to load: {error}</p>
{:else}
  <div class="fam-map" bind:this={container} style="height: {height}"></div>
{/if}

<style>
  .fam-map {
    width: 100%;
    border: 1px solid var(--card-border);
    background: var(--bg-section);
  }
  .map-error {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: #c44;
  }
  :global(.fam-tip) {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
</style>
