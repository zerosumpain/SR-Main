<script lang="ts">
  import { loadMapbox } from '$lib/maps/loader';
  import { onMount, onDestroy } from 'svelte';
  import type { Coord } from '$lib/trails/scoring';

  let {
    start = null,
    finish = null,
    candidates = [],
    selectedIndex = 0,
    picking = 'start',
    onpick,
    height = '460px',
  }: {
    start?: [number, number] | null; // [lng, lat]
    finish?: [number, number] | null;
    /** Candidate routes; the selected one is drawn on top in accent. */
    candidates?: Coord[][];
    selectedIndex?: number;
    picking?: 'start' | 'finish' | 'none';
    onpick?: (lngLat: [number, number], which: 'start' | 'finish') => void;
    height?: string;
  } = $props();

  let container: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);
  let ready = $state(false);

  // Mapbox objects are machinery, never $state — a handle that an effect both
  // reads and writes subscribes that effect to itself and loops.
  let M: any = null;
  let map: any = null;
  let startMarker: any = null;
  let finishMarker: any = null;
  let routeLayers: any[] = [];
  let fittedKey = '';

  function pinIcon(colour: string) {
    return M.divIcon({
      className: 'plan-pin',
      html: `<span style="background:${colour}"></span>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }

  function drawMarkers() {
    if (!map) return;
    startMarker?.remove();
    finishMarker?.remove();
    startMarker = null;
    finishMarker = null;

    if (start) {
      startMarker = M.marker([start[1], start[0]], { icon: pinIcon('#0e5b66') })
        .addTo(map)
        .bindTooltip('Start');
    }
    if (finish) {
      finishMarker = M.marker([finish[1], finish[0]], { icon: pinIcon('#c4570a') })
        .addTo(map)
        .bindTooltip('Finish');
    }
  }

  function drawRoutes() {
    if (!map) return;
    for (const layer of routeLayers) layer.remove();
    routeLayers = [];

    candidates.forEach((coords, i) => {
      if (!coords?.length) return;
      const latlngs = coords.map(([lng, lat]) => [lat, lng] as [number, number]);
      const selected = i === selectedIndex;
      // Unselected candidates stay visible but recede, so the comparison is
      // possible without them competing with the choice.
      const layer = M.polyline(latlngs, {
        color: selected ? '#c4570a' : '#1a1008',
        weight: selected ? 4 : 2,
        opacity: selected ? 1 : 0.25,
        dashArray: selected ? undefined : '4,4',
      }).addTo(map);
      if (selected) layer.bringToFront();
      routeLayers.push(layer);
    });

    // Only refit when the geometry actually changed — refitting on every
    // selection change would yank the view while the user compares options.
    const key = candidates.map((c) => c.length).join(',');
    if (candidates.length && key !== fittedKey) {
      fittedKey = key;
      const all = candidates.flat().map(([lng, lat]) => [lat, lng] as [number, number]);
      if (all.length) map.fitBounds(all, { padding: [30, 30] });
    }
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        M = await loadMapbox();
        if (cancelled || !container) return;

        map = M.map(container, { scrollWheelZoom: false, zoomControl: true });
        map.setView(start ? [start[1], start[0]] : [53.3811, -1.4701], 13);

        map.on('focus', () => map.scrollWheelZoom.enable());
        map.on('blur', () => map.scrollWheelZoom.disable());

        map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
          if (picking === 'none') return;
          onpick?.([e.latlng.lng, e.latlng.lat], picking);
        });

        ready = true;
        drawMarkers();
        drawRoutes();
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  onDestroy(() => {
    map?.remove();
    map = null;
  });

  // Redraw on data change. Guarded on `ready` so it is inert until Mapbox
  // exists; the draw functions touch only Mapbox handles, never $state, so
  // they cannot re-trigger this effect.
  $effect(() => {
    void start;
    void finish;
    if (ready) drawMarkers();
  });

  $effect(() => {
    void candidates;
    void selectedIndex;
    if (ready) drawRoutes();
  });
</script>

{#if error}
  <div class="map-fallback" style:height>Map unavailable — {error}</div>
{:else}
  <div class="map-frame" style:height>
    <div class="map" bind:this={container}></div>
    {#if picking !== 'none'}
      <p class="hint">Tap the map to set the {picking}</p>
    {/if}
  </div>
{/if}

<style>
  .map-frame {
    position: relative;
    isolation: isolate;
    border: 1px solid var(--line-strong);
    background: var(--surface-sunken);
  }

  .map {
    width: 100%;
    height: 100%;
  }

  .map-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--line-strong);
    background: var(--surface-sunken);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .hint {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 10px;
    z-index: 500;
    /* The hint floats OVER the map, so without this it swallows any tap that
       lands on it — the one place a caption must never intercept a click. */
    pointer-events: none;
    margin: 0;
    padding: 5px 10px;
    background: var(--surface-card);
    border: 1px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-secondary);
  }

  :global(.plan-pin span) {
    display: block;
    width: 14px;
    height: 14px;
    border: 2px solid #1a1008;
    border-radius: 100px;
  }

  :global(.mapboxgl-map) {
    font-family: var(--font-mono);
    background: #e8dece;
  }
</style>
