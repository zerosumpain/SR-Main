<svelte:options css="injected" namespace="svg" />

<script lang="ts">
  // Where the light may fall in a scene: everywhere but the copy column (the
  // heading and plate, on a desktop; showcase-city column(), with a soft edge)
  // and the boxes where words or charts stand. A scene's skyline glow, its
  // sunlit faces, glints and sheen, the air over the far street and the
  // landmarks' lit parts are all drawn through it, so nothing lighter than
  // the ceiling ever lands behind type (showcase-city.ts).
  import { column } from '$lib/landing/showcase-city';
  import type { Box } from '$lib/landing/showcase-place';

  let { id, side, h, boxes = [] }: { id: string; side: 'l' | 'r'; h: number; boxes?: Box[] } = $props();

  let col = $derived(column(side));
</script>

<defs>
  <linearGradient id="{id}-edge" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color={side === 'l' ? '#000' : '#fff'} />
    <stop offset="1" stop-color={side === 'l' ? '#fff' : '#000'} />
  </linearGradient>
  <!-- The boxes' edges are soft, so the light falls away round the words rather than stopping in a rectangle. -->
  <filter id="{id}-soft" x="-0.5" y="-0.5" width="2" height="2" filterUnits="objectBoundingBox">
    <feGaussianBlur stdDeviation="10" />
  </filter>
  <mask {id} maskUnits="userSpaceOnUse" x="-4000" y="-1000" width="9000" height={h + 2000}>
    <rect x="-4000" y="-1000" width="9000" height={h + 2000} fill="#fff" />
    {#if side === 'l'}
      <rect x={col.from} y="-1000" width={col.to - col.from} height={h + 2000} fill="#000" />
      <rect x={col.to} y="-1000" width={col.fade} height={h + 2000} fill="url(#{id}-edge)" />
    {:else}
      <rect x={col.from - col.fade} y="-1000" width={col.fade} height={h + 2000} fill="url(#{id}-edge)" />
      <rect x={col.from} y="-1000" width={col.to - col.from} height={h + 2000} fill="#000" />
    {/if}
    <g filter="url(#{id}-soft)">
      {#each boxes as b, i (i)}<rect x={b.x - 16} y={b.y - 16} width={b.w + 32} height={b.h + 32} fill="#000" />{/each}
    </g>
  </mask>
</defs>
