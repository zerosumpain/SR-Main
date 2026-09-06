<script lang="ts">
  /**
   * Points on a map, inside the drill — a daydream place with its cluster
   * radius, the places a thought cites, or an intel entity that names a place.
   *
   * Same shape as `FamilyMap` / `PlaceMap`: the shared Mapbox loader, scroll
   * zoom off because the map sits in a scrolling panel, one marker per point
   * with a permanent label, and the bounds fitted to what is there. Loaded
   * lazily by the modal, so WebGL and the map CSS stay out of every other drill.
   */
  import { onMount } from 'svelte';
  import { loadMapbox, type MapView } from '$lib/maps/loader';
  import type { DrillMap } from '$lib/jkai/context-panel/types';

  let {
    map,
    height = '320px',
    onOpen,
  }: {
    map: DrillMap;
    height?: string;
    /** A point's drill key — the modal navigates to it. */
    onOpen?: (drill: string) => void;
  } = $props();

  let container: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);
  // Plain let — a handle nothing reactive reads.
  let mapRef: MapView | null = null;

  const TONE_COLOUR: Record<string, string> = {
    good: '#3a8658',
    warn: '#b0892a',
    bad: '#c44',
    accent: '#0e5b66',
    default: '#c4570a',
  };

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const M = await loadMapbox();
        if (cancelled || !container || map.points.length === 0) return;
        const view = M.map(container, { scrollWheelZoom: false, zoomControl: true });
        mapRef = view;
        for (const p of map.points) {
          const colour = TONE_COLOUR[p.tone ?? 'default'] ?? TONE_COLOUR.default;
          if (p.radiusM) {
            // The cluster the place was built from: a wide circle says
            // "somewhere around here", which is the honest precision.
            M.circle([p.lat, p.lon], { radius: p.radiusM, color: colour, weight: 1, fillColor: colour, fillOpacity: 0.08 }).addTo(view);
          }
          const marker = M.circleMarker([p.lat, p.lon], { radius: 6, color: '#faf7f1', weight: 2, fillColor: colour, fillOpacity: 1 });
          marker.bindTooltip(p.label, { permanent: true, direction: 'top', offset: [0, -8], className: 'dm-map-tip' });
          if (p.drill && onOpen) marker.on('click', () => onOpen?.(p.drill!));
          marker.addTo(view);
        }
        if (map.points.length === 1) {
          const p = map.points[0];
          view.setView([p.lat, p.lon], p.radiusM ? 16 : 12);
        } else {
          view.fitBounds(M.latLngBounds(map.points.map((p) => [p.lat, p.lon] as [number, number])), { padding: [40, 40], maxZoom: 14 });
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    })();
    return () => {
      cancelled = true;
      mapRef?.remove();
      mapRef = null;
    };
  });
</script>

<div class="dmap">
  {#if error}
    <p class="dmap-error">Map failed to load: {error}</p>
  {:else}
    <div class="dmap-canvas" bind:this={container} style="height: {height}"></div>
  {/if}
  <div class="dmap-foot">
    <span>{map.points.length} {map.points.length === 1 ? 'place' : 'places'}</span>
    {#if map.provenance}<span class="dmap-prov">{map.provenance}</span>{/if}
  </div>
</div>

<style>
  .dmap {
    border-bottom: 1px solid var(--line-hair);
    background: var(--bg);
  }
  .dmap-canvas {
    position: relative;
    width: 100%;
    background: var(--surface-sunken);
  }
  .dmap-error {
    margin: 0;
    padding: 14px 18px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--error);
  }
  .dmap-foot {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 18px 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .dmap-prov {
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.dm-map-tip) {
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-label-xs, 12px);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
</style>
