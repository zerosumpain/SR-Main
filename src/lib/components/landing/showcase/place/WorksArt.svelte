<svelte:options css="injected" />

<script lang="ts" module>
  /** The works' fixed geometry, in its 1000 × 500 scene: `tower` is the glass tower beside the site. */
  export const WORKS = {
    h: 500,
    ground: 468,
    town: { x: 14, y: 340, w: 282, h: 128 },
    build: { x: 318, w: 136, top: 296, done: 412 },
    sign: { x: 334, y: 344, w: 104, h: 24 },
    crane: { x: 584, top: 40, jib: 74, from: 236, to: 652 },
    hook: { x: 386, y: 166 },
    hut: { x: 470, y: 430, w: 92 },
    tower: { x: 606, w: 60, top: 136 },
  } as const;
</script>

<script lang="ts">
  // Shipping, drawn: a building site between the glass towers. The hero's
  // town at its edge, its recent weeks (a block a week, a lit window per
  // deploy: lamp-lit by night, bright glass by day), a new block going up
  // in its concrete frame behind the hoarding with the builder's sign lit
  // on it, and a tower crane lowering today's deploys as crates on its hook.
  // A star sits on the tip of the jib for the ideas that fell in from
  // Daydream. A picture only; PlaceScene's labels carry every number.
  import type { Town } from '$lib/landing/place';
  import { landmark, skyline } from '$lib/landing/showcase-city';
  import type { Box } from '$lib/landing/showcase-place';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import CityRow from './CityRow.svelte';
  import SafeMask from './SafeMask.svelte';

  let {
    houses,
    load,
    busy,
    dreamt,
    light,
    quiet = [],
  }: {
    /** The last weeks as a terrace, or null with no record. */
    houses: Town | null;
    /** Today's deploys as crates on the hook. */
    load: { boxes: Array<{ x: number; y: number }>; more: number };
    /** The builder is at work right now: the sign is lit. */
    busy: boolean;
    /** Some of Daydream's ideas have shipped: the star on the jib is lit. */
    dreamt: boolean;
    /** Where the sun stands and how far its shadows run. */
    light: { side: 'east' | 'west'; reach: number };
    /** Where the labels stand: no tower window is lit behind them. */
    quiet?: Box[];
  } = $props();

  const t = WORKS.town;
  const bd = WORKS.build;
  const cr = WORKS.crane;
  const hk = WORKS.hook;
  const s = WORKS.sign;
  const hut = WORKS.hut;
  const G = WORKS.ground;
  const CW = 22;
  const CH = 15;

  const mast = (() => {
    let d = `M${cr.x - 8},${G} V${cr.jib} M${cr.x + 8},${G} V${cr.jib}`;
    for (let y = G - 4, k = 0; y > cr.jib + 10; y -= 16, k++) d += ` M${cr.x - 8},${y} L${cr.x + 8},${y - 16}`;
    return d;
  })();
  const jib = (() => {
    let d = `M${cr.from},${cr.jib} H${cr.to} M${cr.from + 8},${cr.jib + 10} H${cr.x - 8}`;
    for (let x = cr.from + 8, k = 0; x < cr.x - 16; x += 16, k++) d += ` M${x},${cr.jib + 10} L${x + 8},${cr.jib} L${x + 16},${cr.jib + 10}`;
    d += ` M${cr.x},${cr.top} L${cr.from + 10},${cr.jib} M${cr.x},${cr.top} L${cr.to - 6},${cr.jib} M${cr.x - 8},${cr.jib} L${cr.x},${cr.top} L${cr.x + 8},${cr.jib}`;
    return d;
  })();
  const scaffold = (() => {
    const xs = [bd.x, bd.x + bd.w / 2, bd.x + bd.w];
    let d = xs.map((x) => `M${x},${G} V${bd.top - 8}`).join(' ');
    for (let y = bd.top; y < bd.done; y += 38) d += ` M${bd.x - 6},${y} H${bd.x + bd.w + 6}`;
    d += ` M${bd.x},${bd.top + 38} L${bd.x + bd.w / 2},${bd.top} M${bd.x + bd.w / 2},${bd.top + 76} L${bd.x + bd.w},${bd.top + 38}`;
    return d;
  })();
  const sparkle = (x: number, y: number, k: number) =>
    `M${x},${y - k * 2.2} L${x + k * 0.5},${y - k * 0.5} L${x + k * 2.2},${y} L${x + k * 0.5},${y + k * 0.5} L${x},${y + k * 2.2} L${x - k * 0.5},${y + k * 0.5} L${x - k * 2.2},${y} L${x - k * 0.5},${y - k * 0.5} Z`;
  const tw = WORKS.tower;
  // The glass tower beside the site is the works' landmark: tapering to a spire, a beacon on it after dark.
  const SPIRE = landmark('taper', tw.x, tw.w, G - tw.top, G);
  // The finished floors' glazing, and the frame's slabs above them.
  const SLABS = Array.from({ length: 3 }, (_, i) => `M${bd.x - 4},${bd.done - 38 * i}H${bd.x + bd.w + 4}`).join('');
  // The street behind the site: unlit behind the heading and plate.
  // The terrace's lit windows are deploys: no scenery window is lit behind them, nor round the crates.
  const CHARTS = [
    { x: t.x - 8, y: t.y - 36, w: t.w + 16, h: t.h + 36 },
    { x: hk.x - 40, y: hk.y - 4, w: 80, h: 120 },
  ];
  let hush = $derived([...quiet, ...CHARTS]);
  // A mixed street: glass behind the site, all sorts of crowns.
  // Behind the site, a slab with a lantern on its crown, lit after dark.
  const CROWN = landmark('crown', 480, 56, 300, G);
  let FAR = $derived(skyline({ quiet: hush, seed: 41, street: 'glass', from: -700, to: 1700, base: G, lo: 110, hi: 300, wide: [28, 64], gap: [2, 10], clear: [[474, 542]], dark: [[640, 1060]], litShare: 0.14 }));
  let NEAR = $derived(skyline({ quiet: hush, seed: 42, street: 'mixed', from: -700, to: 1700, base: G, lo: 70, hi: 230, wide: [40, 84], gap: [8, 26], clear: [[-12, 690]], low: [[660, 1060, 170]], dark: [[640, 1060]], litShare: 0.22 }));
  let east = $derived(light.side === 'east');
  let rows = $derived(load.boxes.length ? Math.max(...load.boxes.map((b) => -b.y)) + 1 : 0);
</script>

<svg viewBox="0 0 1000 {WORKS.h}" preserveAspectRatio="none" focusable="false">
  <SafeMask id="sp-wk-safe" side="r" h={WORKS.h} boxes={hush} />
  <CityRow line={FAR} far side={light.side} base={G} safe="sp-wk-safe" mark={CROWN} glow={260} />
  <CityRow line={NEAR} side={light.side} reach={light.reach} base={G} safe="sp-wk-safe" />
  <!-- The glass tower beside the site, tapering to a spire. -->
  <g class="wo-tower">
    <path class="tw-body" d={SPIRE.d} />
    <path class="tw-fins" d={SPIRE.marks} />
    <g mask="url(#sp-wk-safe)">
      <path class="tw-beacon" d={SPIRE.glow} />
      <path class="tw-glint" d={east ? `M${tw.x + 0.6},${G}L${tw.x + tw.w * 0.22},${Math.round(tw.top + (G - tw.top) * 0.1)}` : `M${tw.x + tw.w - 0.6},${G}L${tw.x + tw.w * 0.78},${Math.round(tw.top + (G - tw.top) * 0.1)}`} />
    </g>
  </g>
  <!-- The walk's footpath, on in behind the town to the site hut's door. -->
  <path class="wo-trail" d="M-2000,{G - 3} H{hut.x + hut.w - 19}" />
  <!-- The edge of the town: the hero's terrace, its most recent weeks. -->
  {#if houses}
    <g class="wo-town" data-part="rate">
      <svg x={t.x} y={t.y} width={t.w} height={t.h} viewBox="0 0 1000 100" preserveAspectRatio="none" overflow="visible">
        {#each houses.blocks as b (b.x)}<rect class="t-block" x={b.x} y={b.top} width={b.w} height={100 - b.top} />{/each}
        <path class="t-dark" d={houses.dark} />
        <path class="t-lit" d={houses.lit} />
        <path class="t-lit2" d={houses.lit2} />
      </svg>
    </g>
  {/if}

  <!-- The new block: glazed floors done, its concrete frame and scaffold above, the sign on the front. -->
  <g class="wo-build" data-part="lines">
    <!-- The floors poured but not yet glazed: shadowed inside, the lift core standing up through them. -->
    <rect class="bd-inside" x={bd.x} y={bd.top} width={bd.w} height={bd.done - bd.top} />
    <rect class="bd-core" x={bd.x + bd.w * 0.62} y={bd.top - 12} width="22" height={bd.done - bd.top + 12} />
    <rect class="bd-done" x={bd.x} y={bd.done} width={bd.w} height={G - bd.done} />
    <path class="bd-wins" d="M{bd.x + 6},{bd.done + 12} h{bd.w - 12} v18 h{-(bd.w - 12)} Z" />
    <path class="bd-slab" d={SLABS} />
    <path class="bd-scaf" d={scaffold} />
  </g>
  <!-- The hoarding round the site. -->
  <rect class="wo-hoard" x={bd.x - 14} y={G - 14} width={hut.x - bd.x + 10} height="14" />
  <g class="wo-sign" data-part="builder" data-busy={busy ? '' : undefined}>
    <path class="sg-hang" d="M{s.x + 10},{s.y} V{s.y - 10} M{s.x + s.w - 10},{s.y} V{s.y - 10}" />
    <rect class="sg-glow" x={s.x - 10} y={s.y - 8} width={s.w + 20} height={s.h + 16} rx="12" />
    <rect class="sg-board" x={s.x} y={s.y} width={s.w} height={s.h} />
    <path class="sg-line" d="M{s.x + 12},{s.y + s.h / 2} H{s.x + s.w - 12}" />
  </g>

  <!-- The crane. -->
  <g class="wo-crane">
    <path class="cr-frame" d={mast} />
    <path class="cr-frame" d={jib} />
    <rect class="cr-weight" x={cr.to - 34} y={cr.jib + 2} width="28" height="20" />
    <rect class="cr-cab" x={cr.x + 9} y={cr.jib + 10} width="22" height="18" />
    <rect class="cr-cab-win" x={cr.x + 13} y={cr.jib + 13} width="14" height="8" />
  </g>
  <g class="wo-dream" data-part="daydream">
    <path class="dr-star" class:on={dreamt} d={sparkle(cr.from + 4, cr.jib - 8, 3)} />
  </g>

  <!-- Today's deploys, on the hook. -->
  <g class="wo-load" data-part="today">
    <rect class="cr-trolley" x={hk.x - 8} y={cr.jib + 1} width="16" height="8" />
    <path class="cr-cable" d="M{hk.x - 2},{cr.jib + 9} V{hk.y} M{hk.x + 2},{cr.jib + 9} V{hk.y}" />
    <g class="wo-lower">
      <path class="cr-hook" d="M{hk.x},{hk.y} v6 a4,4 0 1 1 -4,4" />
      {#if rows}
        <path class="cr-sling" d="M{hk.x},{hk.y + 8} L{hk.x - CW},{hk.y + 18} M{hk.x},{hk.y + 8} L{hk.x + CW},{hk.y + 18}" />
      {/if}
      {#each load.boxes as c, i (i)}
        <g class="crate" style:--i={i}>
          <rect x={hk.x + (c.x === -1 ? -CW - 0.5 : 0.5)} y={hk.y + 18 + -c.y * (CH + 1)} width={CW} height={CH} />
          <path d="M{hk.x + (c.x === -1 ? -CW - 0.5 : 0.5)},{hk.y + 18 + -c.y * (CH + 1)} l{CW},{CH}" />
        </g>
      {/each}
    </g>
  </g>

  <!-- The site cabins: the builder's desk. -->
  <g class="wo-hut">
    <rect class="hu-body" x={hut.x} y={hut.y} width={hut.w} height={G - hut.y} />
    <path class="hu-ribs" d="M{hut.x + 46},{hut.y}V{G} M{hut.x},{hut.y + 19}H{hut.x + hut.w}" />
    <rect class="hu-win" x={hut.x + 12} y={hut.y + 10} width="26" height="12" />
    <rect class="hu-door" x={hut.x + hut.w - 26} y={hut.y + 8} width="14" height={G - hut.y - 8} />
  </g>
</svg>
<!-- The scaffold's top boards are a floor for him on the way down to the hut. -->
<span
  class="wo-desk"
  style:left="{((bd.x + 6) / 1000) * 100}%"
  style:width="{((bd.w - 12) / 1000) * 100}%"
  style:top="{(bd.top / WORKS.h) * 100}%"
  use:scenery
></span>
<!-- He sits on the site cabins to read. -->
<span
  class="wo-desk"
  style:left="{(hut.x / 1000) * 100}%"
  style:width="{(hut.w / 1000) * 100}%"
  style:top="{(hut.y / WORKS.h) * 100}%"
  use:scenery={{ spot: 'desk', at: 0.5 }}
></span>

<style>
  .wo-desk {
    position: absolute;
    height: 1px;
  }
  .tw-body {
    fill: var(--city-body, #0c1018);
    stroke: rgba(237, 228, 212, 0.26);
    stroke-width: 0.9;
  }
  .tw-beacon {
    fill: #f6dca8;
    opacity: calc(0.3 + 0.6 * var(--windows, 1));
  }
  .tw-fins {
    fill: none;
    stroke: rgba(237, 228, 212, 0.1);
    stroke-width: 1;
  }
  .tw-glint {
    fill: none;
    stroke: var(--city-glint, #f08a3c);
    stroke-width: 1.3;
    opacity: var(--city-glint-on, 0);
  }
  .t-block {
    fill: var(--city-body, #120d0a);
    stroke: rgba(237, 228, 212, 0.22);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .t-dark {
    fill: rgba(237, 228, 212, 0.07);
  }
  .t-lit {
    fill: var(--city-pane, #f0a24e);
  }
  .t-lit2 {
    fill: var(--city-pane2, #f6cf8a);
  }
  .bd-done {
    fill: var(--city-deck, #15171b);
    stroke: rgba(237, 228, 212, 0.3);
    stroke-width: 0.9;
  }
  .bd-wins {
    fill: var(--city-glass, #0d121b);
    stroke: rgba(237, 228, 212, 0.18);
    stroke-width: 0.7;
  }
  .bd-inside {
    fill: var(--city-shade, #080b11);
    opacity: 0.86;
  }
  .bd-core {
    fill: var(--city-deck, #15171b);
    stroke: rgba(237, 228, 212, 0.26);
    stroke-width: 0.8;
  }
  .bd-slab {
    stroke: rgba(237, 228, 212, 0.42);
    stroke-width: 2.2;
  }
  .wo-hoard {
    fill: var(--city-deck, #15171b);
    stroke: rgba(237, 228, 212, 0.3);
    stroke-width: 0.8;
  }
  .bd-scaf {
    fill: none;
    stroke: rgba(237, 228, 212, 0.4);
    stroke-width: 1.1;
  }
  .sg-hang {
    stroke: rgba(237, 228, 212, 0.45);
    stroke-width: 1;
  }
  .sg-board {
    fill: #0d1116;
    stroke: rgba(127, 184, 192, 0.7);
    stroke-width: 1.1;
  }
  .sg-glow {
    fill: rgba(127, 184, 192, 0);
  }
  .sg-line {
    stroke: rgba(127, 184, 192, 0.5);
    stroke-width: 2;
    stroke-dasharray: 6 4;
  }
  .wo-sign[data-busy] .sg-board {
    fill: #2e4f53;
    stroke: #bfe3e7;
  }
  .wo-sign[data-busy] .sg-glow {
    fill: rgba(127, 184, 192, 0.18);
  }
  .wo-sign[data-busy] .sg-line {
    stroke: #bfe3e7;
    stroke-dasharray: none;
  }
  .cr-frame {
    fill: none;
    stroke: rgba(232, 134, 58, 0.72);
    stroke-width: 1.2;
    stroke-linejoin: round;
  }
  .cr-weight {
    fill: #262a31;
    stroke: rgba(237, 228, 212, 0.35);
    stroke-width: 0.8;
  }
  .cr-cab {
    fill: #262a31;
    stroke: rgba(232, 134, 58, 0.72);
    stroke-width: 1;
  }
  .cr-cab-win {
    fill: #f6cf8a;
  }
  .dr-star {
    fill: none;
    stroke: rgba(191, 227, 231, 0.6);
    stroke-width: 1;
  }
  .dr-star.on {
    fill: #bfe3e7;
  }
  .cr-trolley {
    fill: #262a31;
    stroke: rgba(232, 134, 58, 0.72);
    stroke-width: 1;
  }
  .cr-cable {
    stroke: rgba(237, 228, 212, 0.5);
    stroke-width: 0.8;
  }
  .cr-hook,
  .cr-sling {
    fill: none;
    stroke: rgba(237, 228, 212, 0.7);
    stroke-width: 1.4;
  }
  .crate rect {
    fill: #6b3b12;
    stroke: #f0a24e;
    stroke-width: 1;
  }
  .crate path {
    stroke: rgba(240, 162, 78, 0.6);
    stroke-width: 1;
  }
  .hu-body {
    fill: var(--city-deck, #15171b);
    stroke: rgba(237, 228, 212, 0.34);
    stroke-width: 0.9;
  }
  .hu-ribs {
    stroke: rgba(237, 228, 212, 0.22);
    stroke-width: 0.9;
  }
  .hu-win {
    fill: #f0a24e;
    opacity: calc(0.35 + 0.65 * var(--windows, 1));
  }
  .wo-trail {
    fill: none;
    stroke: rgba(237, 228, 212, 0.5);
    stroke-width: 2;
    stroke-dasharray: 0.5 5;
    stroke-linecap: round;
  }
  .hu-door {
    fill: #070504;
  }

  /* The flourish: the crane lowers today's load into place, once. */
  :global(.sp-scene[data-arm]) .wo-lower {
    transform: translateY(-90px);
  }
  /* The cable pays out from the trolley as the load comes down. */
  .cr-cable {
    transform-box: fill-box;
    transform-origin: 50% 0;
  }
  :global(.sp-scene[data-arm]) .cr-cable {
    transform: scaleY(0.2);
  }
  :global(.sp-scene[data-play]) .cr-cable {
    animation: sp-wo-pay 1400ms cubic-bezier(0.3, 0.7, 0.3, 1) 200ms both;
  }
  :global(.sp-scene[data-arm]) .crate {
    opacity: 0;
  }
  :global(.sp-scene[data-play]) .wo-lower {
    animation: sp-wo-lower 1400ms cubic-bezier(0.3, 0.7, 0.3, 1) 200ms both;
  }
  :global(.sp-scene[data-play]) .crate {
    animation: sp-wo-on 220ms ease-out calc(var(--i) * 110ms) both;
  }
  @keyframes sp-wo-lower {
    from {
      transform: translateY(-90px);
    }
    to {
      transform: translateY(0);
    }
  }
  @keyframes sp-wo-pay {
    from {
      transform: scaleY(0.2);
    }
    to {
      transform: scaleY(1);
    }
  }
  @keyframes sp-wo-on {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .wo-lower,
    .cr-cable,
    .crate {
      animation: none !important;
    }
  }
</style>
