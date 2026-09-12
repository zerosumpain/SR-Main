<script lang="ts">
  /**
   * The board: a fixed honeycomb over the whole map, filled where somebody has
   * been.
   *
   * v1 and v2 HID the grid and dissolved held cells into smoothed blobs,
   * because square cells read as Minecraft. A hexagon has no staircase edge, so
   * the grid can be the picture rather than something to be smoothed away —
   * every hex on screen is a piece of ground, and the coloured ones are taken.
   *
   * The scoring atom has not moved. `geo_capture_events` is still keyed on the
   * z19 square cell; `$lib/geo/hex-board` projects the answer the ledger gave
   * onto the shape drawn here.
   *
   * ONE SOURCE PER PLAYER, still. Mapbox GL's cost is per layer and per source
   * rather than per feature, so ~19k hexes in five collections is cheap where
   * five hundred layers was not. The mesh of unclaimed ground is a sixth, and
   * it is the only layer that is rebuilt on a camera move.
   */
  import { loadMapbox, type MapView, type MapLayer, type MapTools, type CollectionFeature } from '$lib/maps/loader';
  import { onMount, untrack } from 'svelte';
  // Pure lattice arithmetic — no DB, no server reach, no GPS fix in a
  // signature — so the client bundle may have it, exactly as the page next
  // door already carries `$lib/geo/tiles` to turn a tap into a cell.
  import { hexRings, hexWidthPx, hexesInBounds, unpackHexes, type Hex } from '$lib/geo/hex';
  import { HOME_BOX, identityMap, type PlayerIdentity } from './identity';
  import type { Handovers, LatLonBounds, MapFocus, PlayerHexes } from './types';

  /** What a tap on the map hands back: where, and whose ground it landed on.
   *  Restated (not exported) in `MapStage` — a `.svelte` file cannot export a
   *  type without the compiler reading it as a component export. */
  type TerritoryTap = { lat: number; lon: number; subject: string | null };

  let {
    hexes,
    handovers,
    territoryBounds,
    players,
    focus,
    view,
    isolate,
    ontap,
    height = '60vh',
  }: {
    hexes: PlayerHexes[];
    handovers: Handovers;
    territoryBounds: LatLonBounds | null;
    players: PlayerIdentity[];
    focus: MapFocus;
    /** Which bounds the map is fitted to. Owned by `MapStage`. */
    view: 'changed' | 'home' | 'all';
    /** Show one player's ground alone, or all of it when null. */
    isolate: string | null;
    ontap: (hit: TerritoryTap) => void;
    height?: string;
  } = $props();

  /**
   * Below this many pixels across, a honeycomb is not a board — it is a grey
   * wash over the basemap, and it hides the thing it is meant to frame.
   */
  const MESH_MIN_PX = 9;

  /**
   * And a hard ceiling, because the pixel floor alone still admits a very wide
   * browser window. Six thousand hexes is about 3 km of Darlington.
   */
  const MESH_MAX_HEXES = 6000;

  /**
   * The unclaimed mesh fades in rather than appearing; the owned outlines fade
   * the other way, so a zoomed-out board reads as solid ground.
   *
   * The ramp tops out at 1, NOT at a second dimming. `--line-strong` is a tint
   * — `rgba(26, 16, 8, 0.16)` — and Mapbox multiplies `line-opacity` into the
   * colour's own alpha, so a 0.5 ceiling here would draw the honeycomb at 8%
   * of near-black on a near-white basemap and it would read as basemap
   * furniture rather than as ground nobody has taken.
   */
  const MESH_OPACITY = ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 1];
  const HEX_EDGE_WIDTH = ['interpolate', ['linear'], ['zoom'], 12, 0, 14, 0.4, 16, 1.1];

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
  /** The packed array each layer was last built from, by identity. A filter
   *  change that only moves the handovers must not rebuild ~19k rings a player
   *  for five players — that is half a million short-lived arrays for a layer
   *  whose data did not change. */
  const builtFrom = new Map<string, number[]>();
  let mesh: MapLayer | null = null;
  /** What the mesh currently holds, so a pan that lands on the same hexes does
   *  not rebuild and re-upload them. */
  let meshKey = '';
  let pulse: MapLayer | null = null;
  let raf = 0;
  let styleReadyOnce = false;
  let scrollZoomActive = false;
  /** The subject a collection click landed on, read by the map-level click. */
  let hitSubject: string | null = null;
  let hitTimer: ReturnType<typeof setTimeout> | null = null;

  /** Packed axial integers -> one closed six-sided feature per hex. */
  function features(list: readonly Hex[]): CollectionFeature[] {
    // No per-feature properties: the layer IS the player, the tooltip is a
    // constant, and 19k copies of `{subject: 'john'}` is payload for nothing.
    return hexRings(list).map((ring) => ({ rings: [ring], properties: {} }));
  }

  function drawTerritory() {
    if (!M || !mapRef) return;
    const byId = identityMap(players);
    const drawn = new Set<string>();

    for (const t of hexes) {
      const who = byId.get(t.subject);
      if (!who) continue;
      drawn.add(t.subject);

      const existing = layers.get(t.subject);
      if (existing) {
        // Identity, not contents: the payload is a fresh array on every load,
        // and the same array on every re-render of the same load.
        if (builtFrom.get(t.subject) === t.packed) continue;
        existing.setData(features(unpackHexes(t.packed)));
        builtFrom.set(t.subject, t.packed);
        continue;
      }
      const layer = M.featureCollection(features(unpackHexes(t.packed)), {
        color: who.colour,
        weight: HEX_EDGE_WIDTH,
        opacity: 0.9,
        fillColor: who.colour,
        fillOpacity: 0.22,
        hatch: who.hatch,
        lineJoin: 'round',
      });
      layer.bindTooltip(`${who.initial} · ${who.name}`, { sticky: true, className: 'lg-tip' });
      layer.on('click', () => {
        hitSubject = t.subject;
      });
      layer.addTo(mapRef);
      layers.set(t.subject, layer);
      builtFrom.set(t.subject, t.packed);
    }

    // A player the filter has emptied keeps their source and loses their data —
    // cheaper than a teardown, and the layer is there when they come back.
    for (const [subject, layer] of layers) {
      if (drawn.has(subject)) continue;
      if (builtFrom.get(subject)?.length === 0) continue;
      layer.setData([]);
      builtFrom.set(subject, []);
    }

    applyIsolate();
    // A player who gains ground on a later filter change is added ON TOP of the
    // pulse, and the pulse is the one outline that must stay readable over a
    // fill — so it goes back to the front after every draw.
    pulse?.bringToFront();
    countSources();
  }

  /** The ground that changed hands, over the top of whoever holds it now. */
  function drawPulse() {
    if (!M || !mapRef) return;
    const changed = features(unpackHexes(handovers.packed));
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
    pulse?.bringToFront();
    countSources();
  }

  /** The QA script counts sources here rather than reaching into WebGL. */
  function countSources() {
    if (!container) return;
    container.dataset.lgSources = String(layers.size + (mesh ? 1 : 0) + (pulse ? 1 : 0));
  }

  /**
   * The unclaimed board, for the camera's current extent.
   *
   * Only the browser knows where the reader has panned, so this is the one
   * layer the server cannot precompute. `hexesInBounds` returns null rather
   * than a truncated list when the viewport would cost more than the budget: a
   * partial honeycomb is worse than none, because its edge reads as the edge of
   * the board.
   */
  function drawMesh() {
    if (!M || !mapRef || !ready) return;
    // [[south, west], [north, east]] — the adapter's own order, not Mapbox's
    // lon/lat one. Read as points rather than through `native()`, which builds
    // an empty LngLatBounds for a map that has already gone.
    const [sw, ne] = mapRef.getBounds().points;
    if (!sw || !ne) return;
    const list =
      hexWidthPx(mapRef.getZoom()) < MESH_MIN_PX
        ? null
        : hexesInBounds({ south: sw[0], west: sw[1], north: ne[0], east: ne[1] }, MESH_MAX_HEXES);

    const key = list?.length
      ? `${list.length}:${list[0].q}:${list[0].r}:${list[list.length - 1].q}`
      : '';
    if (key === meshKey) return;
    meshKey = key;
    mesh?.setData(list ? features(list) : []);
    if (container) {
      container.dataset.lgMesh = String(list?.length ?? 0);
    }
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
    if (view === 'all' && territoryBounds) {
      mapRef.fitBounds(territoryBounds, opts);
      return;
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

        // FIRST, so it is the bottom layer: Mapbox stacks in the order layers
        // are added, and everything anybody holds is drawn over the empty board
        // rather than under it.
        mesh = lib.featureCollection([], {
          color: 'var(--line-strong)',
          weight: 1,
          opacity: MESH_OPACITY,
          fill: false,
        });
        mesh.addTo(map);

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

        // `moveend` covers pans and zooms alike and fires once, at rest, so the
        // mesh is rebuilt when the camera stops rather than on every frame.
        map.on('moveend', () => drawMesh());

        map.on('load', () => {
          if (styleReadyOnce) return;
          styleReadyOnce = true;
          // The frame is measured by now, so this is the fit that sticks; the
          // one below runs against the pre-load camera and stops the county
          // flashing up first.
          applyIsolate();
          fitView();
          drawMesh();
        });

        ready = true;
        drawTerritory();
        drawPulse();
        fitView();
        drawMesh();
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
      builtFrom.clear();
      mesh = null;
      meshKey = '';
      pulse = null;
      styleReadyOnce = false;
    };
  });

  // Three effects, each reading ONLY its trigger and then untracking the work:
  // every one of these functions touches handles the effect must not subscribe
  // to. Ground first.
  $effect(() => {
    void hexes;
    untrack(drawTerritory);
  });

  $effect(() => {
    void handovers;
    untrack(drawPulse);
  });

  $effect(() => {
    void isolate;
    untrack(applyIsolate);
  });

  $effect(() => {
    void view;
    void focus;
    void territoryBounds;
    void ready;
    untrack(fitView);
  });
</script>

<div class="lg-map-wrap" style="--lg-map-h: {height}">
  <div class="lg-map" data-lg-sources="0" data-lg-mesh="0" bind:this={container}></div>
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
