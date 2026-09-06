<script lang="ts">
  import { loadMapbox, type MapView } from '$lib/maps/loader';
  /** Owner-gated household positions, with labelled freshness markers. */
  import { onMount } from 'svelte';

  export interface FamilyPosition {
    subject: string;
    lat: number;
    lon: number;
    isHome: boolean | null;
    ageMins: number;
  }

  let {
    positions,
    height = '300px',
  }: { positions: FamilyPosition[]; height?: string } = $props();

  let container: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);

  // Plain let — a handle, nothing reactive reads it.
  let mapRef: MapView | null = null;

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const M = await loadMapbox();
        if (cancelled || !container || positions.length === 0) return;
        const map = M.map(container, { scrollWheelZoom: false, zoomControl: true });
        mapRef = map;

        for (const p of positions) {
          const stale = p.ageMins > 60;
          const marker = M.circleMarker([p.lat, p.lon], {
            radius: 8,
            color: '#faf7f1',
            weight: 2,
            fillColor: stale ? '#8a8272' : p.isHome ? '#3a8a56' : '#c4570a',
            fillOpacity: 0.95,
          });
          marker.bindTooltip(
            `${p.subject.charAt(0).toUpperCase()}${p.subject.slice(1)}${stale ? ` · ${p.ageMins}m ago` : ''}`,
            { permanent: true, direction: 'top', offset: [0, -8], className: 'fam-tip' },
          );
          marker.addTo(map);
        }

        if (positions.length === 1) {
          map.setView([positions[0].lat, positions[0].lon], 15);
        } else {
          map.fitBounds(M.latLngBounds(positions.map((p) => [p.lat, p.lon] as [number, number])), {
            padding: [36, 36],
            maxZoom: 15,
          });
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

{#if error}
  <p class="map-error">Map failed to load: {error}</p>
{:else}
  <div class="fam-map" bind:this={container} style="height: {height}"></div>
{/if}

<style>
  .fam-map {
    width: 100%;
    border: 1px solid var(--card-border);
    background: var(--bg-section);
  }
  .map-error {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: #c44;
  }
  :global(.fam-tip) {
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-label-xs, 12px);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
</style>
