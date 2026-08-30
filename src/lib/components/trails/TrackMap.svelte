<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { TrackPoint } from '$lib/trails/track';

  let {
    coordinates,
    bounds = null,
    colourBy = 'none',
    height = '420px',
    offline = false,
    legend = true,
  }: {
    coordinates: TrackPoint[];
    bounds?: { n: number; s: number; e: number; w: number } | null;
    /** 'pace' renders the trace as a speed ramp instead of one flat line. */
    colourBy?: 'none' | 'pace';
    height?: string;
    /** Read downloaded tiles from IndexedDB before going to the network. */
    offline?: boolean;
    /**
     * The slower→faster ramp key drawn over the map. Off for a caller that
     * prints its own legend under the frame with the real pace range on it —
     * two keys for one ramp is one too many.
     */
    legend?: boolean;
  } = $props();

  let container: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);

  // Leaflet handles are plain refs, never $state: a $state map handle that is
  // both read and written by the same lifecycle function subscribes its effect
  // to itself and loops until effect_update_depth_exceeded.
  let mapRef: any = null;
  let scrollZoomActive = false;

  interface LeafletGlobal {
    map: (el: HTMLElement, opts?: Record<string, unknown>) => any;
    tileLayer: (url: string, opts?: Record<string, unknown>) => any;
    polyline: (latlngs: unknown, opts?: Record<string, unknown>) => any;
    circleMarker: (latlng: [number, number], opts?: Record<string, unknown>) => any;
    latLngBounds: (a: [number, number], b: [number, number]) => any;
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

  /** Metres between two [lng, lat] points — enough for a per-segment speed. */
  function stepMetres(a: TrackPoint, b: TrackPoint): number {
    const R = 6371008.8;
    const dLat = ((b[1] - a[1]) * Math.PI) / 180;
    const dLng = ((b[0] - a[0]) * Math.PI) / 180;
    const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
    const x = dLng * Math.cos(lat);
    return Math.sqrt(x * x + dLat * dLat) * R;
  }

  // Pace is a magnitude, so the ramp is sequential: one hue, light to dark.
  // (A multi-hue rainbow would imply categories that pace does not have.)
  // Steps are monotonic in lightness; the legend's slower/faster labels carry
  // the meaning, so the two palest steps never have to earn it on contrast.
  const RAMP = ['#d9861f', '#b35408', '#8a3b05', '#5c2604'];

  function paceColours(points: TrackPoint[]): string[] {
    const speeds: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const dt = points[i][3] - points[i - 1][3];
      speeds.push(dt > 0 ? stepMetres(points[i - 1], points[i]) / dt : 0);
    }
    const usable = speeds.filter((s) => s > 0).sort((a, b) => a - b);
    if (usable.length < 2) return speeds.map(() => RAMP[2]);
    // Percentile bounds, so one GPS jump does not flatten the whole ramp.
    const lo = usable[Math.floor(usable.length * 0.05)];
    const hi = usable[Math.floor(usable.length * 0.95)];
    const span = hi - lo || 1;
    return speeds.map((s) => {
      const t = Math.min(1, Math.max(0, (s - lo) / span));
      return RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))];
    });
  }

  onMount(() => {
    let cancelled = false;

    (async () => {
      try {
        const L = await ensureLeafletLoaded();
        if (cancelled || !container || coordinates.length < 2) return;

        const map = L.map(container, {
          scrollWheelZoom: false,
          zoomControl: true,
          attributionControl: true,
        });
        mapRef = map;

        map.on('focus', () => {
          if (scrollZoomActive) return;
          scrollZoomActive = true;
          map.scrollWheelZoom.enable();
        });
        map.on('blur', () => {
          if (!scrollZoomActive) return;
          scrollZoomActive = false;
          map.scrollWheelZoom.disable();
        });

        if (offline) {
          const { createOfflineTileLayer } = await import('$lib/trails/field/offline-layer');
          createOfflineTileLayer(L).addTo(map);
        } else {
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap',
            maxZoom: 19,
          }).addTo(map);
        }

        const latlngs = coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);

        if (colourBy === 'pace') {
          const colours = paceColours(coordinates);
          // A casing line underneath keeps the ramp legible over busy tiles.
          L.polyline(latlngs, { color: '#1a1008', weight: 6, opacity: 0.35 }).addTo(map);
          for (let i = 1; i < latlngs.length; i++) {
            L.polyline([latlngs[i - 1], latlngs[i]], {
              color: colours[i - 1],
              weight: 4,
              opacity: 0.95,
            }).addTo(map);
          }
        } else {
          L.polyline(latlngs, { color: '#1a1008', weight: 6, opacity: 0.3 }).addTo(map);
          L.polyline(latlngs, { color: '#c4570a', weight: 3.5, opacity: 1 }).addTo(map);
        }

        L.circleMarker(latlngs[0], {
          radius: 5,
          color: '#1a1008',
          weight: 2,
          fillColor: '#0e5b66',
          fillOpacity: 1,
        })
          .addTo(map)
          .bindTooltip('Start');

        L.circleMarker(latlngs[latlngs.length - 1], {
          radius: 5,
          color: '#1a1008',
          weight: 2,
          fillColor: '#c4570a',
          fillOpacity: 1,
        })
          .addTo(map)
          .bindTooltip('Finish');

        if (bounds) {
          map.fitBounds(
            L.latLngBounds([bounds.s, bounds.w], [bounds.n, bounds.e]),
            { padding: [24, 24] },
          );
        } else {
          map.fitBounds(latlngs, { padding: [24, 24] });
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  onDestroy(() => {
    mapRef?.remove();
    mapRef = null;
  });
</script>

{#if error}
  <div class="map-fallback" style:height>Map unavailable — {error}</div>
{:else if coordinates.length < 2}
  <div class="map-fallback" style:height>No GPS trace for this activity.</div>
{:else}
  <div class="map-frame" style:height>
    <div class="map" bind:this={container}></div>
    {#if colourBy === 'pace' && legend}
      <div class="ramp-legend">
        <span class="ramp-label">slower</span>
        <span class="ramp">
          {#each RAMP as c}<i style:background={c}></i>{/each}
        </span>
        <span class="ramp-label">faster</span>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* New stacking context: Leaflet's internal panes reach z-index ~700 and
     will otherwise sit on top of page chrome. */
  .map-frame {
    position: relative;
    isolation: isolate;
    border: 1px solid var(--line-strong);
    background: var(--surface-sunken);
  }

  .map {
    width: 100%;
    height: 100%;
  }

  .map-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--line-strong);
    background: var(--surface-sunken);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .ramp-legend {
    position: absolute;
    right: 10px;
    bottom: 10px;
    z-index: 500;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    background: var(--surface-card);
    border: 1px solid var(--line-strong);
  }

  .ramp {
    display: flex;
  }

  .ramp i {
    display: block;
    width: 14px;
    height: 8px;
  }

  .ramp-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
  }

  :global(.leaflet-container) {
    font-family: var(--font-mono);
    background: #e8dece;
  }
</style>
