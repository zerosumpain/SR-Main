<script lang="ts">
  import { loadMapbox, type MapView } from '$lib/maps/loader';
  import { onMount } from 'svelte';
  import type { Action } from 'svelte/action';
  import type { MapArtifact } from '$lib/workflows/site-tools/artifact-types';

  // Mapbox paints into WebGL and cannot read a CSS custom
  // property, so the tokens are mirrored here — the same arrangement, and the
  // same reason, as $lib/jkai/artifacts/vega-theme.ts.
  const MAP_TRACK = '#c4570a';      /* --accent */
  const MAP_HEAT_FILL = '#0e5b66';  /* --accent-ink */
  const MAP_HEAT_EDGE = '#094850';  /* --accent-ink-hover */

  let { artifact }: { artifact: MapArtifact } = $props();

  let container: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);
  let fullscreen = $state(false);
  let scrollZoomActive = $state(false);
  let mapRef: MapView | null = null;

  /** Portal fullscreen maps past transformed chat ancestors, then restore their
   * position. Remove the portal on destroy so it cannot orphan a fullscreen map. */
  const portalWhileFullscreen: Action<HTMLElement, boolean> = (node, active) => {
    // A comment node holds the figure's place in the thread, so it goes back
    // exactly where it was rather than at the end of its parent.
    const home = document.createComment('map-artifact');
    node.before(home);

    const place = (isFullscreen: boolean) => {
      if (isFullscreen && node.parentElement !== document.body) document.body.appendChild(node);
      else if (!isFullscreen && node.parentElement === document.body) home.after(node);
    };
    // Honour the initial value too: `update` only fires on a CHANGE, so a map
    // that mounted already fullscreen would otherwise stay in the thread.
    place(active);

    return {
      update: place,
      destroy() {
        // Take the node out of <body> before the placeholder goes, or a
        // fullscreen map unmounted mid-flight leaves an orphan pinned over
        // the page with no way to dismiss it.
        if (node.parentElement === document.body) node.remove();
        home.remove();
      },
    };
  };

  function toggleFullscreen() {
    fullscreen = !fullscreen;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && fullscreen) {
      event.stopPropagation();
      fullscreen = false;
    }
  }

  $effect(() => {
    // Reads `fullscreen` only; everything it writes is outside Svelte's graph,
    // so there is no effect-reads-own-write loop here.
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeydown, true);
    // Two frames: the first applies the class, the second lets layout settle
    // before Mapbox measures. One frame measured the old box on a cold map.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => mapRef?.invalidateSize()));
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeydown, true);
      document.body.style.overflow = previous;
      requestAnimationFrame(() => mapRef?.invalidateSize());
    };
  });

  function activateScrollZoom() {
    if (scrollZoomActive) return;
    scrollZoomActive = true;
    mapRef?.scrollWheelZoom.enable();
  }

  function deactivateScrollZoom() {
    if (!scrollZoomActive) return;
    scrollZoomActive = false;
    mapRef?.scrollWheelZoom.disable();
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const M = await loadMapbox();
        if (cancelled || !container) return;
        // scrollWheelZoom starts disabled so page scroll works; user
        // activates it by clicking the map (and deactivates by clicking off).
        // touchZoom / pinch / +- controls / double-click / drag are all
        // default-enabled.
        const map = M.map(container, {
          scrollWheelZoom: false,
          zoomControl: true,
          touchZoom: true,
          doubleClickZoom: true,
          dragging: true,
        });
        mapRef = map;

        map.on('focus', activateScrollZoom);
        map.on('blur', deactivateScrollZoom);

        const allPoints: Array<[number, number]> = [];
        for (const layer of artifact.layers) {
          if (layer.kind === 'points') {
            for (const p of layer.points) {
              const m = M.marker([p.lat, p.lng]).addTo(map);
              if (p.label) m.bindTooltip(p.label);
              allPoints.push([p.lat, p.lng]);
            }
          } else if (layer.kind === 'track') {
            const coords = layer.points.map((p) => [p.lat, p.lng] as [number, number]);
            // Burnt orange, the site's identity colour, and what a single
            // series wears everywhere else on the site — with the site’s accent.
            M.polyline(coords, { color: MAP_TRACK, weight: 3 }).addTo(map);
            allPoints.push(...coords);
          } else {
            // heatmap — fallback to weighted circle markers (no external plugin in v1)
            for (const p of layer.points) {
              const w = typeof p.weight === 'number' ? p.weight : 1;
              M.circleMarker([p.lat, p.lng], {
                radius: Math.min(Math.max(w * 4, 3), 20),
                // Petrol, the counter-accent: heat has to read as a different
                // measure from a track, and red is the site's error colour.
                fillColor: MAP_HEAT_FILL,
                color: MAP_HEAT_EDGE,
                weight: 1,
                fillOpacity: 0.5,
              }).addTo(map);
              allPoints.push([p.lat, p.lng]);
            }
          }
        }

        if (artifact.center && artifact.zoom != null) {
          map.setView(artifact.center, artifact.zoom);
        } else if (allPoints.length > 0) {
          const [head, ...rest] = allPoints;
          const bounds = M.latLngBounds([head, head]);
          for (const p of rest) bounds.extend(p);
          map.fitBounds(bounds, { padding: [20, 20] });
        } else {
          map.setView([51.5, -0.1], 12);
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

<figure class="map-artifact" class:fullscreen use:portalWhileFullscreen={fullscreen}>
  {#if artifact.caption}
    <figcaption>{artifact.caption}</figcaption>
  {/if}
  <div class="map-container" bind:this={container}></div>

  <button
    class="fs-toggle"
    type="button"
    onclick={toggleFullscreen}
    aria-label={fullscreen ? 'Exit fullscreen' : 'Expand map'}
    title={fullscreen ? 'Exit fullscreen' : 'Expand map'}
  >
    {#if fullscreen}
      <!-- collapse icon -->
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>
      </svg>
    {:else}
      <!-- expand icon -->
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
      </svg>
    {/if}
  </button>

  {#if error}
    <p class="error">Map failed to render: {error}</p>
  {/if}
</figure>

<style>
  .map-artifact {
    position: relative;
    /* Keep map controls inside the figure’s stacking context. */
    z-index: 0;
    isolation: isolate;
    margin: 0.5rem 0;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    overflow: hidden;
    max-width: 100%;
  }
  .map-container {
    width: 100%;
    height: 360px;
  }
  .map-artifact.fullscreen {
    position: fixed;
    inset: 0;
    margin: 0;
    border-radius: 0;
    border: none;
    z-index: 9999;
    background: var(--surface-elevated);
    /* The caption takes its own row rather than floating over the map, so the
       top strip of the map is never hidden behind it. */
    display: flex;
    flex-direction: column;
  }
  .map-artifact.fullscreen .map-container {
    /* flex: 1 rather than 100vh — the caption is a sibling now, and 100vh would
       push the map that much taller than the space left for it. `min-height: 0`
       because a flex item's default `min-height: auto` refuses to shrink and
       would overflow the figure. */
    flex: 1;
    min-height: 0;
    height: auto;
  }
  .fs-toggle {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    z-index: 1000; /* above Mapbox layers */
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    background: var(--surface-elevated);
    color: var(--text-primary);
    cursor: pointer;
  }
  .fs-toggle:hover { background: var(--bg); }
  figcaption {
    padding: 0.4rem 0.75rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    background: var(--surface-sunken);
    border-bottom: 1px solid var(--line-strong);
  }
  .map-artifact.fullscreen figcaption {
    /* Nothing to override: the flex column above already gives it a row of its
       own at the top, which is where it sits inline too. */
    flex: none;
  }
  .error {
    color: var(--error);
    padding: 0.5rem;
    font-size: 0.85rem;
    margin: 0;
  }
</style>
