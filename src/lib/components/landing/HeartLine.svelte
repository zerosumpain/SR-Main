<svelte:options css="injected" />

<script lang="ts">
  // The hero's heartbeat: one full-bleed line under the title, drawn at the
  // exact rate the watch last read and swept by a travelling head that crosses
  // one beat per real heartbeat. The geometry is pure (heartLine in traces.ts);
  // the sweep is CSS, a stroke-dashoffset run along pathLength=1 whose
  // duration is `--beats` × `--beat` (60/bpm seconds, set by the parent), so no
  // script touches it frame by frame. Decoration: the sentence below says
  // everything the line shows.
  import type { HeartLine } from '$lib/landing/traces';

  let {
    line,
    moving,
    width = $bindable(1440),
    height = $bindable(72),
  }: {
    line: HeartLine;
    /** Whether the sweep runs: a fresh reading, not held still, on screen. */
    moving: boolean;
    /** The drawn size in pixels, measured here and handed back for the geometry. */
    width?: number;
    height?: number;
  } = $props();

  // The fading tail is three dashes of falling length riding just behind the
  // head, so it reads as a glow trailing off without a gradient (which cannot
  // follow a path). Lengths are shares of one beat along the line.
  const TAIL = [
    { len: 0.85, op: 0.22 },
    { len: 0.45, op: 0.42 },
    { len: 0.16, op: 0.95 },
  ];
  // Four values, not three: an odd dash list is repeated to make it even,
  // which would add a second, long dash. The leading zero-length dash is the
  // pattern's origin, so the tail ends exactly where the head is.
  const dash = (len: number) => {
    const l = Math.round((len / Math.max(1, line.beats)) * 10_000) / 10_000;
    return `0 ${3 - l} ${l} 0`;
  };
</script>

<div class="hl" class:live={line.beats > 0} aria-hidden="true" bind:clientWidth={width} bind:clientHeight={height}>
  <svg viewBox="0 0 {width} {height}" preserveAspectRatio="none" focusable="false">
    <path class="base" d={line.d} />
    {#if moving && line.beats > 0}
      {#each TAIL as t (t.len)}
        <path class="run" d={line.d} pathLength="1" data-beat style:stroke-dasharray={dash(t.len)} style:opacity={t.op} />
      {/each}
      <path class="run halo" d={line.d} pathLength="1" data-beat />
      <path class="run head" d={line.d} pathLength="1" data-beat />
    {/if}
  </svg>
</div>

<style>
  .hl {
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
  }
  /* No reading: a flat, dim line. It does not pretend to beat. */
  .base {
    stroke: var(--on-ink-16);
    stroke-width: 1.25;
    /* Until the line is measured the server's 1440px drawing is stretched to
       fit; keep its stroke even while that lasts. */
    vector-effect: non-scaling-stroke;
  }
  .live .base {
    stroke: var(--accent-on-dark);
    opacity: 0.38;
  }
  .run {
    stroke: var(--accent-on-dark);
    stroke-width: 1.75;
    stroke-linecap: butt;
    stroke-dashoffset: 0;
    animation: hl-run calc(var(--beat, 1s) * var(--beats, 1)) linear infinite;
  }
  .head,
  .halo {
    stroke: #ffd2a8;
    stroke-linecap: round;
    stroke-dasharray: 0 3;
    stroke-width: 5;
  }
  .halo {
    stroke: var(--accent-on-dark);
    stroke-width: 14;
    opacity: 0.22;
  }
  /* The dash pattern's head sits at the start of the pattern, so walking the
     offset from 0 to -1 carries it from the left edge to the right in one
     run of the strip. */
  @keyframes hl-run {
    to {
      stroke-dashoffset: -1;
    }
  }

  /* Still: the whole trace drawn calm, its spacing still the real rate. */
  :global(.hs[data-still]) .live .base {
    opacity: 0.55;
  }
  @media (prefers-reduced-motion: reduce) {
    .run {
      display: none;
    }
    .live .base {
      opacity: 0.55;
    }
  }
</style>
