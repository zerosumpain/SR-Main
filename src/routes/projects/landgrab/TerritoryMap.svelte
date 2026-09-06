<script lang="ts">
  import { loadMapbox, type MapView, type MapLayer, type MapTools } from '$lib/maps/loader';
  /** Dissolved territory rings, with colour plus hatch identity on Mapbox. */
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

  let container: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);
  let ready = $state(false);

  // Handles, never $state — an effect that both reads and writes one of these
  // is the documented way this repo hangs.
  let M: MapTools | null = null;
  let mapRef: MapView | null = null;
  let paint: (MapLayer & { clearLayers: () => unknown }) | null = null;
  let fitted = false;

  function draw() {
    if (!M || !mapRef || !paint) return;
    paint.clearLayers();
    const bounds: Array<[number, number]> = [];
    const byId = new Map(players.map((p) => [p.subject, p]));

    for (const t of territory) {
      const who = byId.get(t.subject);
      if (!who) continue;
      for (const region of t.regions) {
        if (region.outer.length < 3) continue;
        for (const c of region.outer) bounds.push(c);
        const poly = M.polygon([region.outer, ...region.holes], {
          color: who.colour,
          weight: 2,
          opacity: 0.95,
          fillColor: who.colour,
          fillOpacity: 0.22,
          hatch: who.hatch,
          fillRule: 'evenodd',
          lineJoin: 'round',
        });
        poly.addTo(paint);
        poly.bindTooltip(
          `${who.initial} · ${who.name} — ${km2(region.t * cellAreaM2)} km²`,
          { sticky: true, className: 'lg-tip' },
        );
      }
    }

    if (bounds.length && !fitted) {
      mapRef.fitBounds(M.latLngBounds(bounds), { padding: [28, 28], maxZoom: 16 });
      fitted = true;
    }
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const lib = await loadMapbox();
        if (cancelled || !container) return;
        M = lib;
        const map = lib.map(container, {
          scrollWheelZoom: true,
          zoomControl: true,
          attributionControl: true,
        });
        mapRef = map;
        map.setView([54.523, -1.553], 13);
        paint = lib.layerGroup();
        paint.addTo(map);
        draw();
        ready = true;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    })();

    return () => {
      cancelled = true;
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
