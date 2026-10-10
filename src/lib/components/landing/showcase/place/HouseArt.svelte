<svelte:options css="injected" />

<script lang="ts" module>
  /** The house's fixed geometry, in its 1000 × 520 scene. */
  export const HOUSE = {
    h: 520,
    ground: 488,
    block: { x: 352, y: 126, w: 128 },
    windows: { x: 362, y: 146, w: 108, h: 324 },
    cottage: { x: 594, w: 214, wall: 404, peak: 334 },
    window: { x: 634, y: 420, w: 92, h: 42 },
    phone: { x: 660, y: 430, w: 16, h: 30 },
    watch: { x: 692, y: 446, w: 12, h: 14 },
    door: { x: 758, y: 428, w: 22 },
    mast: { x: 942, top: 150, foot: 316 },
  } as const;
</script>

<script lang="ts">
  // The app, drawn: a house with a light on. A block of tiny windows stands
  // behind it, one per doorway the app can knock on, lighting one by one as
  // the count climbs; in the cottage's lit window a phone and a watch sit on
  // the sill, and once every window is lit one dashed radio arc runs from
  // the phone to the mast on the hill, whose lamp blinks as it arrives. The
  // walk's dotted footpath comes in along the ground to the cottage door. A
  // picture only; PlaceScene's labels carry every number.
  import { scatter } from '$lib/landing/showcase-place';
  import { scenery } from '$lib/landing/ramblers/scenery';

  let { lights }: { lights: Array<{ x: number; y: number; w: number; h: number; d: number }> } = $props();

  const b = HOUSE.block;
  const c = HOUSE.cottage;
  const wn = HOUSE.window;
  const p = HOUSE.phone;
  const wt = HOUSE.watch;
  const m = HOUSE.mast;
  const sill = wn.y + wn.h;
  const stars = scatter(30, { x: 520, y: 14, w: 470, h: 110 }, [], 515, 26);
  // One radio arc from the phone, up over the roof and across to the mast's lamp.
  const ARC = `M${p.x + p.w / 2},${p.y - 2} Q${p.x + 100},${m.top + 4} ${m.x - 6},${m.top - 2}`;
  // The walk's footpath, in along the ground to the door.
  const TRAIL = `M-2000,${HOUSE.ground - 3} H${HOUSE.door.x + HOUSE.door.w / 2}`;
  const lattice = (() => {
    let d = `M${m.x - 9},${m.foot} L${m.x - 1.5},${m.top} M${m.x + 9},${m.foot} L${m.x + 1.5},${m.top}`;
    for (let y = m.foot - 14, k = 0; y > m.top + 8; y -= 18, k++) {
      const t = (m.foot - y) / (m.foot - m.top);
      const half = 9 - 7.5 * t;
      d += k % 2 ? ` M${m.x - half},${y} L${m.x + half},${y - 18}` : ` M${m.x + half},${y} L${m.x - half},${y - 18}`;
    }
    return d;
  })();
</script>

<svg viewBox="0 0 1000 {HOUSE.h}" preserveAspectRatio="none" focusable="false">
  <defs>
    <!-- The arc draws itself: a solid stroke revealing the dashed one. -->
    <mask id="sp-hs-reveal" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height={HOUSE.h}>
      <path class="hs-reveal" d={ARC} pathLength="1" />
    </mask>
    <clipPath id="sp-hs-sky"><rect x="-2000" y="0" width="5000" height={HOUSE.ground} /></clipPath>
    <radialGradient id="sp-hs-glow">
      <stop offset="0" stop-color="#f6cf8a" stop-opacity="0.5" />
      <stop offset="1" stop-color="#f6cf8a" stop-opacity="0" />
    </radialGradient>
  </defs>

  <g class="hs-stars">
    {#each stars as [x, y], i (i)}<circle cx={x} cy={y} r={i % 5 ? 0.9 : 1.4} />{/each}
  </g>

  <!-- The hill and the mast. -->
  <path class="hs-hill" d="M790,{HOUSE.ground} C850,470 884,328 930,318 C962,312 988,318 1000,322 L3000,322 L3000,{HOUSE.ground} Z" />
  <path class="hs-crest" d="M790,{HOUSE.ground} C850,470 884,328 930,318 C962,312 988,318 1000,322 L3000,322" />
  <g class="hs-mast" data-part="siri">
    <path class="ma-frame" d={lattice} />
    <circle class="ma-flash" cx={m.x} cy={m.top - 4} r="10" />
    <circle class="ma-lamp" cx={m.x} cy={m.top - 4} r="3" />
    <path class="ma-wave" d="M{m.x - 14},{m.top - 16} A18,18 0 0 1 {m.x + 14},{m.top - 16} M{m.x - 22},{m.top - 22} A28,28 0 0 1 {m.x + 22},{m.top - 22}" />
  </g>

  <path class="hs-trail" d={TRAIL} />

  <!-- The doorways: a block of windows, one for each, lit one by one. -->
  <g class="hs-block" data-part="areas">
    <rect class="bl-wall" x={b.x} y={b.y} width={b.w} height={HOUSE.ground - b.y} />
    <path class="bl-top" d="M{b.x - 4},{b.y} H{b.x + b.w + 4} M{b.x + b.w - 34},{b.y} V{b.y - 14} H{b.x + b.w - 12} V{b.y}" />
    {#each lights as l, i (i)}<rect class="bl-win" x={l.x} y={l.y} width={l.w} height={l.h} style:--d="{l.d}ms" />{/each}
  </g>

  <!-- The cottage with a light on, and what's on the sill. -->
  <g class="hs-home">
    <rect class="co-wall" x={c.x + 8} y={c.wall} width={c.w - 16} height={HOUSE.ground - c.wall} />
    <path class="co-roof" d="M{c.x},{c.wall + 2} L{c.x + c.w / 2},{c.peak} L{c.x + c.w},{c.wall + 2} Z" />
    <rect class="co-chim" x={c.x + c.w * 0.74} y={c.peak + 14} width="12" height="26" />
    <circle class="co-halo" cx={wn.x + wn.w / 2} cy={wn.y + wn.h / 2} r="80" clip-path="url(#sp-hs-sky)" />
  </g>
  <g class="hs-lock" data-part="lock">
    <rect class="co-win" x={wn.x} y={wn.y} width={wn.w} height={wn.h} />
    <path class="co-bars" d="M{wn.x + wn.w / 2},{wn.y} V{sill} M{wn.x},{wn.y + wn.h * 0.42} H{wn.x + wn.w}" />
  </g>
  <g class="hs-games" data-part="games">
    <rect class="co-door" x={HOUSE.door.x} y={HOUSE.door.y} width={HOUSE.door.w} height={HOUSE.ground - HOUSE.door.y} />
    <circle class="co-knob" cx={HOUSE.door.x + HOUSE.door.w - 5} cy={HOUSE.door.y + 32} r="1.4" />
    <!-- The attic light: someone's playing. -->
    <path class="co-attic" d="M{c.x + c.w / 2 - 10},{c.wall - 14} h20 v-16 a10,10 0 0 0 -20,0 Z" />
  </g>
  <rect class="co-sill" x={wn.x - 6} y={sill} width={wn.w + 12} height="5" />
  <g class="hs-phone" data-part="phone">
    <rect class="ph-glow" x={p.x - 10} y={p.y - 10} width={p.w + 20} height={p.h + 14} rx="10" />
    <rect class="ph-body" x={p.x} y={p.y} width={p.w} height={p.h} rx="2.6" />
    <rect class="ph-screen" x={p.x + 1.6} y={p.y + 2.2} width={p.w - 3.2} height={p.h - 4.4} rx="1.6" />
    <rect class="ph-bar" x={p.x + 3} y={p.y + p.h - 10} width={p.w - 6} height="3" rx="1.5" />
    <rect class="ph-done" x={p.x + 3} y={p.y + p.h - 10} width={(p.w - 6) * 0.6} height="3" rx="1.5" />
  </g>
  <g class="hs-watch" data-part="watch">
    <path class="wa-strap" d="M{wt.x + 2},{wt.y} V{wt.y - 5} M{wt.x + wt.w - 2},{wt.y} V{wt.y - 5}" />
    <rect class="wa-body" x={wt.x} y={wt.y} width={wt.w} height={wt.h} rx="3" />
    <circle class="wa-ring" cx={wt.x + wt.w / 2} cy={wt.y + wt.h / 2} r="3.4" />
  </g>
  <g class="hs-arcs" data-part="siri">
    <path class="arc" d={ARC} mask="url(#sp-hs-reveal)" />
  </g>
</svg>
<!-- The block's flat roof, short of the stair housing, is a step for the rambler. -->
<span
  class="hs-step"
  style:left="{((b.x + 10) / 1000) * 100}%"
  style:width="{((b.w - 50) / 1000) * 100}%"
  style:top="{(b.y / HOUSE.h) * 100}%"
  use:scenery
></span>

<style>
  .hs-step {
    position: absolute;
    height: 1px;
  }
  .hs-stars circle {
    fill: rgba(239, 230, 214, 0.55);
  }
  .hs-hill {
    fill: #101818;
  }
  .hs-crest {
    fill: none;
    stroke: rgba(127, 184, 192, 0.5);
    stroke-width: 1.1;
  }
  .ma-frame {
    fill: none;
    stroke: rgba(237, 228, 212, 0.48);
    stroke-width: 1;
  }
  .ma-lamp {
    fill: var(--accent-on-dark);
  }
  .ma-wave,
  .arc {
    fill: none;
    stroke: rgba(127, 184, 192, 0.6);
    stroke-width: 1.2;
    stroke-linecap: round;
  }
  .arc {
    stroke-dasharray: 2 5;
  }
  .hs-reveal {
    fill: none;
    stroke: #fff;
    stroke-width: 10;
    stroke-dasharray: 1;
    stroke-dashoffset: 0;
  }
  .ma-flash {
    fill: rgba(246, 207, 138, 0.5);
    opacity: 0;
  }
  .hs-trail {
    fill: none;
    stroke: rgba(237, 228, 212, 0.5);
    stroke-width: 2;
    stroke-dasharray: 0.5 5;
    stroke-linecap: round;
  }
  .bl-wall {
    fill: #120d0a;
    stroke: rgba(237, 228, 212, 0.24);
    stroke-width: 0.9;
  }
  .bl-top {
    fill: #120d0a;
    stroke: rgba(237, 228, 212, 0.3);
    stroke-width: 0.9;
  }
  .bl-win {
    fill: #f0a24e;
  }
  .bl-win:nth-child(3n + 2) {
    fill: #f6cf8a;
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
  .co-halo {
    fill: url(#sp-hs-glow);
  }
  .co-win {
    fill: #f0a24e;
    stroke: #f6cf8a;
    stroke-width: 1;
  }
  .co-bars {
    stroke: #3a2614;
    stroke-width: 2;
  }
  .co-sill {
    fill: #2c2119;
    stroke: rgba(237, 228, 212, 0.4);
    stroke-width: 0.8;
  }
  .co-door {
    fill: #070504;
    stroke: rgba(237, 228, 212, 0.26);
    stroke-width: 0.8;
  }
  .co-knob {
    fill: rgba(237, 228, 212, 0.6);
  }
  .co-attic {
    fill: #f6cf8a;
    stroke: rgba(237, 228, 212, 0.4);
    stroke-width: 0.8;
  }
  .ph-glow {
    fill: rgba(255, 241, 214, 0.18);
  }
  .ph-body {
    fill: #0b0806;
  }
  .ph-screen {
    fill: #fff1d6;
  }
  .ph-bar {
    fill: rgba(58, 38, 20, 0.3);
  }
  .ph-done {
    fill: var(--accent);
  }
  .wa-strap {
    stroke: #0b0806;
    stroke-width: 6;
  }
  .wa-body {
    fill: #0b0806;
    stroke: rgba(237, 228, 212, 0.5);
    stroke-width: 0.8;
  }
  .wa-ring {
    fill: none;
    stroke: var(--good-on-dark);
    stroke-width: 1.6;
  }

  /* The flourish: the doorways light one by one as the count climbs, then
     the arc runs out to the mast and its lamp blinks, once. */
  :global(.sp-scene[data-arm]) .bl-win {
    opacity: 0;
  }
  :global(.sp-scene[data-arm]) .hs-reveal {
    stroke-dashoffset: 1;
  }
  :global(.sp-scene[data-play]) .bl-win {
    animation: sp-hs-on 260ms ease-out var(--d) both;
  }
  :global(.sp-scene[data-play]) .hs-reveal {
    animation: sp-hs-draw 800ms ease-in-out 1150ms both;
  }
  :global(.sp-scene[data-play]) .ma-flash {
    animation: sp-hs-blink 700ms ease-out 1950ms both;
  }
  @keyframes sp-hs-on {
    0% {
      opacity: 0;
    }
    60% {
      opacity: 1;
    }
    80% {
      opacity: 0.6;
    }
    100% {
      opacity: 1;
    }
  }
  @keyframes sp-hs-blink {
    0%,
    100% {
      opacity: 0;
    }
    30% {
      opacity: 1;
    }
  }
  @keyframes sp-hs-draw {
    from {
      stroke-dashoffset: 1;
    }
    to {
      stroke-dashoffset: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bl-win,
    .hs-reveal,
    .ma-flash {
      animation: none !important;
    }
  }
</style>
