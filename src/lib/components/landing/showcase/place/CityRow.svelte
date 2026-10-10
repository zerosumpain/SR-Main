<svelte:options css="injected" namespace="svg" />

<script lang="ts">
  // A street of towers behind a chapter (showcase-city skyline): scenery, not
  // data, lit by the owner's sky through the --city-* properties
  // PlaceShowcase sets. After dark the ribbon windows come on (--windows) and
  // the skyline glows sodium; by day the face on the sun's side is sunlit,
  // the glass carries a sheen of sky, the far street pales toward the sky, the sun-side edges glint gold as it sinks and each near tower
  // throws a shadow along the street away from the sun. Everything lighter
  // than the type's ceiling goes through the scene's text-safe mask (`safe`,
  // SafeMask.svelte). Only opacity follows the light; the colours are set.
  import { shadows, type Landmark, type Skyline } from '$lib/landing/showcase-city';

  let {
    line,
    far = false,
    side,
    reach = 0,
    base,
    safe,
    mark = null,
    glow = 0,
  }: {
    line: Skyline;
    /** A layer back: flatter, no faces or shadows, nearer the sky by day. */
    far?: boolean;
    /** Where the sun stands. */
    side: 'east' | 'west';
    /** How far the shadows run (cityLight's reach); none with the sun down. */
    reach?: number;
    /** The street, down the scene, where the shadows fall. */
    base: number;
    /** The scene's text-safe mask's id. */
    safe: string;
    /** The chapter's landmark, if it stands in this row. */
    mark?: Landmark | null;
    /** How tall the glow along the skyline is, in scene units (0: none; drawn behind the far row). */
    glow?: number;
  } = $props();

  let shade = $derived(far ? '' : shadows(line.towers, side, reach, base));
  let east = $derived(side === 'east');
</script>

<g class="cr" class:far>
  {#if glow > 0}
    <defs>
      <linearGradient id="{safe}-glow" x1="0" y1="0" x2="0" y2="1">
        <stop class="cr-glow-0" offset="0" />
        <stop class="cr-glow-1" offset="0.7" />
        <stop class="cr-glow-2" offset="1" />
      </linearGradient>
    </defs>
    <rect class="cr-glow" x="-4000" y={base - glow} width="9000" height={glow} fill="url(#{safe}-glow)" mask="url(#{safe})" />
  {/if}
  {#if shade}<path class="cr-shadow" d={shade} />{/if}
  {#each line.towers as t (t.x)}<path class="cr-body" d={t.d} />{/each}
  {#if mark}<path class="cr-body cr-mark-body" d={mark.d} />{/if}
  {#if !far}<path class="cr-face" d={line.faceL + line.faceR} />{/if}
  <path class="cr-floors" d={line.floors} />
  <path class="cr-lit" d={line.lit} />
  <g mask="url(#{safe})">
    {#if !far}
      <path class="cr-sheen" d={line.sheen} />
      <path class="cr-sun" d={east ? line.sunL : line.sunR} />
    {/if}
    <path class="cr-detail" d={line.detail} />
    {#if mark}
      <path class="cr-mark" d={mark.marks} />
      {#if mark.glow}<path class="cr-lantern" d={mark.glow} />{/if}
    {/if}
    {#if !far}<path class="cr-glint" d={east ? line.edgeL : line.edgeR} />{/if}
  </g>
</g>

<style>
  .cr-glow-0 {
    stop-color: var(--city-haze, rgba(176, 112, 72, 0.2));
    stop-opacity: 0;
  }
  .cr-glow-1 {
    stop-color: var(--city-haze, rgba(176, 112, 72, 0.2));
    stop-opacity: 0.75;
  }
  .cr-glow-2 {
    stop-color: var(--city-haze, rgba(176, 112, 72, 0.2));
    stop-opacity: 1;
  }
  .cr-body {
    fill: var(--city-body, #0c1018);
    stroke: var(--city-edge, rgba(237, 228, 212, 0.14));
    stroke-width: 0.8;
  }
  .far .cr-body {
    fill: var(--city-far, #0e121b);
    stroke: rgba(237, 228, 212, 0.06);
  }
  .cr-face {
    fill: var(--city-shade, #080b11);
  }
  .cr-sheen {
    fill: #9cc0e0;
    opacity: var(--city-sheen-on, 0);
  }
  .cr-sun {
    fill: var(--city-sunlit, #cfe0ec);
    opacity: var(--city-sun-on, 0);
  }
  .cr-floors {
    fill: none;
    stroke: rgba(237, 228, 212, 0.05);
    stroke-width: 0.6;
  }
  .far .cr-floors {
    stroke: rgba(237, 228, 212, 0.03);
  }
  .cr-detail {
    fill: none;
    stroke: rgba(237, 228, 212, 0.07);
    stroke-width: 0.7;
  }
  .far .cr-detail {
    stroke: rgba(237, 228, 212, 0.045);
  }
  .cr-mark {
    fill: none;
    stroke: rgba(237, 228, 212, 0.12);
    stroke-width: 0.8;
  }
  .cr-lantern {
    fill: #f6c47a;
    opacity: calc(0.12 + 0.5 * var(--windows, 1));
  }
  .cr-lit {
    fill: #f6c47a;
    opacity: calc(var(--windows, 1) * 0.62);
  }
  .far .cr-lit {
    opacity: calc(var(--windows, 1) * 0.36);
  }
  .cr-glint {
    fill: none;
    stroke: var(--city-glint, #f08a3c);
    stroke-width: 1.2;
    opacity: var(--city-glint-on, 0);
  }
  .cr-shadow {
    fill: #000;
    opacity: var(--city-shadow, 0);
  }
  /* A phone: the faces are a few pixels wide, so the sun on them is quieter. */
  @media (max-width: 759px) {
    .cr-sun {
      opacity: calc(0.6 * var(--city-sun-on, 0));
    }
  }
</style>
