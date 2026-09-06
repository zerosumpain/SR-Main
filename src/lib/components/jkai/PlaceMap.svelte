<script lang="ts">
  import { loadMapbox, type MapView } from '$lib/maps/loader';
  /** One place, with its metre-radius uncertainty area. */
  import { onMount } from 'svelte';

  let {
    lat,
    lon,
    radiusM = 200,
    height = '220px',
  }: { lat: number; lon: number; radiusM?: number; height?: string } = $props();

  let container: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);

  // Plain `let`, never `$state` — nothing reactive reads it, and a handle that
  // an effect both reads and writes is the classic effect_update_depth loop.
  let mapRef: MapView | null = null;

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const M = await loadMapbox();
        if (cancelled || !container) return;

        // Scroll zoom off: the map sits inside a scrolling list, and a wheel
        // that zooms instead of scrolling traps the page.
        const map = M.map(container, { scrollWheelZoom: false, zoomControl: true });
        mapRef = map;
        map.setView([lat, lon], 17);

        // The scatter the place was clustered from, then its centre. Showing
        // both is the point: a wide circle says "somewhere around here", which
        // is the honest precision of a 200 m cluster.
        M.circle([lat, lon], {
          radius: radiusM,
          color: '#c4570a',
          weight: 1,
          fillColor: '#c4570a',
          fillOpacity: 0.08,
        }).addTo(map);
        M.circleMarker([lat, lon], {
          radius: 5,
          color: '#0e5b66',
          weight: 2,
          fillColor: '#0e5b66',
          fillOpacity: 1,
        }).addTo(map);
      } catch (err) {
        error = err instanceof Error ? err.message : 'map failed to load';
      }
    })();

    return () => {
      cancelled = true;
      mapRef?.remove();
      mapRef = null;
    };
  });
</script>

{#if error}
  <div class="map-err">Map unavailable — {error}</div>
{:else}
  <div class="place-map" bind:this={container} style="height: {height}"></div>
{/if}

<style>
  .place-map {
    width: 100%;
    border: 1px solid var(--line-strong);
    background: var(--surface-sunken);
  }
  .map-err {
    padding: 0.75rem;
    border: 1px dashed var(--line-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
</style>
