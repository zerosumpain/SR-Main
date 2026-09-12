<script lang="ts">
  /**
   * Dissolved territory on a light basemap — ONE source per player.
   *
   * The v1 map added a source, a fill layer, a line layer and a hatch image per
   * POLYGON, and the standings report geos in the hundreds: several hundred
   * sources and layers, each a worker job and a draw call, plus a popup bound to
   * every one. Mapbox GL's cost is per layer and per source, not per feature, so
   * the whole of a player's ground now travels as a single feature collection
   * (Task 6's `featureCollection` / `setData`): five players, five sources.
   *
   * A filter change therefore replaces DATA rather than tearing layers down, and
   * the hatch canvas each player's fill is painted with is registered once.
   */
  import { loadMapbox, type MapView, type MapLayer, type MapTools, type CollectionFeature } from '$lib/maps/loader';
  import { onMount, untrack } from 'svelte';
  import { HOME_BOX, identityMap, km2, type PlayerIdentity } from './identity';
  import type { Handovers, MapFocus, PlayerTerritory } from './types';

  /** What a tap on the map hands back: where, and whose ground it landed on.
   *  Restated (not exported) in `MapStage` — a `.svelte` file cannot export a
   *  type without the compiler reading it as a component export. */
  type TerritoryTap = { lat: number; lon: number; subject: string | null };

  let {
    territory,
    handovers,
    players,
    cellAreaM2,
    focus,
    view,
    isolate,
    ontap,
    height = '60vh',
  }: {
    territory: PlayerTerritory[];
    handovers: Handovers;
    players: PlayerIdentity[];
    cellAreaM2: number;
    focus: MapFocus;
    /** Which bounds the map is fitted to. Owned by `MapStage`. */
    view: 'changed' | 'home' | 'all';
    /** Show one player's ground alone, or all of it when null. */
    isolate: string | null;
    ontap: (hit: TerritoryTap) => void;
    height?: string;
  } = $props();

  let container: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);
  let ready = $state(false);

  // HANDLES ARE PLAIN `let`, NEVER `$state`. A map handle that is both read and
  // written by the same lifecycle function subscribes its effect to itself and
  // loops until effect_update_depth_exceeded — the documented way this repo
  // hangs. Nothing below is read by the template or by a $derived.
  let M: MapTools | null = null;
  let mapRef: MapView | null = null;
  const layers = new Map<string, MapLayer>();
  let pulse: MapLayer | null = null;
  let raf = 0;
  let styleReadyOnce = false;
  let scrollZoomActive = false;
  /** The subject a collection click landed on, read by the map-level click. */
  let hitSubject: string | null = null;
  let hitTimer: ReturnType<typeof setTimeout> | null = null;

  function rings(region: { outer: Array<[number, number]>; holes: Array<Array<[number, number]>> }) {
    return [region.outer, ...region.holes];
  }

  function draw() {
    if (!M || !mapRef) return;
    const byId = identityMap(players);
    const drawn = new Set<string>();

    for (const t of territory) {
      const who = byId.get(t.subject);
      if (!who) continue;
      drawn.add(t.subject);
      const features: CollectionFeature[] = t.regions
        .filter((region) => region.outer.length >= 3)
        .map((region) => ({
          rings: rings(region),
          properties: { subject: t.subject, t: region.t, km2: km2(region.t * cellAreaM2) },
        }));

      const existing = layers.get(t.subject);
      if (existing) {
        existing.setData(features);
        continue;
      }
      const layer = M.featureCollection(features, {
        color: who.colour,
        weight: 2,
        opacity: 0.95,
        fillColor: who.colour,
        fillOpacity: 0.22,
        hatch: who.hatch,
        lineJoin: 'round',
      });
      layer.bindTooltip(
        (p) => `${who.initial} · ${who.name} — ${String(p.km2 ?? '0.00')} km²`,
        { sticky: true, className: 'lg-tip' },
      );
      layer.on('click', () => {
        hitSubject = t.subject;
      });
      layer.addTo(mapRef);
      layers.set(t.subject, layer);
    }

    // A player the filter has emptied keeps their source and loses their data —
    // cheaper than a teardown, and the layer is there when they come back.
    for (const [subject, layer] of layers) if (!drawn.has(subject)) layer.setData([]);

    const changed: CollectionFeature[] = handovers.regions
      .filter((region) => region.outer.length >= 3)
      .map((region) => ({ rings: rings(region), properties: { changed: true } }));
    if (pulse) {
      pulse.setData(changed);
    } else if (changed.length) {
      // `var(--accent)` is resolved against the map container by the adapter, so
      // the pulse is the site's burnt orange rather than a second copy of it.
      pulse = M.featureCollection(changed, {
        color: 'var(--accent)',
        weight: 2,
        fill: false,
        dashArray: '4 3',
      });
      pulse.addTo(mapRef);
    }
    if (changed.length) startPulse();
    else stopPulse();

    applyIsolate();
    // A player who gains ground on a later filter change is added ON TOP of the
    // pulse, and the pulse is the one outline that must stay readable over a
    // fill — so it goes back to the front after every draw.
    pulse?.bringToFront();
    // The QA script counts sources here rather than reaching into WebGL.
    if (container) container.dataset.lgSources = String(layers.size + (pulse ? 1 : 0));
  }

  /** ≤ 20 fps, and nothing at all for a reader who has asked for stillness. */
  function startPulse() {
    if (raf || !pulse) return;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let last = 0;
    const step = (t: number) => {
      raf = requestAnimationFrame(step);
      if (t - last < 50) return;
      last = t;
      pulse?.setPaint({ 'line-opacity': 0.55 + 0.45 * Math.sin(t / 450) });
    };
    raf = requestAnimationFrame(step);
  }

  function stopPulse() {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
    pulse?.setPaint({ 'line-opacity': 1 });
  }

  function applyIsolate() {
    for (const [subject, layer] of layers) layer.setVisible(isolate === null || subject === isolate);
  }

  function fitView() {
    if (!mapRef || !ready) return;
    const opts = { padding: [28, 28], maxZoom: 15 };
    if (view === 'home') {
      mapRef.fitBounds(
        [
          [HOME_BOX.south, HOME_BOX.west],
          [HOME_BOX.north, HOME_BOX.east],
        ],
        opts,
      );
      return;
    }
    if (view === 'all') {
      const points: Array<[number, number]> = [];
      for (const t of territory) for (const region of t.regions) points.push(...region.outer);
      if (points.length) {
        mapRef.fitBounds(points, opts);
        return;
      }
    }
    // `focus.bounds` is already [[south, west], [north, east]] — the [lat, lon]
    // pair list `fitBounds` wants. Never build a LngLatBounds by hand here: it
    // takes lon/lat and the tuple type would not catch the flip.
    mapRef.fitBounds(focus.bounds, opts);
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const lib = await loadMapbox();
        if (cancelled || !container) return;
        M = lib;
        const map = lib.map(container, {
          theme: 'schematic',
          scrollWheelZoom: false,
          zoomControl: true,
          attributionControl: true,
        });
        mapRef = map;

        // A page must not hijack the wheel: scroll zoom arrives with focus and
        // leaves with it, exactly as TrackMap does.
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

        // One tap, one call. The collection handlers and this one fire in the
        // same dispatch, and Mapbox's delegated (per-layer) listeners are just
        // map listeners in registration order — so which runs first depends on
        // when the layer was added. Deferring by a macrotask removes the
        // ordering question entirely: whatever `hitSubject` says once the whole
        // synchronous dispatch is done is the answer.
        map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
          const lat = e.latlng.lat;
          const lon = e.latlng.lng;
          if (hitTimer !== null) clearTimeout(hitTimer);
          hitTimer = setTimeout(() => {
            hitTimer = null;
            const subject = hitSubject;
            hitSubject = null;
            ontap({ lat, lon, subject });
          }, 0);
        });

        map.on('load', () => {
          if (styleReadyOnce) return;
          styleReadyOnce = true;
          // The frame is measured by now, so this is the fit that sticks; the
          // one below runs against the pre-load camera and stops the county
          // flashing up first.
          applyIsolate();
          fitView();
        });

        ready = true;
        draw();
        fitView();
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    })();

    return () => {
      cancelled = true;
      stopPulse();
      if (hitTimer !== null) clearTimeout(hitTimer);
      hitTimer = null;
      mapRef?.remove();
      mapRef = null;
      layers.clear();
      pulse = null;
      styleReadyOnce = false;
    };
  });

  // Three effects, each reading ONLY its trigger and then untracking the work:
  // every one of these functions touches handles the effect must not subscribe
  // to. Ground first.
  $effect(() => {
    void territory;
    void handovers;
    untrack(draw);
  });

  $effect(() => {
    void isolate;
    untrack(applyIsolate);
  });

  $effect(() => {
    void view;
    void focus;
    void ready;
    untrack(fitView);
  });
</script>

<div class="lg-map-wrap" style="--lg-map-h: {height}">
  <div class="lg-map" data-lg-sources="0" bind:this={container}></div>
  {#if error}
    <p class="lg-map-msg">Map failed to load — {error}</p>
  {:else if !ready}
    <p class="lg-map-msg">Loading ground…</p>
  {/if}
</div>

<style>
  .lg-map-wrap {
    position: relative;
    /* Keep the basemap's own controls inside the frame's stacking context, so
       the focus control laid over the top of it stays on top. */
    isolation: isolate;
    height: var(--lg-map-h);
    border: 1px solid var(--line-strong);
    background: var(--surface-sunken);
  }
  .lg-map {
    height: 100%;
    width: 100%;
  }
  .lg-map-msg {
    position: absolute;
    inset: auto 0 0 0;
    margin: 0;
    padding: 10px 14px;
    z-index: 500;
    background: var(--bg);
    border-top: 1px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
  }
  /* The basemap is context, not content — `theme: 'schematic'` is light-v11, so
     five hatched territories are the only saturated thing on screen. */
  :global(.lg-tip) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background: var(--text-primary);
    color: var(--bg);
    border: 0;
    border-radius: var(--radius-sharp);
    box-shadow: none;
  }
  :global(.lg-tip::before) {
    display: none;
  }
  :global(.mapboxgl-map) {
    background: var(--surface-sunken);
    font-family: var(--font-mono);
  }
  :global(.mapboxgl-ctrl-attrib) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    background: var(--bg);
    color: var(--text-ghost);
  }
</style>
