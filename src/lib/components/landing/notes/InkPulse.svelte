<svelte:options css="injected" />

<script lang="ts">
  // The notes view's heartbeat: a hand-inked ECG that underlines the title
  // and runs on into the ring round the reading. The stroke is static, its
  // wobble baked in by inkHeart (notes-ink.ts); the only motion is a pen nib
  // and a short bright tail travelling along it, a stroke-dashoffset run on
  // pathLength=1 whose duration is `--beats` × `--beat` (set by the view), so
  // the nib crosses one beat per real heartbeat with no script per frame.
  // Decoration: the reading beside it says everything the line shows.
  import type { InkHeart } from '$lib/landing/notes-ink';

  let {
    line,
    moving,
    width = $bindable(880),
    height = $bindable(64),
  }: {
    line: InkHeart;
    /** Whether the nib runs: a fresh reading, not held still, on screen. */
    moving: boolean;
    /** The drawn size in pixels, measured here and handed back for the geometry. */
    width?: number;
    height?: number;
  } = $props();

  // The tail as a share of the strip: most of a beat, so it reads as wet ink.
  let tail = $derived(Math.round((0.55 / Math.max(1, line.beats)) * 10_000) / 10_000);
</script>

<div class="ip" class:live={line.beats > 0} aria-hidden="true" bind:clientWidth={width} bind:clientHeight={height}>
  <svg viewBox="0 0 {width} {height}" preserveAspectRatio="none" focusable="false">
    <path class="base" d={line.d} />
    {#if moving && line.beats > 0}
      <!-- Four values, not three: an odd dash list repeats to make it even. -->
      <path class="run tail" d={line.d} pathLength="1" data-beat style:stroke-dasharray="0 {3 - tail} {tail} 0" />
      <path class="run nib" d={line.d} pathLength="1" data-beat />
    {/if}
  </svg>
</div>

<style>
  .ip {
    height: 100%;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  path {
    fill: none;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  /* No reading: a flat pencil line in the margin, not pretending to beat. */
  .base {
    stroke: var(--on-ink-30);
    stroke-width: 1.5;
  }
  .live .base {
    stroke: var(--accent-on-dark);
    stroke-width: 2;
    opacity: 0.62;
  }
  .run {
    stroke-dashoffset: 0;
    animation: ip-run calc(var(--beat, 1s) * var(--beats, 1)) linear infinite;
  }
  .tail {
    stroke: var(--accent-on-dark);
    stroke-width: 2.25;
    stroke-linecap: butt;
  }
  /* The nib: a dot of fresh ink at the head of the tail. */
  .nib {
    stroke: #ffd9b3;
    stroke-width: 5;
    stroke-dasharray: 0 3;
  }
  @keyframes ip-run {
    to {
      stroke-dashoffset: -1;
    }
  }
  /* Still: the whole line in full ink, its spacing still the real rate. */
  :global(.hn[data-still]) .live .base {
    opacity: 0.85;
  }
  @media (prefers-reduced-motion: reduce) {
    .run {
      display: none;
    }
    .live .base {
      opacity: 0.85;
    }
  }
  @media print {
    .base,
    .live .base {
      stroke: #1a1008;
      opacity: 1;
    }
    .run {
      display: none;
    }
  }
</style>
