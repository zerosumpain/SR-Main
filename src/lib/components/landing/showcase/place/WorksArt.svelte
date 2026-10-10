<svelte:options css="injected" />

<script lang="ts" module>
  /** The works' fixed geometry, in its 1000 × 500 scene. */
  export const WORKS = {
    h: 500,
    ground: 468,
    town: { x: 14, y: 340, w: 282, h: 128 },
    build: { x: 318, w: 136, top: 296, done: 412 },
    sign: { x: 334, y: 344, w: 104, h: 24 },
    crane: { x: 584, top: 40, jib: 74, from: 236, to: 652 },
    hook: { x: 386, y: 166 },
    hut: { x: 470, y: 430, w: 92 },
  } as const;
</script>

<script lang="ts">
  // Shipping, drawn: the edge of the town from the hero (a house a day, a lit
  // window per deploy), a new building going up in scaffolding with the
  // builder's sign lit on it, and a crane lowering today's deploys as crates
  // on its hook. A star sits on the tip of the jib for the ideas that fell in
  // from Daydream. A picture only; PlaceScene's labels carry every number.
  import type { Town } from '$lib/landing/place';
  import { scenery } from '$lib/landing/ramblers/scenery';

  let {
    houses,
    load,
    busy,
    dreamt,
  }: {
    /** The last weeks as a terrace, or null with no record. */
    houses: Town | null;
    /** Today's deploys as crates on the hook. */
    load: { boxes: Array<{ x: number; y: number }>; more: number };
    /** The builder is at work right now: the sign is lit. */
    busy: boolean;
    /** Some of Daydream's ideas have shipped: the star on the jib is lit. */
    dreamt: boolean;
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
  let rows = $derived(load.boxes.length ? Math.max(...load.boxes.map((b) => -b.y)) + 1 : 0);
</script>

<svg viewBox="0 0 1000 {WORKS.h}" preserveAspectRatio="none" focusable="false">
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

  <!-- The new building: finished floors, scaffolding above, the sign on the front. -->
  <g class="wo-build" data-part="lines">
    <rect class="bd-done" x={bd.x} y={bd.done} width={bd.w} height={G - bd.done} />
    <path class="bd-wins" d="M{bd.x + 14},{bd.done + 16} h12 v10 h-12 Z M{bd.x + 44},{bd.done + 16} h12 v10 h-12 Z M{bd.x + 80},{bd.done + 16} h12 v10 h-12 Z M{bd.x + 110},{bd.done + 16} h12 v10 h-12 Z" />
    <path class="bd-scaf" d={scaffold} />
  </g>
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

  <!-- The site hut: the builder's desk. -->
  <g class="wo-hut">
    <rect class="hu-body" x={hut.x} y={hut.y} width={hut.w} height={G - hut.y} />
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
<!-- He sits at the site hut to read. -->
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
  .t-block {
    fill: #120d0a;
    stroke: rgba(237, 228, 212, 0.22);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .t-dark {
    fill: rgba(237, 228, 212, 0.07);
  }
  .t-lit {
    fill: #f0a24e;
  }
  .t-lit2 {
    fill: #f6cf8a;
  }
  .bd-done {
    fill: #1d1611;
    stroke: rgba(237, 228, 212, 0.3);
    stroke-width: 0.9;
  }
  .bd-wins {
    fill: rgba(237, 228, 212, 0.08);
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
    fill: #1b130d;
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
    fill: #2c2119;
    stroke: rgba(237, 228, 212, 0.35);
    stroke-width: 0.8;
  }
  .cr-cab {
    fill: #2c2119;
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
    fill: #2c2119;
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
    fill: #1d1611;
    stroke: rgba(237, 228, 212, 0.34);
    stroke-width: 0.9;
  }
  .hu-win {
    fill: #f0a24e;
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
