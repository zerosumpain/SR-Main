<script lang="ts">
  /**
   * One journey's route on a small map — the Commuting list on
   * /home/people/[subject]. The same mapbox-gl pattern as `PlacesMap`: the
   * token from `/api/maps/config`, mapbox-gl imported inside onMount (it
   * touches `window` at import), its stylesheet as a `<link>` (the PWA build
   * refuses a CSS import from a component), and the map as a plain `let`
   * because nothing in the template reads it.
   *
   * The route is a line in petrol ink with a dot at each end — the start
   * hollow, the finish filled — so direction reads without arrows. The list
   * row carries every figure; the map is an enhancement, and a missing token
   * leaves a one-line note in its place.
   */
  import { onMount, untrack } from 'svelte';
  import type { GeoJSONSource, Map as GLMap } from 'mapbox-gl';
  import mapboxCssUrl from 'mapbox-gl/dist/mapbox-gl.css?url';

  let { route, label }: { route: Array<[number, number]>; label: string } = $props();

  let status = $state<'loading' | 'ready' | 'unavailable'>('loading');
  let statusText = $state('Loading map…');

  // Not state: nothing in the template reads these.
  let container: HTMLDivElement;
  let map: GLMap | null = null;
  let mapboxgl: typeof import('mapbox-gl').default | null = null;
  let loaded = false;

  const LINE = 'commute-line';
  const ENDS = 'commute-ends';

  /** A design token's current value, so the map paints in the page's colours. */
  function token(name: string, fallback: string): string {
    const v = getComputedStyle(container).getPropertyValue(name).trim();
    return v || getComputedStyle(container).getPropertyValue(fallback).trim() || 'currentColor';
  }

  function lineData() {
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: route },
    };
  }

  function endsData() {
    const first = route[0];
    const last = route[route.length - 1];
    return {
      type: 'FeatureCollection' as const,
      features: first
        ? [
            { type: 'Feature' as const, properties: { end: 'start' }, geometry: { type: 'Point' as const, coordinates: first } },
            { type: 'Feature' as const, properties: { end: 'finish' }, geometry: { type: 'Point' as const, coordinates: last } },
          ]
        : [],
    };
  }

  function fit(animate: boolean) {
    if (!map || !mapboxgl || !route.length) return;
    const b = new mapboxgl.LngLatBounds();
    for (const p of route) b.extend(p);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    map.fitBounds(b, { padding: 28, maxZoom: 15, duration: animate && !reduce ? 600 : 0 });
  }

  function render() {
    if (!map || !loaded) return;
    (map.getSource(LINE) as GeoJSONSource | undefined)?.setData(lineData());
    (map.getSource(ENDS) as GeoJSONSource | undefined)?.setData(endsData());
    fit(true);
  }

  $effect(() => {
    // Tracked: the route alone. The body writes no state.
    void route;
    untrack(render);
  });

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/maps/config', { headers: { accept: 'application/json' } });
        const cfg = (await res.json().catch(() => ({}))) as { accessToken?: string; token?: string; style?: string };
        const accessToken = cfg.accessToken ?? cfg.token;
        if (!res.ok || !accessToken) {
          status = 'unavailable';
          statusText = 'Map unavailable — the figures above are the whole journey.';
          return;
        }
        const mod = await import('mapbox-gl');
        if (cancelled) return;
        mapboxgl = mod.default;
        const first = route[0] ?? [-1.5, 53];
        map = new mapboxgl.Map({
          container,
          accessToken,
          style: cfg.style ?? 'mapbox://styles/mapbox/outdoors-v12',
          center: first,
          zoom: route.length ? 11 : 5,
          maxZoom: 17,
          attributionControl: false,
          cooperativeGestures: true,
        });
        map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
        map.on('error', () => {
          // Never echo the provider's message: its URLs carry the token.
          if (!loaded) {
            status = 'unavailable';
            statusText = 'Map imagery unavailable.';
          }
        });
        map.on('load', () => {
          if (!map) return;
          loaded = true;
          status = 'ready';
          const ink = token('--accent-ink', '--text-primary');
          const paper = token('--bg', '--surface-elevated');
          map.addSource(LINE, { type: 'geojson', data: lineData() });
          map.addSource(ENDS, { type: 'geojson', data: endsData() });
          // A paper casing under the ink, so the line reads over any tile.
          map.addLayer({
            id: 'commute-casing',
            type: 'line',
            source: LINE,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': paper, 'line-width': 7 },
          });
          map.addLayer({
            id: 'commute-route',
            type: 'line',
            source: LINE,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': ink, 'line-width': 3.5 },
          });
          map.addLayer({
            id: 'commute-ends',
            type: 'circle',
            source: ENDS,
            paint: {
              'circle-radius': 6,
              'circle-color': ['match', ['get', 'end'], 'start', paper, ink],
              'circle-stroke-width': 2.5,
              'circle-stroke-color': ink,
            },
          });
          fit(false);
        });
      } catch {
        status = 'unavailable';
        statusText = 'The map did not load.';
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

<div class="commute-map" class:unavailable={status === 'unavailable'}>
  <div class="canvas" bind:this={container} role="img" aria-label="Route of {label}. Hollow dot: start; filled dot: finish."></div>
  {#if status !== 'ready'}
    <p class="map-status" role="status">{statusText}</p>
  {/if}
</div>

<style>
  .commute-map {
    position: relative;
    height: 300px;
    border: 1px solid var(--line-strong);
    background: var(--bg-section);
  }
  .commute-map.unavailable {
    height: auto;
    min-height: 44px;
  }
  .canvas {
    position: absolute;
    inset: 0;
  }
  .map-status {
    position: absolute;
    inset: auto 10px 10px 10px;
    margin: 0;
    padding: 8px 10px;
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .unavailable .map-status {
    position: static;
    border: 0;
  }
  @media (max-width: 719px) {
    .commute-map {
      height: 220px;
    }
  }
</style>
