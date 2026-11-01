<script lang="ts" module>
  export interface MapPlace {
    name: string; detail: string | null; lat: number; lon: number; radiusM: number;
    /** The big place a split-out café or shop sits in. */
    parent?: { name: string; lat: number; lon: number; radiusM: number } | null;
  }
</script>

<script lang="ts">
  /**
   * A place on a map, in a pop-up: the destinations on /home/people/patterns
   * open here when clicked. The circle is the place as the trail knows it —
   * where a stay inside counts as being there — drawn in petrol ink over the
   * map, with its centre marked. A café or shop split out of a big place is a
   * dot in its parent's circle.
   *
   * The same mapbox-gl pattern as `CommuteMap`: the token from
   * `/api/maps/config`, mapbox-gl imported when the dialog first opens (it
   * touches `window`), its stylesheet as a `<link>`, the map a plain `let`.
   * A native <dialog>: Escape and the backdrop close it, and focus stays
   * inside while it is open.
   */
  import { untrack } from 'svelte';
  import type { GeoJSONSource, Map as GLMap } from 'mapbox-gl';
  import mapboxCssUrl from 'mapbox-gl/dist/mapbox-gl.css?url';
  import { circlePolygon } from '$lib/home/presence/geo';

  let { place, onclose }: { place: MapPlace | null; onclose: () => void } = $props();

  let status = $state<'loading' | 'ready' | 'unavailable'>('loading');
  let statusText = $state('Loading map…');

  // Not state: nothing in the template reads these.
  let dialog: HTMLDialogElement;
  let container: HTMLDivElement;
  let map: GLMap | null = null;
  let mapboxgl: typeof import('mapbox-gl').default | null = null;
  let loaded = false;
  let starting = false;

  const AREA = 'place-area';
  const DOT = 'place-dot';

  function token(name: string, fallback: string): string {
    const v = getComputedStyle(container).getPropertyValue(name).trim();
    return v || getComputedStyle(container).getPropertyValue(fallback).trim() || 'currentColor';
  }

  const ring = (c: { lat: number; lon: number; radiusM: number }) => ({
    type: 'Feature' as const, properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [circlePolygon(c.lat, c.lon, c.radiusM)] },
  });
  function areaData(p: MapPlace) {
    // A split-out stop shows its parent's circle; a place, its own.
    const c = p.parent ?? (p.radiusM >= 30 ? p : null);
    return { type: 'FeatureCollection' as const, features: c ? [ring(c)] : [] };
  }
  const dotData = (p: MapPlace) => ({
    type: 'FeatureCollection' as const,
    features: [{ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] } }],
  });

  function fit(p: MapPlace, animate: boolean) {
    if (!map || !mapboxgl) return;
    const c = p.parent ?? p;
    const b = new mapboxgl.LngLatBounds();
    for (const pt of circlePolygon(c.lat, c.lon, Math.max(c.radiusM, 120), 16)) b.extend(pt);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    map.fitBounds(b, { padding: 36, maxZoom: 17, duration: animate && !reduce ? 500 : 0 });
  }

  function draw(p: MapPlace) {
    if (!map || !loaded) return;
    (map.getSource(AREA) as GeoJSONSource | undefined)?.setData(areaData(p));
    (map.getSource(DOT) as GeoJSONSource | undefined)?.setData(dotData(p));
    map.resize();
    fit(p, false);
  }

  async function start(p: MapPlace) {
    starting = true;
    try {
      const res = await fetch('/api/maps/config', { headers: { accept: 'application/json' } });
      const cfg = (await res.json().catch(() => ({}))) as { accessToken?: string; token?: string; style?: string };
      const accessToken = cfg.accessToken ?? cfg.token;
      if (!res.ok || !accessToken) {
        status = 'unavailable';
        statusText = 'Map unavailable: the table has every figure.';
        return;
      }
      mapboxgl = (await import('mapbox-gl')).default;
      map = new mapboxgl.Map({
        container, accessToken,
        style: cfg.style ?? 'mapbox://styles/mapbox/outdoors-v12',
        center: [p.lon, p.lat], zoom: 15, maxZoom: 18, attributionControl: false,
      });
      map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
      map.on('error', () => {
        // Never echo the provider's message: its URLs carry the token.
        if (!loaded) { status = 'unavailable'; statusText = 'Map imagery unavailable.'; }
      });
      map.on('load', () => {
        if (!map) return;
        loaded = true;
        status = 'ready';
        const ink = token('--accent-ink', '--text-primary');
        const paper = token('--bg', '--surface-elevated');
        map.addSource(AREA, { type: 'geojson', data: areaData(p) });
        map.addSource(DOT, { type: 'geojson', data: dotData(p) });
        map.addLayer({ id: 'place-fill', type: 'fill', source: AREA, paint: { 'fill-color': ink, 'fill-opacity': 0.12 } });
        map.addLayer({ id: 'place-edge', type: 'line', source: AREA, paint: { 'line-color': ink, 'line-width': 2 } });
        map.addLayer({ id: 'place-dot', type: 'circle', source: DOT,
          paint: { 'circle-radius': 6, 'circle-color': ink, 'circle-stroke-width': 2.5, 'circle-stroke-color': paper } });
        // The dot is the newest place; a later open may have changed it.
        draw(current ?? p);
      });
    } catch {
      status = 'unavailable';
      statusText = 'The map did not load.';
    }
  }

  let current: MapPlace | null = null;
  $effect(() => {
    // Tracked: the place alone.
    const p = place;
    untrack(() => {
      current = p;
      if (!p) { if (dialog?.open) dialog.close(); return; }
      if (!dialog.open) dialog.showModal();
      if (!starting) void start(p);
      else draw(p);
    });
  });

  $effect(() => () => { map?.remove(); map = null; loaded = false; });

  const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
</script>

<svelte:head>
  <link rel="stylesheet" href={mapboxCssUrl} />
</svelte:head>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog class="pm" bind:this={dialog} aria-labelledby="pm-title" onclose={onclose} onclick={(e) => { if (e.target === dialog) dialog.close(); }}>
  <header>
    <div>
      <h3 id="pm-title">{place?.name ?? ''}</h3>
      {#if place}
        <p>{place.detail ?? ''}{place.detail ? ' · ' : ''}{place.parent ? `inside ${place.parent.name}` : `circle ${km(place.radiusM * 2)} across`}</p>
      {/if}
    </div>
    <button type="button" class="pm-close" onclick={() => dialog.close()} aria-label="Close the map">Close</button>
  </header>
  <div class="pm-map" class:unavailable={status === 'unavailable'}>
    <div class="canvas" bind:this={container} role="img" aria-label={place ? `${place.name} on a map${place.parent ? `, inside ${place.parent.name}` : ''}` : 'Map'}></div>
    {#if status !== 'ready'}<p class="map-status" role="status">{statusText}</p>{/if}
  </div>
</dialog>

<style>
  /* The site's reset zeroes every margin, which pins a modal dialog to the top left: centre it again. */
  .pm {
    position: fixed;
    inset: 0;
    margin: auto;
    height: fit-content;
    width: min(720px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--surface-card);
    color: var(--text-primary);
  }
  .pm::backdrop {
    background: color-mix(in srgb, var(--text-primary) 45%, transparent);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px 10px;
  }
  h3 {
    margin: 0;
    font: var(--fs-body) var(--font-display);
  }
  header p {
    margin: 2px 0 0;
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-muted);
  }
  .pm-close {
    font: 500 var(--fs-label) var(--font-mono);
    padding: 5px 10px;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
  }
  .pm-close:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .pm-map {
    position: relative;
    height: min(440px, 60vh);
    border-top: 1px solid var(--line-strong);
    background: var(--bg-section);
  }
  .pm-map.unavailable {
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
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-secondary);
  }
  .unavailable .map-status {
    position: static;
    border: 0;
  }
</style>
