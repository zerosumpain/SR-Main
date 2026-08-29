<script lang="ts">
  /**
   * The territory map — the hero.
   *
   * Vendored Leaflet, same pattern as PlaceMap/FamilyMap: no CDN, shared
   * window.L, the CSS injected once. Two things are specific to this map and
   * both are load-bearing.
   *
   * 1. It draws DISSOLVED rings, never cells. The dissolve happens on the
   *    server; twelve thousand cell rectangles is a renderer that crawls.
   * 2. It uses the SVG renderer, not preferCanvas, because each player's fill
   *    is a `<pattern>` hatch. Colour is not allowed to carry identity on its
   *    own — five on-brand hues cannot all be >=3:1 on cream AND
   *    deuteranope-safe — so every player reads as colour + hatch + initial.
   */
  import { onMount, untrack } from 'svelte';
  import type { PlayerIdentity } from './identity';
  import { km2 } from './identity';
  import type { PlayerTerritory } from './types';

  let {
    territory,
    players,
    cellAreaM2,
    height = '68vh',
  }: {
    territory: PlayerTerritory[];
    players: PlayerIdentity[];
    cellAreaM2: number;
    height?: string;
  } = $props();

  type LeafletLayer = {
    addTo: (m: unknown) => LeafletLayer;
    bindTooltip: (t: string, o?: Record<string, unknown>) => LeafletLayer;
    getElement?: () => SVGElement | undefined;
    _path?: SVGElement;
  };
  type LeafletMap = {
    fitBounds: (b: unknown, opts?: Record<string, unknown>) => unknown;
    setView: (c: [number, number], z: number) => unknown;
    invalidateSize: () => unknown;
    removeLayer: (l: unknown) => unknown;
    remove: () => unknown;
  };
  type LeafletGlobal = {
    map: (el: HTMLElement, opts?: Record<string, unknown>) => LeafletMap;
    svg: (o?: Record<string, unknown>) => unknown;
    tileLayer: (url: string, opts?: Record<string, unknown>) => LeafletLayer;
    polygon: (rings: Array<Array<[number, number]>>, opts?: Record<string, unknown>) => LeafletLayer;
    layerGroup: () => LeafletLayer & { clearLayers: () => unknown };
    latLngBounds: (coords: Array<[number, number]>) => unknown;
  };

  let container: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);
  let ready = $state(false);

  // Handles, never $state — an effect that both reads and writes one of these
  // is the documented way this repo hangs.
  let L: LeafletGlobal | null = null;
  let mapRef: LeafletMap | null = null;
  let paint: (LeafletLayer & { clearLayers: () => unknown }) | null = null;
  let fitted = false;

  function ensureLeaflet(): Promise<LeafletGlobal> {
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
      const done = () => {
        const g = (globalThis as unknown as { L?: LeafletGlobal }).L;
        g ? resolve(g) : reject(new Error('Leaflet loaded but window.L missing'));
      };
      const existingScript = document.querySelector<HTMLScriptElement>('script[data-leaflet]');
      if (existingScript) {
        existingScript.addEventListener('load', done);
        return;
      }
      const script = document.createElement('script');
      script.src = '/vendor/leaflet.min.js';
      script.dataset.leaflet = 'true';
      script.onload = done;
      script.onerror = () => reject(new Error('Failed to load /vendor/leaflet.min.js'));
      document.head.appendChild(script);
    });
  }

  /**
   * The hatch alphabet as SVG, injected into the overlay pane's own `<svg>`.
   *
   * Each pattern paints a translucent wash of the player's colour AND an opaque
   * rule over it, so one fill gives both the block of ground and the texture
   * that survives a greyscale print. Re-asserted on every draw because Leaflet
   * drops the overlay `<svg>` when the last vector layer is removed, which is
   * exactly what a filter that empties the map does.
   */
  function ensureDefs() {
    if (!container) return;
    const svg = container.querySelector<SVGSVGElement>('.leaflet-overlay-pane svg');
    if (!svg) return;
    let defs = svg.querySelector('defs[data-lg]');
    if (defs) return;
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.setAttribute('data-lg', 'true');
    defs.innerHTML = players
      .map((p) => {
        const wash = `<rect width="9" height="9" fill="${p.colour}" fill-opacity="0.16"/>`;
        const line = (x1: number, y1: number, x2: number, y2: number) =>
          `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${p.colour}" stroke-width="2.4" stroke-opacity="0.62" stroke-linecap="square"/>`;
        const marks =
          p.hatch === 'diag'
            ? line(0, 9, 9, 0)
            : p.hatch === 'back'
              ? line(0, 0, 9, 9)
              : p.hatch === 'vert'
                ? line(4.5, 0, 4.5, 9)
                : p.hatch === 'horiz'
                  ? line(0, 4.5, 9, 4.5)
                  : p.hatch === 'grid'
                    ? line(4.5, 0, 4.5, 9) + line(0, 4.5, 9, 4.5)
                    : `<circle cx="4.5" cy="4.5" r="2" fill="${p.colour}" fill-opacity="0.66"/>`;
        return `<pattern id="lg-hatch-${p.slot}" width="9" height="9" patternUnits="userSpaceOnUse">${wash}${marks}</pattern>`;
      })
      .join('');
    svg.insertBefore(defs, svg.firstChild);
  }

  function draw() {
    if (!L || !mapRef || !paint) return;
    paint.clearLayers();
    const bounds: Array<[number, number]> = [];
    const byId = new Map(players.map((p) => [p.subject, p]));

    for (const t of territory) {
      const who = byId.get(t.subject);
      if (!who) continue;
      for (const region of t.regions) {
        if (region.outer.length < 3) continue;
        for (const c of region.outer) bounds.push(c);
        const poly = L.polygon([region.outer, ...region.holes], {
          color: who.colour,
          weight: 2,
          opacity: 0.95,
          fillColor: who.colour,
          fillOpacity: 0.22,
          fillRule: 'evenodd',
          lineJoin: 'round',
        });
        poly.addTo(paint);
        poly.bindTooltip(
          `${who.initial} · ${who.name} — ${km2(region.t * cellAreaM2)} km²`,
          { sticky: true, className: 'lg-tip' },
        );
        const el = poly.getElement?.() ?? poly._path;
        // The hatch is applied to the DOM node rather than passed as an option:
        // Leaflet writes `fill` from `fillColor`, and a url() reference is not
        // a colour it will accept.
        el?.setAttribute('fill', `url(#lg-hatch-${who.slot})`);
        el?.setAttribute('fill-opacity', '1');
      }
    }
    ensureDefs();

    if (bounds.length && !fitted) {
      mapRef.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 16 });
      fitted = true;
    }
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const lib = await ensureLeaflet();
        if (cancelled || !container) return;
        L = lib;
        // SVG explicitly, with generous padding so a pan does not reveal
        // unpainted ground before the renderer catches up.
        const map = lib.map(container, {
          renderer: lib.svg({ padding: 0.4 }),
          preferCanvas: false,
          scrollWheelZoom: true,
          zoomControl: true,
          attributionControl: true,
        });
        mapRef = map;
        map.setView([54.523, -1.553], 13);
        lib
          .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap',
            className: 'lg-tiles',
          })
          .addTo(map);
        paint = lib.layerGroup();
        paint.addTo(map);
        draw();
        ready = true;
        // Leaflet measures its container once, at creation. Inside a grid that
        // is still settling that measurement is zero and the map paints
        // nothing — the same remedy PlaceMap uses.
        requestAnimationFrame(() => mapRef?.invalidateSize());
        setTimeout(() => mapRef?.invalidateSize(), 250);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    })();

    const onResize = () => mapRef?.invalidateSize();
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      mapRef?.remove();
      mapRef = null;
      paint = null;
    };
  });

  // Redraw when the filter changes the ground. Only `territory` is tracked; the
  // draw itself is untracked so nothing it touches can re-arm this effect.
  $effect(() => {
    void territory;
    untrack(() => draw());
  });
</script>

<div class="lg-map-wrap" style="--lg-map-h: {height}">
  <div class="lg-map" bind:this={container}></div>
  {#if error}
    <p class="lg-map-msg">Map failed to load — {error}</p>
  {:else if !ready}
    <p class="lg-map-msg">Loading ground…</p>
  {/if}
</div>

<style>
  .lg-map-wrap {
    position: relative;
    border: 1px solid var(--line-strong);
    background: var(--surface-sunken);
  }
  .lg-map {
    height: var(--lg-map-h);
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
  /* The basemap is context, not content: desaturated so five hatched
     territories are the only saturated thing on screen. */
  :global(.lg-tiles) {
    filter: grayscale(0.86) contrast(0.9) brightness(1.06);
  }
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
  :global(.leaflet-container) {
    background: var(--surface-sunken);
    font-family: var(--font-mono);
  }
  :global(.leaflet-control-attribution) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    background: var(--bg);
    color: var(--text-ghost);
  }
</style>
