<script lang="ts">
  import { onMount } from 'svelte';
  import type { MapArtifact } from '$lib/workflows/site-tools/artifact-types';

  // Loose global typing — Leaflet loaded via static script tag, not npm.
  type LeafletGlobal = {
    map: (el: HTMLElement, opts?: Record<string, unknown>) => unknown;
    tileLayer: (url: string, opts?: Record<string, unknown>) => { addTo: (m: unknown) => unknown };
    marker: (latlng: [number, number], opts?: Record<string, unknown>) => { addTo: (m: unknown) => { bindTooltip: (t: string) => unknown } };
    polyline: (coords: Array<[number, number]>, opts?: Record<string, unknown>) => { addTo: (m: unknown) => unknown; getBounds: () => unknown };
    circleMarker: (latlng: [number, number], opts?: Record<string, unknown>) => { addTo: (m: unknown) => unknown };
    latLngBounds: (corners: Array<[number, number]>) => { extend: (p: [number, number]) => unknown };
  };

  let { artifact }: { artifact: MapArtifact } = $props();

  let container: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);

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
        const map = L.map(container, { scrollWheelZoom: false }) as unknown as {
          setView: (c: [number, number], z: number) => unknown;
          fitBounds: (b: unknown, opts?: Record<string, unknown>) => unknown;
        };
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
          (map as unknown as { setView: (c: [number, number], z: number) => unknown }).setView([51.5, -0.1], 12);
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<figure class="map-artifact">
  <div class="map-container" bind:this={container}></div>
  {#if error}
    <p class="error">Map failed to render: {error}</p>
  {/if}
  {#if artifact.caption}
    <figcaption>{artifact.caption}</figcaption>
  {/if}
</figure>

<style>
  .map-artifact {
    margin: 0.5rem 0;
    border: 1px solid rgb(var(--border-rgb, 200 200 200) / 0.4);
    border-radius: 6px;
    overflow: hidden;
    max-width: 100%;
  }
  .map-container {
    width: 100%;
    height: 360px;
  }
  figcaption {
    padding: 0.4rem 0.75rem;
    font-size: 0.8rem;
    color: rgb(var(--muted-fg-rgb, 100 100 100));
    border-top: 1px solid rgb(var(--border-rgb, 200 200 200) / 0.4);
  }
  .error {
    color: #b00;
    padding: 0.5rem;
    font-size: 0.85rem;
    margin: 0;
  }
</style>
