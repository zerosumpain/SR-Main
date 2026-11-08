<svelte:options css="injected" />

<script lang="ts" module>
  /** The long walk's fixed geometry, in its 1000 × 600 scene: `cottage` is the town house, `window` its front window. */
  export const WALK = {
    h: 600,
    ground: 560,
    moon: { cx: 604, cy: 60, r: 20 },
    trees: { x: 180, y: 452, w: 468, h: 104 },
    string: { from: [300, 300] as [number, number], to: [646, 306] as [number, number], sag: 22 },
    cottage: { x: 26, w: 144, wall: 488, peak: 438 },
    window: { x: 46, y: 502, w: 36, h: 28 },
  } as const;
</script>

<script lang="ts">
  // The health record, drawn as a walk through the city: the year on foot is
  // one long elevated walkway, a linear park winding down between the towers
  // (a distance marker every milestone; no day is marked on it, the walkway
  // being distance, not time), a festoon of lights over the street for the
  // month's recovery readings, a row of street trees for the last thirty
  // days of steps with a dashed line at ten thousand, a moon over the towers
  // filling with the week's sleep (still there by day, pale, as the moon so
  // often is), and a town house whose front window glows once a beat while
  // the pulse is fresh. A picture only; PlaceScene's labels carry every number.
  import { along, samplePath, WALK_POINTS, type Band, type Tree, type Walk } from '$lib/landing/showcase-place';
  import { landmark, skyline } from '$lib/landing/showcase-city';
  import type { Box } from '$lib/landing/showcase-place';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import CityRow from './CityRow.svelte';
  import SafeMask from './SafeMask.svelte';

  let {
    path,
    trees,
    tenK,
    pitch,
    lamps,
    string,
    moonLit,
    glow,
    light,
    quiet = [],
  }: {
    path: Walk;
    trees: Tree[];
    /** The ten-thousand line's height, or null with no trees. */
    tenK: number | null;
    pitch: number;
    lamps: Array<{ x: number; y: number; band: Band }>;
    string: string;
    /** The moon's lit part, or null for no reading (an outline). */
    moonLit: { share: number; d: string } | null;
    /** The window glows: a fresh pulse is in. */
    glow: boolean;
    /** Where the sun stands and how far its shadows run. */
    light: { side: 'east' | 'west'; reach: number };
    /** Where the labels stand: no tower window is lit behind them. */
    quiet?: Box[];
  } = $props();

  const { cx, cy, r } = WALK.moon;
  const G = WALK.ground;
  const base = WALK.trees.y + WALK.trees.h;
  const c = WALK.cottage;
  const w = WALK.window;
  let tw = $derived(Math.max(4, pitch * 0.72));
  // The string's ends, where it hardly sags: the first and last tenth of its span.
  const span = WALK.string.to[0] - WALK.string.from[0];
  const STEPS = [
    { x: WALK.string.from[0], w: span * 0.1, y: WALK.string.from[1] + WALK.string.sag * 0.18 },
    { x: WALK.string.to[0] - span * 0.1, w: span * 0.1, y: WALK.string.to[1] + WALK.string.sag * 0.18 },
  ];
  // The charts: the street trees with their ten-thousand line, and the
  // festoon. No scenery window is lit among them and no glint or sunlit face
  // runs through them, so the only lights there are the readings.
  const CHARTS = [
    { x: WALK.trees.x - 10, y: WALK.trees.y - 40, w: WALK.trees.w + 20, h: WALK.trees.h + 44 },
    { x: WALK.string.from[0] - 8, y: WALK.string.from[1] - 10, w: span + 16, h: WALK.string.sag + 34 },
  ];
  let hush = $derived([...quiet, ...CHARTS]);
  // A park street: lower blocks set wider apart, plain fronts, a diagrid
  // tower the one landmark. Low under the heading, clear of the town house,
  // unlit behind the type.
  const MARK = landmark('diagrid', 470, 54, 330, G);
  let FAR = $derived(skyline({ quiet: hush, seed: 21, street: 'park', from: -700, to: 1700, base: G, lo: 120, hi: 300, wide: [34, 80], gap: [4, 18], clear: [[462, 532]], low: [[660, 1060, 260]], dark: [[640, 1060]], litShare: 0.12 }));
  let NEAR = $derived(skyline({ quiet: hush, seed: 22, street: 'park', from: -700, to: 1700, base: G, lo: 70, hi: 210, wide: [50, 104], gap: [16, 44], clear: [[-6, 186]], low: [[660, 1060, 200]], dark: [[640, 1060]], litShare: 0.2 }));
  // The park on the walkway: planting along its rail.
  const SAMPLES = samplePath(WALK_POINTS);
  const PLANTS = Array.from({ length: 46 }, (_, i) => along(SAMPLES, (i + 0.5) / 46));
  // Piers under the lowest run, down to the street.
  const [a, b] = [WALK_POINTS[6], WALK_POINTS[7]];
  const PIERS = [150, 300, 450].map((x) => `M${x},${Math.round(a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]) + 5)}V${G}`).join('');
</script>

<svg viewBox="0 0 1000 {WALK.h}" preserveAspectRatio="none" focusable="false">
  <SafeMask id="sp-wl-safe" side="r" h={WALK.h} boxes={hush} />
  <defs>
    <!-- The path draws itself: a solid stroke revealing the dotted trail. -->
    <mask id="sp-wl-reveal" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height={WALK.h}>
      <path class="wk-reveal" d={path.d} pathLength="1" />
    </mask>
    <clipPath id="sp-wl-sky"><rect x="-2000" y="0" width="5000" height={WALK.ground} /></clipPath>
    <radialGradient id="sp-wl-glow">
      <stop offset="0" stop-color="#f6cf8a" stop-opacity="0.7" />
      <stop offset="1" stop-color="#f6cf8a" stop-opacity="0" />
    </radialGradient>
  </defs>

  <!-- Sleep: the moon over the towers, filling towards full. -->
  <g class="wk-moon" data-part="sleep">
    <circle class="mo-ring" {cx} {cy} {r} />
    {#if moonLit && moonLit.d}<path class="mo-lit" d={moonLit.d} />{/if}
  </g>

  <!-- The street: a layer back, then the towers the walkway winds between. -->
  <CityRow line={FAR} far side={light.side} base={G} safe="sp-wl-safe" mark={MARK} glow={300} />
  <CityRow line={NEAR} side={light.side} reach={light.reach} base={G} safe="sp-wl-safe" />
  <path class="wk-pier" d={PIERS} />

  <!-- The year on foot: the elevated walkway, its planting and its distance markers. -->
  <g class="wk-walk" data-part="km">
    <path class="wk-edge" d={path.d} />
    <path class="wk-deck" d={path.d} />
    <path class="wk-rail" d={path.d} />
    {#each PLANTS as [x, y], i (i)}<circle class="wk-plant" cx={x} cy={y - 4.5} r={i % 3 ? 2 : 2.8} />{/each}
    <path class="wk-trail" d={path.d} mask="url(#sp-wl-reveal)" />
    {#each path.posts as p, i (i)}
      <path class="wk-post" d="M{p.x},{p.y - 1} V{p.y - 9}" style:--i={i} />
      <circle class="wk-cap" cx={p.x} cy={p.y - 9.5} r="1.4" style:--i={i} />
    {/each}
    <path class="wk-gate" d="M{path.end[0] - 6},{path.end[1] + 8} V{path.end[1] - 6} M{path.end[0] + 6},{path.end[1] + 8} V{path.end[1] - 6} M{path.end[0] - 7},{path.end[1] - 2} H{path.end[0] + 7} M{path.end[0] - 7},{path.end[1] + 3} H{path.end[0] + 7}" />
  </g>

  <!-- Recovery: thirty lights on a festoon over the street, good mornings first. -->
  <g class="wk-lamps" data-part="recovery">
    {#if lamps.length}
      <path class="wk-pole" d="M{WALK.string.from[0]},{WALK.string.from[1] - 6} V{G} M{WALK.string.to[0]},{WALK.string.to[1] - 6} V{G}" />
      <path class="wk-pole-cap" d="M{WALK.string.from[0] - 4},{WALK.string.from[1] - 6} h8 M{WALK.string.to[0] - 4},{WALK.string.to[1] - 6} h8" />
      <path class="wk-string" d={string} />
      {#each lamps as l, i (i)}
        <g class="lamp" data-band={l.band} style:--i={i}>
          <path class="la-wire" d="M{l.x},{l.y} v4" />
          {#if l.band === 'high'}<circle class="la-glow" cx={l.x} cy={l.y + 10} r="9" />{/if}
          <rect class="la-body" x={l.x - 2.75} y={l.y + 4} width="5.5" height="9" rx="1.5" />
          {#if l.band === 'mid'}<rect class="la-half" x={l.x - 2.75} y={l.y + 8.5} width="5.5" height="4.5" />{/if}
        </g>
      {/each}
    {/if}
  </g>

  <!-- The last thirty days: a street tree a day, as tall as its steps. -->
  <g class="wk-trees" data-part="over">
    <rect class="wk-verge" x={WALK.trees.x - 8} y={base - 2} width={WALK.trees.w + 14} height="4" />
    {#each trees as t (t.i)}
      {@const cr = Math.max(1.6, Math.min(tw / 2, t.h / 2.4))}
      <path class="trunk" d="M{t.x},{base - t.h + cr} V{base}" />
      <circle class="tree" class:over={t.over} cx={t.x} cy={base - t.h + cr} r={cr} />
      {#if t.tallest}<circle class="tree-top" cx={t.x} cy={base - t.h - 4} r="2.6" />{/if}
    {/each}
    {#if tenK != null}
      <path class="wk-ten" d="M{WALK.trees.x - 6},{tenK} H{WALK.trees.x + WALK.trees.w + 4}" />
    {/if}
  </g>

  <!-- Today: the town house, its front window glowing with the pulse. -->
  <g class="wk-home" data-part="today">
    <!-- A modern terrace: flat roof and a glass balustrade, a full-width glazed upper floor, a set-back roof room. -->
    <rect class="co-wall" x={c.x + 6} y={c.peak} width={c.w - 12} height={G - c.peak} />
    <rect class="co-face" x={light.side === 'east' ? c.x + 6 : c.x + c.w - 18} y={c.peak} width="12" height={G - c.peak} />
    <rect class="co-sun" mask="url(#sp-wl-safe)" x={light.side === 'east' ? c.x + 6 : c.x + c.w - 18} y={c.peak} width="12" height={G - c.peak} />
    <rect class="co-room" x={c.x + c.w * 0.5} y={c.peak - 18} width="44" height="18" />
    <path class="co-rail" d="M{c.x + 4},{c.peak - 9} H{c.x + c.w * 0.5} M{c.x + 4},{c.peak - 9} V{c.peak}" />
    <rect class="co-slab" x={c.x + 2} y={c.peak - 3} width={c.w - 4} height="5" />
    <rect class="co-upper" x={c.x + 14} y={c.peak + 10} width={c.w - 28} height="36" />
    <path class="co-mull" d="M{c.x + 14 + (c.w - 28) / 4},{c.peak + 10} v36 M{c.x + c.w / 2},{c.peak + 10} v36 M{c.x + 14 + ((c.w - 28) * 3) / 4},{c.peak + 10} v36" />
    <path class="co-upper-lit" d="M{c.x + 16},{c.peak + 12}h{(c.w - 28) / 4 - 4}v32h{-((c.w - 28) / 4 - 4)}Z" />
    <rect class="co-slab" x={c.x + 4} y={c.wall - 2} width={c.w - 8} height="4" />
    <rect class="co-door" x={c.x + c.w - 46} y={c.wall + 26} width="18" height={G - c.wall - 26} />
    {#if glow}<circle class="co-halo" cx={w.x + w.w / 2} cy={w.y + w.h / 2} r="40" clip-path="url(#sp-wl-sky)" />{/if}
    <rect class="co-win" class:lit={glow} x={w.x} y={w.y} width={w.w} height={w.h} />
    <path class="co-bars" d="M{w.x + w.w / 2},{w.y} V{w.y + w.h}" />
  </g>
</svg>
<!-- The lantern string's two flat ends, by the poles, are steps for the
     rambler (the sagging middle is not: he would walk on air above it). -->
{#each STEPS as st (st.x)}
  <span
    class="wk-step"
    style:left="{(st.x / 1000) * 100}%"
    style:width="{(st.w / 1000) * 100}%"
    style:top="{(st.y / WALK.h) * 100}%"
    use:scenery
  ></span>
{/each}

<style>
  .wk-step {
    position: absolute;
    height: 1px;
  }
  /* On a phone the ends are too short to stand on. */
  @media (max-width: 759px) {
    .wk-step {
      display: none;
    }
  }
  .mo-ring {
    fill: var(--city-disc, #0e1112);
    stroke: rgba(237, 228, 212, 0.45);
    stroke-width: 1;
  }
  /* By day the moon is a pale cool disc in the blue, never a second sun; its share still reads. */
  .mo-lit {
    fill: var(--city-moon, #efe6d6);
    opacity: calc(0.45 + 0.55 * var(--moon, 1));
  }
  .wk-pier {
    stroke: var(--city-deck, #15171b);
    stroke-width: 5;
  }
  .wk-edge {
    fill: none;
    stroke: rgba(237, 228, 212, 0.2);
    stroke-width: 11;
    stroke-linejoin: round;
  }
  .wk-deck {
    fill: none;
    stroke: var(--city-deck, #15171b);
    stroke-width: 9;
    stroke-linejoin: round;
  }
  .wk-rail {
    fill: none;
    stroke: rgba(237, 228, 212, 0.3);
    stroke-width: 0.8;
    transform: translateY(-6px);
  }
  .wk-plant {
    fill: #2c4a3c;
  }
  .wk-reveal {
    fill: none;
    stroke: #fff;
    stroke-width: 14;
    stroke-dasharray: 1;
    stroke-dashoffset: 0;
  }
  .wk-trail {
    fill: none;
    stroke: rgba(237, 228, 212, 0.72);
    stroke-width: 2;
    stroke-dasharray: 0.5 5;
    stroke-linecap: round;
  }
  .wk-post {
    stroke: rgba(237, 228, 212, 0.62);
    stroke-width: 1.4;
  }
  .wk-cap {
    fill: var(--accent-on-dark);
  }
  .wk-gate {
    fill: none;
    stroke: rgba(237, 228, 212, 0.55);
    stroke-width: 1.2;
  }
  /* The festoon's poles run down past the labels: a hairline, no lighter than a tower's edge. */
  .wk-pole,
  .wk-pole-cap {
    stroke: rgba(237, 228, 212, 0.16);
    stroke-width: 1.4;
  }
  .wk-string {
    fill: none;
    stroke: rgba(237, 228, 212, 0.4);
    stroke-width: 0.9;
  }
  .la-wire {
    stroke: rgba(237, 228, 212, 0.4);
    stroke-width: 0.8;
  }
  .la-glow {
    fill: rgba(240, 162, 78, 0.22);
  }
  .la-body {
    fill: #0b0806;
    stroke: rgba(237, 228, 212, 0.45);
    stroke-width: 0.9;
  }
  .lamp[data-band='high'] .la-body {
    fill: #f0a24e;
    stroke: #f6cf8a;
  }
  .lamp[data-band='mid'] .la-body {
    stroke: var(--good-on-dark);
  }
  .la-half {
    fill: var(--good-on-dark);
  }
  .wk-verge {
    fill: var(--city-deck, #15171b);
  }
  .tree {
    fill: #121a19;
    stroke: rgba(237, 228, 212, 0.4);
    stroke-width: 0.9;
  }
  .tree.over {
    fill: #2b4a4e;
    stroke: rgba(127, 184, 192, 0.85);
  }
  .trunk {
    stroke: rgba(237, 228, 212, 0.34);
    stroke-width: 1;
  }
  .tree-top {
    fill: #f6cf8a;
  }
  .wk-ten {
    stroke: rgba(237, 228, 212, 0.6);
    stroke-width: 1;
    stroke-dasharray: 4 4;
  }
  .co-wall {
    fill: var(--city-body, #0c1018);
    stroke: rgba(237, 228, 212, 0.32);
    stroke-width: 0.9;
  }
  .co-face {
    fill: var(--city-shade, #080b11);
  }
  .co-sun {
    fill: var(--city-sunlit, #cfe0ec);
    opacity: var(--city-sun-on, 0);
  }
  .co-rail {
    fill: none;
    stroke: rgba(191, 227, 231, 0.4);
    stroke-width: 0.9;
  }
  .co-mull {
    stroke: rgba(237, 228, 212, 0.3);
    stroke-width: 1;
  }
  .co-slab,
  .co-room {
    fill: var(--city-deck, #15171b);
    stroke: rgba(237, 228, 212, 0.4);
    stroke-width: 0.8;
  }
  .co-upper {
    fill: var(--city-glass, #0d121b);
    stroke: rgba(237, 228, 212, 0.26);
    stroke-width: 0.8;
  }
  .co-upper-lit {
    fill: #f6c47a;
    opacity: calc(var(--windows, 1) * 0.6);
  }
  .co-door {
    fill: #070504;
  }
  .co-win {
    fill: #11161d;
    stroke: rgba(237, 228, 212, 0.4);
    stroke-width: 0.9;
  }
  .co-win.lit {
    fill: #f0a24e;
  }
  .co-halo {
    fill: url(#sp-wl-glow);
    opacity: 0.5;
  }
  .co-bars {
    stroke: #11161d;
    stroke-width: 2;
  }

  /* The flourish: the path draws itself as the year's steps count up, the
     milestones stand up behind it, the lanterns light along the string. */
  :global(.sp-scene[data-arm]) .wk-reveal {
    stroke-dashoffset: 1;
  }
  :global(.sp-scene[data-arm]) :is(.wk-post, .wk-cap, .lamp) {
    opacity: 0;
  }
  :global(.sp-scene[data-play]) .wk-reveal {
    animation: sp-wl-draw 1500ms cubic-bezier(0.25, 0.7, 0.3, 1) both;
  }
  :global(.sp-scene[data-play]) :is(.wk-post, .wk-cap) {
    animation: sp-wl-on 240ms ease-out calc(120ms + var(--i) * 70ms) both;
  }
  :global(.sp-scene[data-play]) .lamp {
    animation: sp-wl-on 260ms ease-out calc(600ms + var(--i) * 40ms) both;
  }
  /* The window glows once a beat, only while a fresh pulse beats (data-beat). */
  :global(.sp-scene[data-beat]) .co-halo {
    animation: sp-wl-beat var(--beat) ease-out infinite;
  }
  :global(.sp-scene[data-away]) .co-halo {
    animation-play-state: paused;
  }
  @keyframes sp-wl-draw {
    from {
      stroke-dashoffset: 1;
    }
    to {
      stroke-dashoffset: 0;
    }
  }
  @keyframes sp-wl-on {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes sp-wl-beat {
    0% {
      opacity: 0.95;
    }
    45%,
    100% {
      opacity: 0.4;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .wk-reveal,
    .wk-post,
    .wk-cap,
    .lamp,
    .co-halo {
      animation: none !important;
    }
  }
</style>
