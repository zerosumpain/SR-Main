<svelte:options css="injected" />

<script lang="ts" module>
  /** The long walk's fixed geometry, in its 1000 × 600 scene. */
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
  // The health record, drawn: a hillside of contour lines with the year on
  // foot coming down it as one long path (a post every milestone; no day is
  // marked on it, the path being distance, not time), a festoon of lanterns for the month's recovery readings, a
  // row of trees for the last thirty days of steps with a dashed line at ten
  // thousand, a moon filling with the week's sleep, and a cottage whose
  // window glows once a beat while the pulse is fresh. A picture only;
  // PlaceScene's labels carry every number.
  import type { Band, Tree, Walk } from '$lib/landing/showcase-place';
  import { scenery } from '$lib/landing/ramblers/scenery';

  let {
    lines,
    path,
    trees,
    tenK,
    pitch,
    lamps,
    string,
    moonLit,
    glow,
  }: {
    lines: string[];
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
  } = $props();

  const { cx, cy, r } = WALK.moon;
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
</script>

<svg viewBox="0 0 1000 {WALK.h}" preserveAspectRatio="none" focusable="false">
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

  <!-- The hillside: contour lines, texture only. -->
  <g class="wk-lines">
    {#each lines as d, i (i)}<path {d} />{/each}
  </g>

  <!-- Sleep: the moon, filling towards full. -->
  <g class="wk-moon" data-part="sleep">
    <circle class="mo-ring" {cx} {cy} {r} />
    {#if moonLit && moonLit.d}<path class="mo-lit" d={moonLit.d} />{/if}
  </g>

  <!-- The year on foot and its milestones. -->
  <g class="wk-walk" data-part="km">
    <path class="wk-trail" d={path.d} mask="url(#sp-wl-reveal)" />
    {#each path.posts as p, i (i)}
      <path class="wk-post" d="M{p.x},{p.y - 1} V{p.y - 9}" style:--i={i} />
      <circle class="wk-cap" cx={p.x} cy={p.y - 9.5} r="1.4" style:--i={i} />
    {/each}
    <path class="wk-gate" d="M{path.end[0] - 6},{path.end[1] + 8} V{path.end[1] - 6} M{path.end[0] + 6},{path.end[1] + 8} V{path.end[1] - 6} M{path.end[0] - 7},{path.end[1] - 2} H{path.end[0] + 7} M{path.end[0] - 7},{path.end[1] + 3} H{path.end[0] + 7}" />
  </g>

  <!-- Recovery: thirty lanterns on a string, good mornings first. -->
  <g class="wk-lamps" data-part="recovery">
    {#if lamps.length}
      <path class="wk-pole" d="M{WALK.string.from[0]},{WALK.string.from[1] - 6} V{WALK.trees.y} M{WALK.string.to[0]},{WALK.string.to[1] - 6} V{WALK.trees.y}" />
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

  <!-- The last thirty days: a tree a day, as tall as its steps. -->
  <g class="wk-trees" data-part="over">
    {#each trees as t (t.i)}
      <path
        class="tree"
        class:over={t.over}
        d="M{t.x},{base - t.h} L{t.x + tw / 2},{base - 4} L{t.x - tw / 2},{base - 4} Z"
      />
      <path class="trunk" d="M{t.x},{base - 4} V{base}" />
      {#if t.tallest}<circle class="tree-top" cx={t.x} cy={base - t.h - 4} r="2.6" />{/if}
    {/each}
    {#if tenK != null}
      <path class="wk-ten" d="M{WALK.trees.x - 6},{tenK} H{WALK.trees.x + WALK.trees.w + 4}" />
    {/if}
  </g>

  <!-- Today: the cottage, its window glowing with the pulse. -->
  <g class="wk-home" data-part="today">
    <rect class="co-wall" x={c.x + 6} y={c.wall} width={c.w - 12} height={WALK.ground - c.wall} />
    <path class="co-roof" d="M{c.x},{c.wall + 2} L{c.x + c.w / 2},{c.peak} L{c.x + c.w},{c.wall + 2} Z" />
    <rect class="co-chim" x={c.x + c.w * 0.72} y={c.peak + 6} width="10" height="22" />
    <rect class="co-door" x={c.x + c.w - 46} y={c.wall + 26} width="18" height={WALK.ground - c.wall - 26} />
    {#if glow}<circle class="co-halo" cx={w.x + w.w / 2} cy={w.y + w.h / 2} r="40" clip-path="url(#sp-wl-sky)" />{/if}
    <rect class="co-win" class:lit={glow} x={w.x} y={w.y} width={w.w} height={w.h} />
    <path class="co-bars" d="M{w.x + w.w / 2},{w.y} V{w.y + w.h} M{w.x},{w.y + w.h / 2} H{w.x + w.w}" />
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
  .wk-lines path {
    fill: none;
    stroke: rgba(127, 184, 192, 0.12);
    stroke-width: 1;
  }
  .wk-lines path:nth-child(4n + 1) {
    stroke: rgba(127, 184, 192, 0.2);
  }
  .mo-ring {
    fill: #0e1112;
    stroke: rgba(237, 228, 212, 0.45);
    stroke-width: 1;
  }
  .mo-lit {
    fill: #efe6d6;
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
  .wk-pole {
    stroke: rgba(237, 228, 212, 0.22);
    stroke-width: 1.2;
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
  .tree {
    fill: #121a19;
    stroke: rgba(237, 228, 212, 0.34);
    stroke-width: 0.9;
    stroke-linejoin: round;
  }
  .tree.over {
    fill: #2b4a4e;
    stroke: rgba(127, 184, 192, 0.75);
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
    fill: #1d1611;
    stroke: rgba(237, 228, 212, 0.32);
    stroke-width: 0.9;
  }
  .co-roof {
    fill: #120d0a;
    stroke: rgba(237, 228, 212, 0.42);
    stroke-width: 0.9;
    stroke-linejoin: round;
  }
  .co-chim {
    fill: #1d1611;
    stroke: rgba(237, 228, 212, 0.3);
    stroke-width: 0.8;
  }
  .co-door {
    fill: #070504;
  }
  .co-win {
    fill: #1b130d;
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
    stroke: #1b130d;
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
