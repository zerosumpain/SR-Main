<script lang="ts">
  /**
   * A route and where somebody is on it — /follow/<token>. `DayMap`'s pattern
   * (token from `/api/maps/config`, mapbox-gl imported inside onMount, its
   * stylesheet as a `<link>`, the map a plain `let`): the route as a petrol
   * line on a paper casing, the start hollow, the latest position an accent
   * dot. Fitted to the route once, never again — the page refreshes every 15 s
   * and a map that re-fits each time fights whoever is panning it.
   */
  import { onMount, untrack } from 'svelte';
  import type { GeoJSONSource, Map as GLMap } from 'mapbox-gl';
  import type { FeatureCollection } from 'geojson';
  import mapboxCssUrl from 'mapbox-gl/dist/mapbox-gl.css?url';

  let {
    route,
    position,
    label,
  }: { route: [number, number][]; position: [number, number] | null; label: string } = $props();

  let status = $state<'loading' | 'ready' | 'unavailable'>('loading');

  let container: HTMLDivElement;
  let map: GLMap | null = null;
  let loaded = false;

  const ROUTE = 'follow-route';
  const HERE = 'follow-here';

  /** `[lat, lng]` in, `[lng, lat]` out — GeoJSON's order. */
  const lngLat = (p: [number, number]): [number, number] => [p[1], p[0]];

  function token(name: string, fallback: string): string {
    const v = getComputedStyle(container).getPropertyValue(name).trim();
    return v || getComputedStyle(container).getPropertyValue(fallback).trim() || 'currentColor';
  }

  function routeData(): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.map(lngLat) } },
        ...(route[0] ? [{ type: 'Feature' as const, properties: { kind: 'start' }, geometry: { type: 'Point' as const, coordinates: lngLat(route[0]) } }] : []),
      ],
    };
  }

  function hereData(): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: position ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: lngLat(position) } }] : [],
    };
  }

  function renderHere() {
    if (!map || !loaded) return;
    (map.getSource(HERE) as GeoJSONSource | undefined)?.setData(hereData());
  }

  $effect(() => {
    void position;
    untrack(renderHere);
  });

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/maps/config', { headers: { accept: 'application/json' } });
        const cfg = (await res.json().catch(() => ({}))) as { accessToken?: string; token?: string; style?: string };
        const accessToken = cfg.accessToken ?? cfg.token;
        if (!res.ok || !accessToken || !route.length) {
          status = 'unavailable';
          return;
        }
        const mapboxgl = (await import('mapbox-gl')).default;
        if (cancelled) return;
        map = new mapboxgl.Map({
          container,
          accessToken,
          style: cfg.style ?? 'mapbox://styles/mapbox/outdoors-v12',
          center: lngLat(route[0]),
          zoom: 13,
          maxZoom: 17,
          attributionControl: false,
          cooperativeGestures: true,
        });
        map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
        map.on('error', () => {
          // Never echo the provider's message: its URLs carry the token.
          if (!loaded) status = 'unavailable';
        });
        map.on('load', () => {
          if (!map) return;
          loaded = true;
          status = 'ready';
          const ink = token('--accent-ink', '--text-primary');
          const paper = token('--bg', '--surface-elevated');
          const accent = token('--accent', '--text-primary');
          map.addSource(ROUTE, { type: 'geojson', data: routeData() });
          map.addSource(HERE, { type: 'geojson', data: hereData() });
          map.addLayer({ id: 'follow-casing', type: 'line', source: ROUTE, filter: ['==', ['geometry-type'], 'LineString'],
            layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': paper, 'line-width': 8 } });
          map.addLayer({ id: 'follow-line', type: 'line', source: ROUTE, filter: ['==', ['geometry-type'], 'LineString'],
            layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ink, 'line-width': 4 } });
          map.addLayer({ id: 'follow-start', type: 'circle', source: ROUTE, filter: ['==', ['geometry-type'], 'Point'],
            paint: { 'circle-radius': 6, 'circle-color': paper, 'circle-stroke-width': 2.5, 'circle-stroke-color': ink } });
          map.addLayer({ id: 'follow-here', type: 'circle', source: HERE,
            paint: { 'circle-radius': 8, 'circle-color': accent, 'circle-stroke-width': 3, 'circle-stroke-color': paper } });
          const b = new mapboxgl.LngLatBounds();
          for (const p of route) b.extend(lngLat(p));
          map.fitBounds(b, { padding: 32, maxZoom: 16, duration: 0 });
        });
      } catch {
        status = 'unavailable';
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
      map = null;
      loaded = false;
    };
  });
</script>

<svelte:head>
  <link rel="stylesheet" href={mapboxCssUrl} />
</svelte:head>

<div class="map-frame">
  <div class="map" bind:this={container} role="img" aria-label={label}></div>
  {#if status !== 'ready'}
    <p class="map-status">{status === 'loading' ? 'Loading map…' : 'Map unavailable — the figures below still say how far along they are.'}</p>
  {/if}
</div>

<style>
  .map-frame {
    position: relative;
    border: 1px solid var(--text-primary);
  }
  .map {
    height: min(60vh, 460px);
    width: 100%;
  }
  .map-status {
    position: absolute;
    inset: auto 0 0 0;
    margin: 0;
    padding: 8px 12px;
    background: var(--bg);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
</style>
