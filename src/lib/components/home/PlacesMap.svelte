<script lang="ts" module>
  export interface MapPlace {
    id: string;
    label: string | null;
    lat: number;
    lon: number;
    radiusM: number;
    isHome: boolean;
    /** Label priority when names collide: busier places keep theirs. */
    visitCount?: number;
  }
  export interface Geometry {
    lat: number;
    lon: number;
    radiusM: number;
  }
</script>

<script lang="ts">
  /**
   * The places on a map — /home/people/places.
   *
   * Every place is a circle (a 64-sided polygon: Mapbox has no geodesic
   * circle). Clicking one selects it. While the page holds a `draft` geometry
   * for the selected place (or a new one), two handles appear: the centre
   * (drag to move the circle) and an east-edge handle (drag to set the radius,
   * the handle's distance from the centre, 50–2000 m). Every drag reports the
   * new geometry through `ondraft`; the page owns the draft, Save and Cancel.
   *
   * It opens on home and the places near it (within 15 km), not on every
   * place ever named: one far-off holiday cottage would otherwise zoom the
   * whole map out until the 50 m circles vanish. "Show all places" (the
   * page's button, `fitAll`) takes it back out. Zoomed out past 13 a place
   * is a dot rather than a circle, and a name that would sit on top of a
   * busier place's name is hidden until there is room for it.
   *
   * The map is an enhancement. The list beside it selects and edits every
   * place without it, so a missing token or a blocked tile server leaves the
   * page fully usable.
   *
   * mapbox-gl touches `window` at import, so it is imported inside onMount,
   * never at module level. Its stylesheet goes in as a `<link>` (a `?url`
   * import) rather than a CSS import, which the PWA build does not tolerate
   * from a component. The map, markers and handles are plain `let`s, not
   * state: nothing in the template reads them.
   */
  import { onMount, untrack } from 'svelte';
  import type { GeoJSONSource, Map as GLMap, Marker } from 'mapbox-gl';
  import mapboxCssUrl from 'mapbox-gl/dist/mapbox-gl.css?url';
  import { circlePolygon, clampRadius, destinationPoint, distanceM } from '$lib/home/presence/geo';

  let {
    places,
    selectedId = null,
    draft = null,
    placing = false,
    onselect,
    ondraft,
    onplace,
    onstatus,
  }: {
    places: MapPlace[];
    selectedId?: string | null;
    /** The geometry being edited: the selected place's, or a new place's
     *  when `selectedId` is null. Null = not editing, no handles. */
    draft?: Geometry | null;
    /** The next click on the map drops a new place there. */
    placing?: boolean;
    onselect?: (id: string) => void;
    ondraft?: (g: Geometry) => void;
    onplace?: (lat: number, lon: number) => void;
    /** Whether the map can be used — the page gates "Add a place" on it. */
    onstatus?: (s: 'loading' | 'ready' | 'unavailable') => void;
  } = $props();

  let status = $state<'loading' | 'ready' | 'unavailable'>('loading');

  /** Set and report the map's status in one place. */
  function setStatus(s: 'loading' | 'ready' | 'unavailable', text?: string) {
    status = s;
    if (text) statusText = text;
    onstatus?.(s);
  }
  let statusText = $state('Loading map…');

  // Not state: nothing in the template reads these.
  let container: HTMLDivElement;
  let map: GLMap | null = null;
  let mapboxgl: typeof import('mapbox-gl').default | null = null;
  let loaded = false;
  let centreHandle: Marker | null = null;
  let edgeHandle: Marker | null = null;
  let labels = new Map<string, Marker>();
  let labelKey = '';
  let dragging: 'centre' | 'edge' | null = null;
  let lastFitted: string | null | undefined = undefined;

  const SOURCE = 'places';
  const POINTS = 'places-points';
  /** The opening view keeps to places this close to home… */
  const NEAR_HOME_M = 15_000;
  /** …when there are at least this many of them; otherwise it shows all. */
  const NEAR_MIN = 3;
  /** Above this zoom a place is a circle; below it, a dot. */
  const CIRCLE_MIN_ZOOM = 13;
  /** Below this zoom only home's and the selected place's names show. */
  const LABELS_MIN_ZOOM = 11;
  /** The label sits this far under the place's centre (the marker offset). */
  const LABEL_OFFSET_Y = 14;

  /** A design token's current value. The map paints in the page's colours
   *  rather than its own, and a reading theme changes them. */
  function token(name: string, fallback: string): string {
    const v = getComputedStyle(container).getPropertyValue(name).trim();
    return v || getComputedStyle(container).getPropertyValue(fallback).trim() || 'currentColor';
  }

  /** Where the map centre is now, for "drop a place here" without a click. */
  export function centre(): { lat: number; lon: number } | null {
    if (!map) return null;
    const c = map.getCenter();
    return { lat: c.lat, lon: c.lng };
  }

  /** Take the map back out to every named place and home. */
  export function fitAll(): void {
    fit(places.filter((p) => p.label || p.isHome), true);
  }

  /** The view the page opens on: home and the named places within 15 km of
   *  it, or everything when fewer than three are that close. */
  function openingView(): Geometry[] {
    const all = places.filter((p) => p.label || p.isHome);
    const home = places.find((p) => p.isHome);
    if (!home) return all;
    const near = all.filter((p) => !p.isHome && distanceM(home.lat, home.lon, p.lat, p.lon) <= NEAR_HOME_M);
    return near.length >= NEAR_MIN ? [home, ...near] : all;
  }

  function shown(): Array<MapPlace & { selected: boolean; draftNew?: boolean }> {
    const out: Array<MapPlace & { selected: boolean; draftNew?: boolean }> = places.map((p) =>
      p.id === selectedId && draft ? { ...p, ...draft, selected: true } : { ...p, selected: p.id === selectedId },
    );
    if (draft && !selectedId) {
      out.push({ id: '__new', label: null, isHome: false, ...draft, selected: true, draftNew: true });
    }
    return out;
  }

  function featureCollection() {
    // Selected last, so it paints on top of anything it overlaps.
    const items = shown().sort((a, b) => Number(a.selected) - Number(b.selected));
    return {
      type: 'FeatureCollection' as const,
      features: items.map((p) => ({
        type: 'Feature' as const,
        properties: { id: p.id, selected: p.selected, radiusM: p.radiusM },
        geometry: { type: 'Polygon' as const, coordinates: [circlePolygon(p.lat, p.lon, p.radiusM)] },
      })),
    };
  }

  /** The same places as dots, for the zooms where a circle is too small. */
  function pointCollection() {
    const items = shown().sort((a, b) => Number(a.selected) - Number(b.selected));
    return {
      type: 'FeatureCollection' as const,
      features: items.map((p) => ({
        type: 'Feature' as const,
        properties: { id: p.id, selected: p.selected },
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      })),
    };
  }

  /**
   * Hide any name that would overlap one already placed, in priority order:
   * the selected place, home, then the most visited. Below zoom 11 only home
   * and the selected place are named at all. Reads the label elements' sizes
   * (plain DOM, not state), so it runs after a move and after a redraw.
   */
  function declutter() {
    if (!map) return;
    const zoom = map.getZoom();
    const items = shown().filter((p) => labels.has(p.id));
    const rank = (p: (typeof items)[number]) => (p.selected ? 0 : p.isHome ? 1 : 2);
    items.sort((a, b) => rank(a) - rank(b) || (b.visitCount ?? 0) - (a.visitCount ?? 0));
    const placed: Array<{ l: number; t: number; r: number; b: number }> = [];
    const PAD = 3;
    for (const p of items) {
      const el = labels.get(p.id)!.getElement();
      let show = zoom >= LABELS_MIN_ZOOM || p.selected || p.isHome;
      if (show) {
        const at = map.project([p.lon, p.lat]);
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const box = { l: at.x - w / 2 - PAD, r: at.x + w / 2 + PAD, t: at.y + LABEL_OFFSET_Y - PAD, b: at.y + LABEL_OFFSET_Y + h + PAD };
        if (placed.some((o) => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)) show = false;
        else placed.push(box);
      }
      el.classList.toggle('hidden', !show);
    }
  }

  function boundsOf(items: Geometry[]) {
    if (!mapboxgl || !items.length) return null;
    const b = new mapboxgl.LngLatBounds();
    for (const g of items) {
      for (const bearing of [0, 90, 180, 270]) {
        const p = destinationPoint(g.lat, g.lon, g.radiusM, bearing);
        b.extend([p.lon, p.lat]);
      }
    }
    return b;
  }

  function fit(items: Geometry[], animate: boolean) {
    const b = boundsOf(items);
    if (!map || !b) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    map.fitBounds(b, { padding: 48, maxZoom: 17, duration: animate && !reduce ? 700 : 0 });
  }

  function handleEl(kind: 'centre' | 'edge'): HTMLElement {
    const el = document.createElement('div');
    el.className = `pm-handle pm-${kind}`;
    el.setAttribute('aria-hidden', 'true');
    el.title = kind === 'centre' ? 'Drag to move' : 'Drag to set the radius';
    return el;
  }

  function syncHandles(g: Geometry | null) {
    if (!map || !mapboxgl) return;
    if (!g) {
      centreHandle?.remove();
      edgeHandle?.remove();
      centreHandle = edgeHandle = null;
      return;
    }
    const edge = destinationPoint(g.lat, g.lon, g.radiusM, 90);
    if (!centreHandle) {
      centreHandle = new mapboxgl.Marker({ element: handleEl('centre'), draggable: true }).setLngLat([g.lon, g.lat]).addTo(map);
      centreHandle.on('dragstart', () => (dragging = 'centre'));
      centreHandle.on('drag', () => {
        const at = centreHandle!.getLngLat();
        ondraft?.({ lat: at.lat, lon: at.lng, radiusM: draft?.radiusM ?? g.radiusM });
      });
      centreHandle.on('dragend', () => {
        dragging = null;
        syncHandles(draft);
      });
    }
    if (!edgeHandle) {
      edgeHandle = new mapboxgl.Marker({ element: handleEl('edge'), draggable: true }).setLngLat([edge.lon, edge.lat]).addTo(map);
      edgeHandle.on('dragstart', () => (dragging = 'edge'));
      edgeHandle.on('drag', () => {
        if (!draft) return;
        const at = edgeHandle!.getLngLat();
        ondraft?.({ lat: draft.lat, lon: draft.lon, radiusM: clampRadius(distanceM(draft.lat, draft.lon, at.lat, at.lng)) });
      });
      edgeHandle.on('dragend', () => {
        dragging = null;
        // Snap back onto the circle: a drag past 2 km leaves the pointer
        // somewhere the radius is not.
        syncHandles(draft);
      });
    }
    if (dragging !== 'centre') centreHandle.setLngLat([g.lon, g.lat]);
    if (dragging !== 'edge') edgeHandle.setLngLat([edge.lon, edge.lat]);
  }

  /** A name under each circle, in the page's mono face (map glyphs would be
   *  the style's font, not ours). Rebuilt when the names change; moved, not
   *  rebuilt, when a centre is dragged. */
  function syncLabels() {
    if (!map || !mapboxgl) return;
    const key = places.map((p) => `${p.id}|${p.label}`).join(';');
    if (key !== labelKey) {
      labelKey = key;
      for (const m of labels.values()) m.remove();
      labels = new Map(
        places.map((p) => {
          const el = document.createElement('span');
          el.className = 'pm-label';
          el.textContent = p.label ?? (p.isHome ? 'home' : 'unnamed');
          return [p.id, new mapboxgl!.Marker({ element: el, anchor: 'top', offset: [0, LABEL_OFFSET_Y] }).setLngLat([p.lon, p.lat]).addTo(map!)];
        }),
      );
    }
    for (const p of shown()) labels.get(p.id)?.setLngLat([p.lon, p.lat]);
  }

  function render() {
    if (!map || !loaded) return;
    (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(featureCollection());
    (map.getSource(POINTS) as GeoJSONSource | undefined)?.setData(pointCollection());
    syncLabels();
    declutter();
    syncHandles(draft);
    map.getCanvas().style.cursor = placing ? 'crosshair' : '';
    // Fly to a newly selected place; not on every drag of it.
    if (selectedId !== lastFitted) {
      lastFitted = selectedId;
      const p = places.find((x) => x.id === selectedId);
      if (p) fit([draft && selectedId === p.id ? draft : p], true);
    }
  }

  $effect(() => {
    // Tracked: the props that change what is drawn. The body reads nothing
    // it writes to (it writes no state at all), but untrack keeps the map
    // calls from subscribing to anything else by accident.
    void [places, selectedId, draft, placing];
    untrack(render);
  });

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/maps/config', { headers: { accept: 'application/json' } });
        const cfg = (await res.json().catch(() => ({}))) as { accessToken?: string; token?: string; style?: string; message?: string };
        const accessToken = cfg.accessToken ?? cfg.token;
        if (!res.ok || !accessToken) {
          setStatus('unavailable', cfg.message ?? 'The map is unavailable. The list still does everything.');
          return;
        }
        const mod = await import('mapbox-gl');
        if (cancelled) return;
        mapboxgl = mod.default;
        const home = places.find((p) => p.isHome) ?? places[0];
        map = new mapboxgl.Map({
          container,
          accessToken,
          style: cfg.style ?? 'mapbox://styles/mapbox/outdoors-v12',
          center: home ? [home.lon, home.lat] : [-1.5, 53],
          zoom: home ? 13 : 5,
          maxZoom: 19,
          attributionControl: false,
        });
        map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
        map.on('error', () => {
          // Never echo the provider's message: its URLs carry the token.
          if (!loaded) setStatus('unavailable', 'Map imagery unavailable. The list still does everything.');
        });
        map.on('load', () => {
          if (!map) return;
          loaded = true;
          setStatus('ready');
          const accent = token('--accent', '--text-primary');
          const ink = token('--accent-ink', '--text-primary');
          map.addSource(SOURCE, { type: 'geojson', data: featureCollection() });
          map.addSource(POINTS, { type: 'geojson', data: pointCollection() });
          map.addLayer({
            id: 'places-fill',
            type: 'fill',
            source: SOURCE,
            minzoom: CIRCLE_MIN_ZOOM,
            paint: {
              'fill-color': ['case', ['get', 'selected'], accent, ink],
              'fill-opacity': ['case', ['get', 'selected'], 0.22, 0.12],
            },
          });
          map.addLayer({
            id: 'places-line',
            type: 'line',
            source: SOURCE,
            minzoom: CIRCLE_MIN_ZOOM,
            paint: {
              'line-color': ['case', ['get', 'selected'], accent, ink],
              'line-width': ['case', ['get', 'selected'], 3, 1.5],
            },
          });
          // Zoomed out, a 50 m circle is a speck: the place is a dot instead.
          // The ranges overlap by a zoom so a place is never neither.
          map.addLayer({
            id: 'places-point',
            type: 'circle',
            source: POINTS,
            maxzoom: CIRCLE_MIN_ZOOM + 1,
            paint: {
              'circle-radius': 6,
              'circle-color': ['case', ['get', 'selected'], accent, ink],
              'circle-stroke-width': 2,
              'circle-stroke-color': token('--bg', '--surface-elevated'),
            },
          });
          map.on('click', 'places-fill', (e) => {
            if (placing || !e.features?.length) return;
            // Overlapping circles: the smallest is the one you meant.
            const hit = [...e.features].sort(
              (a, b) => Number(a.properties?.radiusM ?? 0) - Number(b.properties?.radiusM ?? 0),
            )[0];
            const id = String(hit.properties?.id ?? '');
            if (id && id !== '__new') onselect?.(id);
          });
          map.on('click', 'places-point', (e) => {
            if (placing || !e.features?.length) return;
            // The dot drawn last is on top, and the selected one is drawn last.
            const id = String(e.features[0].properties?.id ?? '');
            if (id && id !== '__new') onselect?.(id);
          });
          map.on('moveend', declutter);
          map.on('click', (e) => {
            if (placing) onplace?.(e.lngLat.lat, e.lngLat.lng);
          });
          for (const layer of ['places-fill', 'places-point']) {
            map.on('mouseenter', layer, () => {
              if (map && !placing) map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', layer, () => {
              if (map) map.getCanvas().style.cursor = placing ? 'crosshair' : '';
            });
          }
          lastFitted = selectedId;
          const start = openingView();
          if (start.length) fit(start, false);
          render();
        });
      } catch {
        setStatus('unavailable', 'The map did not load. The list still does everything.');
      }
    })();
    return () => {
      cancelled = true;
      for (const m of labels.values()) m.remove();
      labels = new Map();
      centreHandle = edgeHandle = null;
      map?.remove();
      map = null;
      loaded = false;
    };
  });
</script>

<svelte:head>
  <link rel="stylesheet" href={mapboxCssUrl} />
</svelte:head>

<div class="places-map" class:placing>
  <div
    class="canvas"
    bind:this={container}
    role="region"
    aria-label="Map of the household's places. Select and edit each place from the list as well."
  ></div>
  {#if status !== 'ready'}
    <p class="map-status" role="status">{statusText}</p>
  {/if}
</div>

<style>
  .places-map {
    position: relative;
    height: 100%;
    min-height: 320px;
    border: 1px solid var(--line-strong);
    background: var(--bg-section);
  }
  .canvas {
    position: absolute;
    inset: 0;
  }
  .map-status {
    position: absolute;
    inset: auto 12px 12px 12px;
    margin: 0;
    padding: 10px 12px;
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  /* Marker elements are made by mapbox-gl, outside Svelte's scoping. */
  .places-map :global(.pm-handle) {
    width: 18px;
    height: 18px;
    border-radius: 100px;
    border: 2px solid var(--bg);
    background: var(--accent);
    cursor: grab;
    touch-action: none;
  }
  .places-map :global(.pm-handle.pm-edge) {
    width: 14px;
    height: 14px;
    border-radius: 2px;
    background: var(--text-primary);
    cursor: ew-resize;
  }
  .places-map :global(.pm-handle:active) {
    cursor: grabbing;
  }
  .places-map :global(.pm-label) {
    pointer-events: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-primary);
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    padding: 1px 5px;
    white-space: nowrap;
  }
  .places-map :global(.pm-label.hidden) {
    visibility: hidden;
  }
</style>
