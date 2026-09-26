<script lang="ts">
  /**
   * One day's recorded track — "Your day" on /home/people/[subject]. The same
   * mapbox-gl pattern as `CommuteMap` (token from `/api/maps/config`,
   * mapbox-gl imported inside onMount, its stylesheet as a `<link>`, the map
   * a plain `let`), drawing what the pilot's retired Movement map drew:
   *
   *  - continuous recording as a solid petrol line on a paper casing;
   *  - a DASHED hop between segments, where the phone slept (more than the
   *    600 s gap) and the route is not known — never a solid line;
   *  - a lone fix as a small ring; the day's first fix hollow, its last filled;
   *  - the timeline's cursor as an accent dot, only when a fix is near enough
   *    in time to say where they were.
   */
  import { onMount, untrack } from 'svelte';
  import type { GeoJSONSource, Map as GLMap } from 'mapbox-gl';
  import type { Feature, FeatureCollection } from 'geojson';
  import mapboxCssUrl from 'mapbox-gl/dist/mapbox-gl.css?url';
  import type { DayPoint } from '$lib/home/presence/companion-accounts';
  import { trackShapes } from '$lib/home/presence/day-timeline';

  let {
    points,
    segments,
    cursor = null,
    label,
  }: { points: DayPoint[]; segments: Array<[number, number]>; cursor?: DayPoint | null; label: string } = $props();

  let status = $state<'loading' | 'ready' | 'unavailable'>('loading');
  let statusText = $state('Loading map…');

  // Not state: nothing in the template reads these.
  let container: HTMLDivElement;
  let map: GLMap | null = null;
  let mapboxgl: typeof import('mapbox-gl').default | null = null;
  let loaded = false;

  const LINES = 'day-lines';
  const GAPS = 'day-gaps';
  const MARKS = 'day-marks';
  const CURSOR = 'day-cursor';

  function token(name: string, fallback: string): string {
    const v = getComputedStyle(container).getPropertyValue(name).trim();
    return v || getComputedStyle(container).getPropertyValue(fallback).trim() || 'currentColor';
  }

  const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });

  function shapesData() {
    const s = trackShapes(points, segments);
    const lines = fc(s.lines.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })));
    const gaps = fc(s.gaps.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })));
    const marks: Feature[] = s.lone.map((c) => ({ type: 'Feature', properties: { kind: 'lone' }, geometry: { type: 'Point', coordinates: c } }));
    if (s.start) marks.push({ type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: s.start } });
    if (s.end && points.length > 1) marks.push({ type: 'Feature', properties: { kind: 'end' }, geometry: { type: 'Point', coordinates: s.end } });
    return { lines, gaps, marks: fc(marks) };
  }

  function cursorData() {
    return fc(cursor ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [cursor[0], cursor[1]] } }] : []);
  }

  function fit(animate: boolean) {
    if (!map || !mapboxgl || !points.length) return;
    const b = new mapboxgl.LngLatBounds();
    for (const p of points) b.extend([p[0], p[1]]);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    map.fitBounds(b, { padding: 32, maxZoom: 16, duration: animate && !reduce ? 600 : 0 });
  }

  function renderTrack() {
    if (!map || !loaded) return;
    const d = shapesData();
    (map.getSource(LINES) as GeoJSONSource | undefined)?.setData(d.lines);
    (map.getSource(GAPS) as GeoJSONSource | undefined)?.setData(d.gaps);
    (map.getSource(MARKS) as GeoJSONSource | undefined)?.setData(d.marks);
    fit(true);
  }

  function renderCursor() {
    if (!map || !loaded) return;
    (map.getSource(CURSOR) as GeoJSONSource | undefined)?.setData(cursorData());
  }

  $effect(() => {
    // Tracked: the track alone. The body writes no state.
    void points;
    void segments;
    untrack(renderTrack);
  });

  $effect(() => {
    void cursor;
    untrack(renderCursor);
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
          statusText = 'Map unavailable — the timeline below still reads the day.';
          return;
        }
        const mod = await import('mapbox-gl');
        if (cancelled) return;
        mapboxgl = mod.default;
        map = new mapboxgl.Map({
          container,
          accessToken,
          style: cfg.style ?? 'mapbox://styles/mapbox/outdoors-v12',
          center: points[0] ? [points[0][0], points[0][1]] : [-1.5, 53],
          zoom: points.length ? 12 : 5,
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
          const accent = token('--accent', '--text-primary');
          const muted = token('--text-secondary', '--text-primary');
          const d = shapesData();
          map.addSource(LINES, { type: 'geojson', data: d.lines });
          map.addSource(GAPS, { type: 'geojson', data: d.gaps });
          map.addSource(MARKS, { type: 'geojson', data: d.marks });
          map.addSource(CURSOR, { type: 'geojson', data: cursorData() });
          // Gaps first, underneath: the phone was asleep, the route unknown.
          map.addLayer({
            id: 'day-gaps',
            type: 'line',
            source: GAPS,
            layout: { 'line-cap': 'butt' },
            paint: { 'line-color': muted, 'line-width': 2, 'line-dasharray': [2, 2.5], 'line-opacity': 0.85 },
          });
          map.addLayer({
            id: 'day-casing',
            type: 'line',
            source: LINES,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': paper, 'line-width': 7 },
          });
          map.addLayer({
            id: 'day-line',
            type: 'line',
            source: LINES,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': ink, 'line-width': 3.5 },
          });
          map.addLayer({
            id: 'day-marks',
            type: 'circle',
            source: MARKS,
            paint: {
              'circle-radius': ['match', ['get', 'kind'], 'lone', 3.5, 6],
              'circle-color': ['match', ['get', 'kind'], 'end', ink, paper],
              'circle-stroke-width': ['match', ['get', 'kind'], 'lone', 1.5, 2.5],
              'circle-stroke-color': ink,
            },
          });
          map.addLayer({
            id: 'day-cursor',
            type: 'circle',
            source: CURSOR,
            paint: { 'circle-radius': 7, 'circle-color': accent, 'circle-stroke-width': 2.5, 'circle-stroke-color': paper },
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

<div class="day-map" class:unavailable={status === 'unavailable'}>
  <div
    class="canvas"
    bind:this={container}
    role="img"
    aria-label="{label}. Solid line: recorded track; dashed: the phone was asleep. Hollow dot: first fix; filled: last."
  ></div>
  {#if status !== 'ready'}
    <p class="map-status" role="status">{statusText}</p>
  {/if}
</div>

<style>
  .day-map {
    position: relative;
    height: 360px;
    border: 1px solid var(--line-strong);
    background: var(--bg-section);
  }
  .day-map.unavailable {
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
    .day-map {
      height: 240px;
    }
  }
</style>
