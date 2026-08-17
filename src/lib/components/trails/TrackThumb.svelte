<script lang="ts">
  // The shape of a route, drawn from the stored encoded polyline. A list of 100
  // activities renders 100 of these, so it must never instantiate a map: it is
  // one <path>, no tiles, no network.
  import { decodePolyline } from '$lib/health/polyline';

  let {
    polyline,
    size = 52,
  }: {
    polyline: string | null | undefined;
    size?: number;
  } = $props();

  const points = $derived(polyline ? decodePolyline(polyline) : []);

  const path = $derived.by(() => {
    if (points.length < 2) return '';

    let north = -Infinity;
    let south = Infinity;
    let east = -Infinity;
    let west = Infinity;
    for (const [lat, lng] of points) {
      if (lat > north) north = lat;
      if (lat < south) south = lat;
      if (lng > east) east = lng;
      if (lng < west) west = lng;
    }

    // Longitude degrees shrink with latitude. Without this the same loop looks
    // stretched east-west at 53°N — the shape would be wrong, not just ugly.
    const latSpan = north - south || 1e-6;
    const lngSpan = (east - west || 1e-6) * Math.cos(((north + south) / 2) * (Math.PI / 180));

    const pad = 3;
    const inner = size - pad * 2;
    const scale = Math.min(inner / lngSpan, inner / latSpan);
    const offsetX = pad + (inner - lngSpan * scale) / 2;
    const offsetY = pad + (inner - latSpan * scale) / 2;

    return points
      .map(([lat, lng], i) => {
        const x = offsetX + (lng - west) * Math.cos(((north + south) / 2) * (Math.PI / 180)) * scale;
        // SVG y grows downward; north belongs at the top.
        const y = offsetY + (north - lat) * scale;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join('');
  });
</script>

{#if path}
  <svg class="thumb" width={size} height={size} viewBox="0 0 {size} {size}" aria-hidden="true">
    <path d={path} />
  </svg>
{:else}
  <span class="thumb thumb-empty" style:width="{size}px" style:height="{size}px" aria-hidden="true"
  ></span>
{/if}

<style>
  .thumb {
    display: block;
    flex-shrink: 0;
    border: 1px solid var(--line-hair);
    background: var(--surface-sunken);
  }

  .thumb path {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
</style>
