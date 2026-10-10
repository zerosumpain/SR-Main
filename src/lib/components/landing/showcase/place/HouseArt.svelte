<svelte:options css="injected" />

<script lang="ts" module>
  /** The street's fixed geometry, in its 1000 × 520 scene. */
  export const HOUSE = {
    h: 520,
    ground: 488,
    /** The office tower whose windows are the doorways. */
    block: { x: 352, y: 126, w: 128 },
    windows: { x: 362, y: 146, w: 108, h: 324 },
    /** The block of flats: its roof at `peak`; `wall` is where its upper floors start. */
    cottage: { x: 594, w: 214, wall: 404, peak: 334 },
    /** The flat with a light on: its window, and what's on the sill. */
    window: { x: 634, y: 420, w: 92, h: 42 },
    phone: { x: 660, y: 430, w: 16, h: 30 },
    watch: { x: 692, y: 446, w: 12, h: 14 },
    door: { x: 758, y: 428, w: 22 },
    /** The mast on the roof of the tower to the right. */
    mast: { x: 942, top: 150, foot: 316 },
  } as const;
</script>

<script lang="ts">
  // The app, drawn: a street of flats with one light on. An office tower
  // stands behind, a pane in its glass for every doorway the app can knock
  // on, lighting one by one as the count climbs (lamp-lit by night, bright
  // glass by day; the panes still to light stand dark). In the flat's lit
  // window a phone and a watch sit on the sill, and once every pane is lit
  // one dashed radio arc runs from the phone to the mast on the next roof,
  // whose lamp blinks as it arrives. Upstairs, one window is lit for the
  // family's games. The walk's dotted footpath comes in along the pavement to
  // the door. A picture only; PlaceScene's labels carry every number.
  import { scatter } from '$lib/landing/showcase-place';
  import { landmark, skyline } from '$lib/landing/showcase-city';
  import type { Box } from '$lib/landing/showcase-place';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import CityRow from './CityRow.svelte';
  import SafeMask from './SafeMask.svelte';

  let {
    lights,
    grid,
    light,
    quiet = [],
  }: {
    lights: Array<{ x: number; y: number; w: number; h: number; d: number }>;
    /** Every pane in the tower's grid, lit or not yet. */
    grid: string;
    /** Where the sun stands and how far its shadows run. */
    light: { side: 'east' | 'west'; reach: number };
    /** Where the labels stand: no tower window is lit behind them. */
    quiet?: Box[];
  } = $props();

  const G = HOUSE.ground;
  const b = HOUSE.block;
  const c = HOUSE.cottage;
  const wn = HOUSE.window;
  const p = HOUSE.phone;
  const wt = HOUSE.watch;
  const m = HOUSE.mast;
  const sill = wn.y + wn.h;
  // A few stars over the street (scenery), none among a label's words.
  let stars = $derived(scatter(30, { x: 520, y: 14, w: 470, h: 110 }, quiet, 515, 26));
  // One radio arc from the phone, up and across to the mast, between the Siri and Lock Screen labels.
  const ARC = `M${p.x + p.w / 2},${p.y - 2} C${p.x + p.w / 2},${m.top + 150} ${p.x + 40},${m.top + 66} ${p.x + 110},${m.top + 66} H${m.x - 5}`;
  // The walk's footpath, in along the pavement to the door.
  const TRAIL = `M-2000,${G - 3} H${HOUSE.door.x + HOUSE.door.w / 2}`;
  const lattice = (() => {
    let d = `M${m.x - 9},${m.foot} L${m.x - 1.5},${m.top} M${m.x + 9},${m.foot} L${m.x + 1.5},${m.top}`;
    for (let y = m.foot - 14, k = 0; y > m.top + 8; y -= 18, k++) {
      const t = (m.foot - y) / (m.foot - m.top);
      const half = 9 - 7.5 * t;
      d += k % 2 ? ` M${m.x - half},${y} L${m.x + half},${y - 18}` : ` M${m.x + half},${y} L${m.x - half},${y - 18}`;
    }
    return d;
  })();
  // The flats: five bays, three floors over the street, a balcony slab under each floor.
  const BAYS = [-80, -40, 0, 40, 80].map((dx) => c.x + c.w / 2 + dx - 9);
  const ROWS = [c.peak + 12, c.wall - 30, c.wall - 6];
  const FLATS = ROWS.flatMap((y) => BAYS.map((x) => `M${x},${y}h18v16h-18Z`)).join('');
  const SLABS = ROWS.map((y) => `M${c.x + 4},${y + 19}H${c.x + c.w - 4}`).join('');
  // The tower beside the flats, the mast on its roof.
  const tower = { x: m.x - 52, w: 170 };
  const TOWER_FINS = Array.from({ length: 10 }, (_, i) => `M${tower.x + 16 + i * 15},${m.foot + 6}V${G}`).join('');
  // The office tower's mullions.
  const MULLIONS = Array.from({ length: 5 }, (_, i) => `M${b.x + 9 + (i + 1) * 18},${b.y + 6}V${G}`).join('');
  // The street behind: unlit behind the heading and plate, and behind the labels in the middle.
  // A street of flats, a balcony on every floor, and one landmark: a glass
  // spire (its beacon stays dark here, under the labels).
  const MARK = landmark('taper', 498, 62, 310, G);
  let FAR = $derived(skyline({ quiet, seed: 31, street: 'flats', from: -700, to: 1700, base: G, lo: 120, hi: 300, wide: [34, 72], gap: [2, 10], clear: [[494, 564]], low: [[-40, 345, 140]], dark: [[-40, 345]], litShare: 0.16 }));
  let NEAR = $derived(skyline({ quiet,
    street: 'flats',
    seed: 32,
    from: -700,
    to: 1700,
    base: G,
    lo: 60,
    hi: 190,
    wide: [40, 80],
    gap: [6, 24],
    clear: [[340, 492], [586, 816], [884, 1070]],
    low: [[-40, 345, 110]],
    dark: [[-40, 345], [480, 1080]],
    litShare: 0.22,
  }));
  let east = $derived(light.side === 'east');
</script>

<svg viewBox="0 0 1000 {HOUSE.h}" preserveAspectRatio="none" focusable="false">
  <SafeMask id="sp-hs-safe" side="l" h={HOUSE.h} boxes={quiet} />
  <defs>
    <!-- The arc draws itself: a solid stroke revealing the dashed one. -->
    <mask id="sp-hs-reveal" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height={HOUSE.h}>
      <path class="hs-reveal" d={ARC} pathLength="1" />
    </mask>
    <clipPath id="sp-hs-sky"><rect x="-2000" y="0" width="5000" height={G} /></clipPath>
    <radialGradient id="sp-hs-glow">
      <stop offset="0" stop-color="#f6cf8a" stop-opacity="0.5" />
      <stop offset="1" stop-color="#f6cf8a" stop-opacity="0" />
    </radialGradient>
  </defs>

  <g class="hs-stars">
    {#each stars as [x, y], i (i)}<circle cx={x} cy={y} r={i % 5 ? 0.9 : 1.4} />{/each}
  </g>

  <CityRow line={FAR} far side={light.side} base={G} safe="sp-hs-safe" mark={MARK} glow={260} />
  <CityRow line={NEAR} side={light.side} reach={light.reach} base={G} safe="sp-hs-safe" />

  <!-- The tower next door and the mast on its roof. -->
  <g class="hs-tower">
    <rect class="tw-body" x={tower.x} y={m.foot} width={tower.w} height={G - m.foot} />
    <rect class="tw-face" x={tower.x} y={m.foot} width="14" height={G - m.foot} />
    <g mask="url(#sp-hs-safe)">
      {#if east}<rect class="tw-sun" x={tower.x} y={m.foot} width="14" height={G - m.foot} />{/if}
      <path class="tw-glint" d={east ? `M${tower.x + 0.6},${m.foot}V${G}` : `M${tower.x + tower.w - 0.6},${m.foot}V${G}`} />
    </g>
    <path class="tw-fins" d={TOWER_FINS} />
  </g>
  <g class="hs-mast" data-part="siri">
    <path class="ma-frame" d={lattice} />
    <circle class="ma-flash" cx={m.x} cy={m.top - 4} r="10" />
    <circle class="ma-lamp" cx={m.x} cy={m.top - 4} r="3" />
    <path class="ma-wave" d="M{m.x - 14},{m.top - 16} A18,18 0 0 1 {m.x + 14},{m.top - 16} M{m.x - 22},{m.top - 22} A28,28 0 0 1 {m.x + 22},{m.top - 22}" />
  </g>

  <path class="hs-trail" d={TRAIL} />

  <!-- The doorways: a pane each in the office tower's glass, lit one by one. -->
  <g class="hs-block" data-part="areas">
    <rect class="bl-wall" x={b.x} y={b.y} width={b.w} height={G - b.y} />
    <rect class="bl-face" x={b.x} y={b.y} width="8" height={G - b.y} />
    <rect class="bl-face" x={b.x + b.w - 8} y={b.y} width="8" height={G - b.y} />
    <rect class="tw-sun" mask="url(#sp-hs-safe)" x={east ? b.x : b.x + b.w - 8} y={b.y} width="8" height={G - b.y} />
    <path class="bl-top" d="M{b.x - 4},{b.y} H{b.x + b.w + 4} M{b.x + b.w - 34},{b.y} V{b.y - 14} H{b.x + b.w - 12} V{b.y}" />
    <path class="bl-mull" d={MULLIONS} />
    <path class="bl-grid" d={grid} />
    {#each lights as l, i (i)}<rect class="bl-win" x={l.x} y={l.y} width={l.w} height={l.h} style:--d="{l.d}ms" />{/each}
    <path class="bl-glint" mask="url(#sp-hs-safe)" d={east ? `M${b.x + 0.6},${b.y}V${G}` : `M${b.x + b.w - 0.6},${b.y}V${G}`} />
  </g>

  <!-- The flats, and the one with its light on. -->
  <g class="hs-home">
    <rect class="co-wall" x={c.x + 8} y={c.peak} width={c.w - 16} height={G - c.peak} />
    <rect class="co-face" x={c.x + 8} y={c.peak} width="10" height={G - c.peak} />
    <rect class="co-face" x={c.x + c.w - 18} y={c.peak} width="10" height={G - c.peak} />
    <rect class="tw-sun" mask="url(#sp-hs-safe)" x={east ? c.x + 8 : c.x + c.w - 18} y={c.peak} width="10" height={G - c.peak} />
    <rect class="co-roof" x={c.x + 2} y={c.peak - 5} width={c.w - 4} height="6" />
    <path class="co-flats" d={FLATS} />
    <path class="co-slabs" d={SLABS} />
    <circle class="co-halo" cx={wn.x + wn.w / 2} cy={wn.y + wn.h / 2} r="80" clip-path="url(#sp-hs-sky)" />
  </g>
  <g class="hs-lock" data-part="lock">
    <rect class="co-win" x={wn.x} y={wn.y} width={wn.w} height={wn.h} />
    <path class="co-bars" d="M{wn.x + wn.w / 2},{wn.y} V{sill}" />
  </g>
  <g class="hs-games" data-part="games">
    <rect class="co-door" x={HOUSE.door.x} y={HOUSE.door.y} width={HOUSE.door.w} height={G - HOUSE.door.y} />
    <path class="co-door-pane" d="M{HOUSE.door.x + HOUSE.door.w / 2},{HOUSE.door.y + 4} V{G - 2}" />
    <!-- One window upstairs lit: someone's playing. -->
    <rect class="co-attic" x={c.x + c.w / 2 - 9} y={c.wall - 30} width="18" height="16" />
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
<!-- The tower's flat roof, short of the stair housing, is a step for the rambler. -->
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
    opacity: var(--stars, 1);
  }
  .tw-body,
  .bl-wall,
  .co-wall {
    fill: var(--city-body, #0c1018);
    stroke: rgba(237, 228, 212, 0.26);
    stroke-width: 0.9;
  }
  .tw-face,
  .bl-face,
  .co-face {
    fill: var(--city-shade, #080b11);
  }
  .tw-sun {
    fill: var(--city-sunlit, #cfe0ec);
    opacity: var(--city-sun-on, 0);
  }
  .tw-fins,
  .bl-mull {
    stroke: rgba(237, 228, 212, 0.1);
    stroke-width: 1;
  }
  .tw-glint,
  .bl-glint {
    fill: none;
    stroke: var(--city-glint, #f08a3c);
    stroke-width: 1.3;
    opacity: var(--city-glint-on, 0);
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
  .bl-top,
  .co-roof {
    fill: var(--city-deck, #15171b);
    stroke: rgba(237, 228, 212, 0.3);
    stroke-width: 0.9;
  }
  /* The panes still to light: dark glass, outlined, so the lit ones count. */
  .bl-grid {
    fill: #070a10;
    stroke: rgba(237, 228, 212, 0.16);
    stroke-width: 0.6;
  }
  .bl-win {
    fill: var(--city-pane, #f0a24e);
  }
  .bl-win:nth-child(3n + 2) {
    fill: var(--city-pane2, #f6cf8a);
  }
  .co-flats {
    fill: var(--city-glass, #0d121b);
    stroke: rgba(237, 228, 212, 0.22);
    stroke-width: 0.7;
  }
  .co-slabs {
    stroke: rgba(237, 228, 212, 0.3);
    stroke-width: 1.4;
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
    fill: var(--city-deck, #15171b);
    stroke: rgba(237, 228, 212, 0.4);
    stroke-width: 0.8;
  }
  .co-door {
    fill: #070504;
    stroke: rgba(237, 228, 212, 0.3);
    stroke-width: 0.8;
  }
  .co-door-pane {
    stroke: rgba(237, 228, 212, 0.2);
    stroke-width: 0.8;
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
