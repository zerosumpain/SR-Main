<script lang="ts" module>
  import type { LatLng } from '$lib/trips/model';

  export interface MapDay {
    date: string;
    label: string;
    stops: Array<{ id: string; title: string; location: LatLng; n: number }>;
    legs: Array<{ line: LatLng[] | null; from: LatLng; to: LatLng }>;
  }
</script>

<script lang="ts">
  /**
   * The trip's plan on one map, coloured by day — the same mapbox-gl pattern
   * as `$lib/components/home/DayMap` (browser token from `/api/maps/config`,
   * mapbox-gl imported inside onMount, its stylesheet as a `<link>`, the map a
   * plain `let`).
   *
   * Colour is never the only code: the site's categorical ramp has four hues
   * (`--chart-cat-1…4`), so days five to eight reuse them DASHED, every stop
   * carries its day and position as a label ("2·3"), and the legend under the
   * map names each day. A leg with no routed line is drawn straight and
   * dotted. Suggestions are hollow rings.
   *
   * v8: a proposal's preview is drawn as a GHOST over the plan — its solved
   * days in a dashed ink line with hollow numbered pins — so "Preview" shows
   * where the day would go before anything changes.
   */
  import { onMount, untrack } from 'svelte';
  import type { GeoJSONSource, Map as GLMap } from 'mapbox-gl';
  import type { Feature, FeatureCollection } from 'geojson';
  import mapboxCssUrl from 'mapbox-gl/dist/mapbox-gl.css?url';
  import type { Snippet } from 'svelte';
  let {
    days,
    suggestions = [],
    focus = null,
    ghost = [],
    fallback,
  }: {
    days: MapDay[];
    suggestions?: Array<{ title: string; location: LatLng }>;
    focus?: string | null;
    /** v8: a proposal's preview — drawn dashed and hollow over the plan. */
    ghost?: MapDay[];
    /** Drawn instead of the status line when there is no map (no token on this server). */
    fallback?: Snippet;
  } = $props();

  let status = $state<'loading' | 'ready' | 'unavailable'>('loading');
  let statusText = $state('Loading map…');
  let container: HTMLDivElement;
  let map: GLMap | null = null;
  let mapboxgl: typeof import('mapbox-gl').default | null = null;
  let loaded = false;

  const SRC_ROUTED = 'trip-routed';
  const SRC_STRAIGHT = 'trip-straight';
  const SRC_STOPS = 'trip-stops';
  const SRC_SUGGEST = 'trip-suggest';
  const SRC_GHOST_LINES = 'trip-ghost-lines';
  const SRC_GHOST_STOPS = 'trip-ghost-stops';

  const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });
  const pair = (p: LatLng): [number, number] => [p.lng, p.lat];

  function shown(): MapDay[] {
    return focus ? days.filter((d) => d.date === focus) : days;
  }

  function data() {
    const routed: Feature[] = [];
    const straight: Feature[] = [];
    const stops: Feature[] = [];
    days.forEach((day, i) => {
      if (focus && day.date !== focus) return;
      const props = { slot: i % 4, dashed: i >= 4 ? 1 : 0 };
      for (const leg of day.legs) {
        const coords = leg.line && leg.line.length > 1 ? leg.line.map(pair) : [pair(leg.from), pair(leg.to)];
        (leg.line && leg.line.length > 1 ? routed : straight).push({
          type: 'Feature',
          properties: props,
          geometry: { type: 'LineString', coordinates: coords },
        });
      }
      for (const s of day.stops) {
        stops.push({
          type: 'Feature',
          properties: { ...props, label: `${i + 1}·${s.n}`, title: s.title },
          geometry: { type: 'Point', coordinates: pair(s.location) },
        });
      }
    });
    const suggest = suggestions.map(
      (s): Feature => ({ type: 'Feature', properties: { title: s.title }, geometry: { type: 'Point', coordinates: pair(s.location) } }),
    );
    const ghostLines: Feature[] = [];
    const ghostStops: Feature[] = [];
    for (const day of ghost) {
      for (const leg of day.legs) {
        const coords = leg.line && leg.line.length > 1 ? leg.line.map(pair) : [pair(leg.from), pair(leg.to)];
        ghostLines.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
      }
      for (const s of day.stops) {
        ghostStops.push({ type: 'Feature', properties: { label: String(s.n), title: s.title }, geometry: { type: 'Point', coordinates: pair(s.location) } });
      }
    }
    return { routed: fc(routed), straight: fc(straight), stops: fc(stops), suggest: fc(suggest), ghostLines: fc(ghostLines), ghostStops: fc(ghostStops) };
  }

  function fit(animate: boolean) {
    if (!map || !mapboxgl) return;
    const pts = shown().flatMap((d) => d.stops.map((s) => s.location));
    for (const g of ghost) for (const s of g.stops) pts.push(s.location);
    if (!pts.length) for (const s of suggestions) pts.push(s.location);
    if (!pts.length) return;
    const b = new mapboxgl.LngLatBounds();
    for (const p of pts) b.extend(pair(p));
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    map.fitBounds(b, { padding: 40, maxZoom: 16, duration: animate && !reduce ? 500 : 0 });
  }

  function render() {
    if (!map || !loaded) return;
    const d = data();
    (map.getSource(SRC_ROUTED) as GeoJSONSource | undefined)?.setData(d.routed);
    (map.getSource(SRC_STRAIGHT) as GeoJSONSource | undefined)?.setData(d.straight);
    (map.getSource(SRC_STOPS) as GeoJSONSource | undefined)?.setData(d.stops);
    (map.getSource(SRC_SUGGEST) as GeoJSONSource | undefined)?.setData(d.suggest);
    (map.getSource(SRC_GHOST_LINES) as GeoJSONSource | undefined)?.setData(d.ghostLines);
    (map.getSource(SRC_GHOST_STOPS) as GeoJSONSource | undefined)?.setData(d.ghostStops);
    fit(true);
  }

  $effect(() => {
    // Tracked: the inputs alone. The body writes no state.
    void days;
    void suggestions;
    void focus;
    void ghost;
    untrack(render);
  });

  function cssVar(name: string): string {
    return getComputedStyle(container).getPropertyValue(name).trim() || 'currentColor';
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/maps/config', { headers: { accept: 'application/json' } });
        const cfg = (await res.json().catch(() => ({}))) as { accessToken?: string; token?: string; style?: string };
        const accessToken = cfg.accessToken ?? cfg.token;
        if (!res.ok || !accessToken) {
          status = 'unavailable';
          statusText = 'Map unavailable — the day-by-day plan below has every stop and time.';
          return;
        }
        const mod = await import('mapbox-gl');
        if (cancelled) return;
        mapboxgl = mod.default;
        const first = days[0]?.stops[0]?.location ?? suggestions[0]?.location;
        map = new mapboxgl.Map({
          container,
          accessToken,
          style: cfg.style ?? 'mapbox://styles/mapbox/streets-v12',
          center: first ? pair(first) : [12.48, 41.9],
          zoom: first ? 13 : 4,
          maxZoom: 18,
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
          const hue = ['match', ['get', 'slot'], 0, cssVar('--chart-cat-1'), 1, cssVar('--chart-cat-2'), 2, cssVar('--chart-cat-3'), cssVar('--chart-cat-4')];
          const paper = cssVar('--bg');
          const ink = cssVar('--text-primary');
          const d = data();
          map.addSource(SRC_ROUTED, { type: 'geojson', data: d.routed });
          map.addSource(SRC_STRAIGHT, { type: 'geojson', data: d.straight });
          map.addSource(SRC_STOPS, { type: 'geojson', data: d.stops });
          map.addSource(SRC_SUGGEST, { type: 'geojson', data: d.suggest });
          map.addSource(SRC_GHOST_LINES, { type: 'geojson', data: d.ghostLines });
          map.addSource(SRC_GHOST_STOPS, { type: 'geojson', data: d.ghostStops });
          map.addLayer({
            id: 'trip-casing',
            type: 'line',
            source: SRC_ROUTED,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': paper, 'line-width': 7 },
          });
          map.addLayer({
            id: 'trip-routed-solid',
            type: 'line',
            source: SRC_ROUTED,
            filter: ['==', ['get', 'dashed'], 0],
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': hue as never, 'line-width': 4 },
          });
          map.addLayer({
            id: 'trip-routed-dashed',
            type: 'line',
            source: SRC_ROUTED,
            filter: ['==', ['get', 'dashed'], 1],
            paint: { 'line-color': hue as never, 'line-width': 4, 'line-dasharray': [2, 1.5] },
          });
          map.addLayer({
            id: 'trip-straight',
            type: 'line',
            source: SRC_STRAIGHT,
            paint: { 'line-color': hue as never, 'line-width': 2.5, 'line-dasharray': [0.6, 1.8], 'line-opacity': 0.9 },
          });
          map.addLayer({
            id: 'trip-suggest',
            type: 'circle',
            source: SRC_SUGGEST,
            paint: { 'circle-radius': 6, 'circle-color': paper, 'circle-opacity': 0.4, 'circle-stroke-width': 2, 'circle-stroke-color': ink },
          });
          map.addLayer({
            id: 'trip-stops',
            type: 'circle',
            source: SRC_STOPS,
            paint: { 'circle-radius': 11, 'circle-color': hue as never, 'circle-stroke-width': 2, 'circle-stroke-color': paper },
          });
          map.addLayer({
            id: 'trip-stop-labels',
            type: 'symbol',
            source: SRC_STOPS,
            layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-allow-overlap': true },
            paint: { 'text-color': paper },
          });
          // The ghost: a proposal's preview, over the plan.
          map.addLayer({
            id: 'trip-ghost-casing',
            type: 'line',
            source: SRC_GHOST_LINES,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': paper, 'line-width': 6, 'line-opacity': 0.8 },
          });
          map.addLayer({
            id: 'trip-ghost-line',
            type: 'line',
            source: SRC_GHOST_LINES,
            paint: { 'line-color': ink, 'line-width': 3, 'line-dasharray': [1.4, 1.2] },
          });
          map.addLayer({
            id: 'trip-ghost-stops',
            type: 'circle',
            source: SRC_GHOST_STOPS,
            paint: { 'circle-radius': 10, 'circle-color': paper, 'circle-opacity': 0.92, 'circle-stroke-width': 2.5, 'circle-stroke-color': ink },
          });
          map.addLayer({
            id: 'trip-ghost-labels',
            type: 'symbol',
            source: SRC_GHOST_STOPS,
            layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-allow-overlap': true },
            paint: { 'text-color': ink },
          });
          map.on('click', 'trip-stops', (e) => {
            const f = e.features?.[0];
            if (!f || !mapboxgl || !map) return;
            new mapboxgl.Popup({ closeButton: false })
              .setLngLat(e.lngLat)
              .setText(`${f.properties?.label} ${f.properties?.title}`)
              .addTo(map);
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

{#if status === 'unavailable' && fallback}
  {@render fallback()}
{/if}
<div class="trip-map" class:unavailable={status === 'unavailable'} class:replaced={status === 'unavailable' && !!fallback}>
  <div
    class="canvas"
    bind:this={container}
    role="img"
    aria-label="Map of the plan. Each day has its own colour; labels read day·stop. Dotted lines are not yet routed. Hollow rings are suggestions."
  ></div>
  {#if status !== 'ready'}
    <p class="map-status" role="status">{statusText}</p>
  {/if}
</div>
<ul class="legend" aria-label="Days on the map">
  {#each days as day, i (day.date)}
    {#if !focus || day.date === focus}<li>
      <span class="swatch" class:dashed={i >= 4} style="--swatch: var(--chart-cat-{(i % 4) + 1})"></span>
      <span class="mono">{i + 1}</span> {day.label}
    </li>{/if}
  {/each}
  {#if suggestions.length}<li><span class="swatch ring"></span> suggestion</li>{/if}
  {#if ghost.length}<li class="ghost-key"><span class="swatch ghost"></span> proposed (dashed, hollow pins)</li>{/if}
</ul>

<style>
  .trip-map {
    position: relative;
    height: 420px;
    border: 1px solid var(--line-strong);
    background: var(--bg-section);
  }
  .trip-map.unavailable {
    height: auto;
    min-height: 44px;
  }
  .trip-map.replaced {
    display: none;
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
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    display: inline-block;
    width: 22px;
    height: 0;
    border-top: 4px solid var(--swatch);
  }
  .swatch.dashed {
    border-top-style: dashed;
  }
  .swatch.ghost {
    border-top: 3px dashed var(--text-primary);
  }
  .ghost-key {
    font-weight: 600;
    color: var(--text-primary);
  }
  .swatch.ring {
    width: 10px;
    height: 10px;
    border: 2px solid var(--text-primary);
    border-radius: 100px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  @media (max-width: 719px) {
    .trip-map {
      height: 300px;
    }
  }
</style>
