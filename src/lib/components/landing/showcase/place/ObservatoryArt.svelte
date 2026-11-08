<svelte:options css="injected" />

<script lang="ts" module>
  /** The observatory's fixed geometry, in its 1000 × 600 scene. */
  export const OBS = {
    h: 600,
    ground: 568,
    dome: { cx: 820, cy: 366, r: 46 },
    slit: { x: 814, w: 12 },
    scope: { x1: 826, y1: 340, x2: 870, y2: 306 },
    /** The roof deck beside the dome, where he sits. */
    terrace: { x: 714, y: 388, w: 60 },
    cloud: { x: 862, y: 22, w: 128 },
    /** The tower the dome stands on: its crown slab at `roof`, the street at `ground`. */
    tower: { x: 700, w: 196, roof: 418 },
  } as const;
</script>

<script lang="ts">
  // Daydream, drawn: a rooftop observatory on the tallest tower in the street,
  // the city's lights below it. Every star is a question it asked itself this
  // week (questionSky), the faint crossed stars are claims its auditor struck
  // out, the shooting stars are ideas that shipped, the constellation is
  // twelve weeks of verdicts, the dome's panels are the areas of life it
  // looked at and its slit is lit for the hours it spent thinking. The cloud
  // is the next think.
  //
  // By day the stars stay, as the dome's own star chart: real stars don't
  // show in a daylit sky, but these are questions, not stars, and a question
  // asked doesn't go out at sunrise. So as the light comes up a faint chart
  // (rings of altitude round the dome, lines of bearing out from it) comes up
  // with it, and each question is plotted on it as a ringed point, the same
  // one star a question; at night the chart fades and they are plain stars.
  // A picture only; PlaceScene's labels carry every number.
  import type { CloudMode } from '$lib/landing/place';
  import { BIG_STAR, type Sky, type Verdict } from '$lib/landing/showcase-place';
  import { skyline } from '$lib/landing/showcase-city';
  import type { Box } from '$lib/landing/showcase-place';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import CityRow from './CityRow.svelte';
  import SafeMask from './SafeMask.svelte';

  let {
    sky,
    verdicts,
    line,
    panels,
    slit,
    falls,
    weather,
    light,
    quiet = [],
  }: {
    sky: Sky;
    verdicts: Verdict[];
    line: string;
    panels: boolean[];
    /** Share of the slit lit, 0..1. */
    slit: number;
    falls: Array<{ x1: number; y1: number; x2: number; y2: number; d: number }>;
    weather: { mode: CloudMode; fill: number };
    /** Where the sun stands and how far its shadows run. */
    light: { side: 'east' | 'west'; reach: number };
    /** Where the labels stand: no tower window is lit behind them. */
    quiet?: Box[];
  } = $props();

  const { cx, cy, r } = OBS.dome;
  const G = OBS.ground;
  const T = OBS.tower;
  const PUFFS = [[28, 74, 20], [58, 77, 23], [90, 78, 25], [122, 77, 23], [152, 74, 19], [52, 52, 25], [90, 46, 30], [126, 54, 24], [96, 24, 24]];
  const k = OBS.cloud.w / 180;
  // Brighter as they get bigger, so the field has depth: the big ones glow.
  const bright = (r: number) => (r >= BIG_STAR ? 0.95 : r >= 1.6 ? 0.86 : r >= 1.2 ? 0.72 : 0.58);

  // The street below: a layer back, then the near towers, kept clear of the
  // observatory's own tower and unlit behind the heading and plate.
  // A street of tall glass: close mullions, chamfered and slanted crowns.
  // Under the look-ups label and down to the street no window is lit, so the
  // label reads against plain glass.
  const UNDER = { x: 440, y: 380, w: 262, h: 190 };
  let hush = $derived([...quiet, UNDER]);
  let FAR = $derived(skyline({ quiet: hush, seed: 11, street: 'glass', from: -700, to: 1700, base: G, lo: 60, hi: 160, wide: [28, 64], gap: [2, 10], dark: [[-40, 360]], litShare: 0.14 }));
  let NEAR = $derived(skyline({ quiet: hush, seed: 12, street: 'glass', from: -700, to: 1700, base: G, lo: 30, hi: 112, wide: [30, 70], clear: [[690, 906]], dark: [[-40, 360]], litShare: 0.22 }));

  // The tower: a shaft of glass under a crown slab, fins every few units.
  const shaft = { x: T.x + 8, w: T.w - 16, top: T.roof + 8 };
  const FINS = Array.from({ length: Math.floor(shaft.w / 15) - 1 }, (_, i) => shaft.x + 15 * (i + 1))
    .map((x) => `M${x},${shaft.top}V${G}`)
    .join('');
  const FLOORS = Array.from({ length: Math.floor((G - shaft.top) / 11) }, (_, i) => shaft.top + 11 * (i + 1))
    .filter((y) => y < G - 3)
    .map((y) => `M${shaft.x},${y}H${shaft.x + shaft.w}`)
    .join('');
  // A few rooms still lit in the tower after dark.
  const ROOMS = [
    [shaft.x + 2, shaft.top + 25, 28],
    [shaft.x + 92, shaft.top + 36, 41],
    [shaft.x + 47, shaft.top + 69, 28],
    [shaft.x + 122, shaft.top + 91, 41],
    [shaft.x + 17, shaft.top + 113, 26],
  ]
    .map(([x, y, w]) => `M${x},${y + 2}h${w}v5h${-w}Z`)
    .join('');
  // The day chart: rings of altitude round the dome and lines of bearing out from it.
  const RINGS = [150, 250, 360, 480, 620];
  const BEARINGS = [-80, -62, -45, -28, -12, 6].map((deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `M${cx},${cy - r} L${Math.round(cx + Math.cos(a) * 900)},${Math.round(cy - r + Math.sin(a) * 900)}`;
  });

  let slices = $derived(
    panels.map((on, i) => ({ on, x: cx - r + (i * 2 * r) / panels.length, w: (2 * r) / panels.length })),
  );
  let lit = $derived(Math.max(0, Math.min(1, slit)));
  let east = $derived(light.side === 'east');
  const sparkle = (x: number, y: number, s: number) =>
    `M${x},${y - s * 2.2} L${x + s * 0.5},${y - s * 0.5} L${x + s * 2.2},${y} L${x + s * 0.5},${y + s * 0.5} L${x},${y + s * 2.2} L${x - s * 0.5},${y + s * 0.5} L${x - s * 2.2},${y} L${x - s * 0.5},${y - s * 0.5} Z`;
</script>

<svg viewBox="0 0 1000 {OBS.h}" preserveAspectRatio="none" focusable="false">
  <SafeMask id="sp-dd-safe" side="l" h={OBS.h} boxes={quiet} />
  <defs>
    <radialGradient id="sp-dd-glow">
      <stop offset="0" stop-color="#f6cf8a" stop-opacity="0.55" />
      <stop offset="1" stop-color="#f6cf8a" stop-opacity="0" />
    </radialGradient>
    <clipPath id="sp-dd-dome"><path d="M{cx - r},{cy} A{r},{r} 0 0 1 {cx + r},{cy} Z" /></clipPath>
    <clipPath id="sp-dd-up"><rect x="-2000" y="0" width="5000" height={T.roof - 30} /></clipPath>
    <clipPath id="sp-dd-cloud-in">
      {#each PUFFS as [x, y, pr] (`${x},${y}`)}<circle cx={OBS.cloud.x + x * k} cy={OBS.cloud.y + y * k} r={pr * k} />{/each}
    </clipPath>
  </defs>

  <!-- The dome's star chart, up with the daylight: kept out of the copy column and from among the labels' words. -->
  <g class="dd-chart" clip-path="url(#sp-dd-up)" mask="url(#sp-dd-safe)">
    {#each RINGS as rr (rr)}<circle cx={cx} cy={cy - r} r={rr} />{/each}
    {#each BEARINGS as d (d)}<path {d} />{/each}
  </g>

  <!-- The questions: a star each, a range of sizes, the biggest glowing; ringed on the chart by day. -->
  <g class="dd-stars">
    {#each sky.stars as s, i (i)}
      <g class="st" class:tw={s.tw} style:--d="{s.d}ms" style:--o={bright(s.r)}>
        {#if s.r >= BIG_STAR}<circle class="st-glow" cx={s.x} cy={s.y} r={s.r * 3} />{/if}
        <circle class="st-ring" cx={s.x} cy={s.y} r={s.r + 2.2} />
        <circle cx={s.x} cy={s.y} r={s.r} />
      </g>
    {/each}
  </g>

  <!-- Claims struck out: a star crossed out. -->
  <g class="dd-struck" data-part="struck">
    {#each sky.struck as s, i (i)}
      <circle cx={s.x} cy={s.y} r="1.4" />
      <path d="M{s.x - 3},{s.y - 3} L{s.x + 3},{s.y + 3} M{s.x - 3},{s.y + 3} L{s.x + 3},{s.y - 3}" />
    {/each}
  </g>

  <!-- Twelve weeks of verdicts, joined up. -->
  <g class="dd-con" data-part="useful">
    {#if line}<path class="dd-line" d={line} pathLength="1" />{/if}
    {#each verdicts as p (p.start)}
      {#if p.rate != null}
        <path class="dd-vs" d={sparkle(p.x, p.y, p.r)} />
        <circle class="dd-halo" cx={p.x} cy={p.y} r={p.r * 2.4} />
      {/if}
    {/each}
  </g>

  <!-- Ideas that shipped, falling towards the works. -->
  <g class="dd-falls" data-part="shipped">
    {#each falls as f, i (i)}
      <path class="dd-fall" d="M{f.x1},{f.y1} L{f.x2},{f.y2}" pathLength="1" style:--d="{f.d}ms" />
      <circle class="dd-head" cx={f.x2} cy={f.y2} r="1.8" style:--d="{f.d}ms" />
    {/each}
  </g>

  <!-- The next think, as the hero draws it: filling, raining, mist or an outline. -->
  <g class="dd-cloud" data-part="next" data-mode={weather.mode}>
    {#if weather.mode === 'mist'}
      <path
        class="cl-fog"
        d="M{OBS.cloud.x + 30},{OBS.cloud.y + 44} H{OBS.cloud.x + 110} M{OBS.cloud.x + 10},{OBS.cloud.y + 56} H{OBS.cloud.x + 92} M{OBS.cloud.x + 46},{OBS.cloud.y + 68} H{OBS.cloud.x + 124}"
      />
    {:else}
      <g clip-path="url(#sp-dd-cloud-in)">
        <rect class="cl-body" x={OBS.cloud.x} y={OBS.cloud.y} width={OBS.cloud.w} height={110 * k} />
        {#if weather.fill > 0}
          <rect class="cl-fill" x={OBS.cloud.x} y={OBS.cloud.y + (103 - weather.fill * 99) * k} width={OBS.cloud.w} height={(weather.fill * 99 + 8) * k} />
        {/if}
      </g>
      {#each PUFFS as [x, y, pr] (`${x},${y}`)}<circle class="cl-rim" cx={OBS.cloud.x + x * k} cy={OBS.cloud.y + y * k} r={pr * k} />{/each}
      {#if weather.mode === 'rain'}
        <path class="cl-rain" d="M{OBS.cloud.x + 40},{OBS.cloud.y + 86} v10 M{OBS.cloud.x + 64},{OBS.cloud.y + 90} v12 M{OBS.cloud.x + 88},{OBS.cloud.y + 86} v10" />
      {/if}
    {/if}
  </g>

  <!-- The street below. -->
  <CityRow line={FAR} far side={light.side} base={G} safe="sp-dd-safe" glow={250} />
  <CityRow line={NEAR} side={light.side} reach={light.reach} base={G} safe="sp-dd-safe" />

  <!-- The tower: a glass shaft under a crown slab, the roof deck and the dome on top. -->
  <g class="dd-obs">
    <rect class="tw-shaft" x={shaft.x} y={shaft.top} width={shaft.w} height={G - shaft.top} />
    <rect class="tw-face" x={shaft.x} y={shaft.top} width="16" height={G - shaft.top} />
    <rect class="tw-face" x={shaft.x + shaft.w - 16} y={shaft.top} width="16" height={G - shaft.top} />
    <g mask="url(#sp-dd-safe)">
      <rect class="tw-sun" x={east ? shaft.x : shaft.x + shaft.w - 16} y={shaft.top} width="16" height={G - shaft.top} />
      <path class="tw-glint" d={east ? `M${shaft.x + 0.6},${shaft.top}V${G}` : `M${shaft.x + shaft.w - 0.6},${shaft.top}V${G}`} />
    </g>
    <path class="tw-fins" d={FINS} />
    <path class="tw-floors" d={FLOORS} />
    <path class="tw-rooms" d={ROOMS} />
    <rect class="tw-crown" x={T.x} y={T.roof} width={T.w} height="8" />
    <rect class="ob-terrace" x={OBS.terrace.x} y={OBS.terrace.y} width={OBS.terrace.w + 2} height={T.roof - OBS.terrace.y} />
    <path
      class="ob-rail"
      d="M{OBS.terrace.x + 4},{OBS.terrace.y} V{OBS.terrace.y - 10} M{OBS.terrace.x + 24},{OBS.terrace.y} V{OBS.terrace.y - 10} M{OBS.terrace.x + 44},{OBS.terrace.y} V{OBS.terrace.y - 10} M{OBS.terrace.x + 2},{OBS.terrace.y - 9} H{OBS.terrace.x + 46}"
    />
    <rect class="ob-drum" x={cx - r + 2} y={cy} width={2 * r - 4} height={T.roof - cy} />
    <rect class="ob-door" x={cx - 7} y={cy + 22} width="14" height={T.roof - cy - 22} />
  </g>
  <g class="dd-dome" data-part="dome">
    <circle class="ob-glow" cx={cx} cy={cy - r * 0.5} r={r * 1.5} style:opacity={0.25 + lit * 0.75} />
    <g clip-path="url(#sp-dd-dome)">
      {#each slices as p, i (i)}<rect class="ob-panel" class:on={p.on} x={p.x} y={cy - r} width={p.w} height={r} />{/each}
      <rect class="ob-slit" x={OBS.slit.x} y={cy - r} width={OBS.slit.w} height={r} />
      {#if lit > 0}<rect class="ob-lit" x={OBS.slit.x} y={cy - r * lit} width={OBS.slit.w} height={r * lit} />{/if}
    </g>
    {#each slices.slice(1) as p, i (i)}<path class="ob-rib" d="M{p.x},{cy} V{cy - r}" clip-path="url(#sp-dd-dome)" />{/each}
    <path class="ob-shell" d="M{cx - r},{cy} A{r},{r} 0 0 1 {cx + r},{cy} Z" />
    <!-- The sun on the dome's shoulder. -->
    <path
      mask="url(#sp-dd-safe)"
      class="ob-sun"
      d={east ? `M${cx - r + 1},${cy - 1} A${r - 1},${r - 1} 0 0 1 ${cx - r * 0.3},${cy - r * 0.94}` : `M${cx + r - 1},${cy - 1} A${r - 1},${r - 1} 0 0 0 ${cx + r * 0.3},${cy - r * 0.94}`}
    />
  </g>
  <g class="dd-scope" data-part="lookups">
    <path class="ob-tube" d="M{OBS.scope.x1},{OBS.scope.y1} L{OBS.scope.x2},{OBS.scope.y2}" />
    <path class="ob-tube-hi" d="M{OBS.scope.x1},{OBS.scope.y1} L{OBS.scope.x2},{OBS.scope.y2}" />
  </g>
</svg>
<!-- He sits on the roof deck beside the dome to think. -->
<span
  class="dd-seat"
  style:left="{(OBS.terrace.x / 1000) * 100}%"
  style:width="{(OBS.terrace.w / 1000) * 100}%"
  style:top="{(OBS.terrace.y / OBS.h) * 100}%"
  use:scenery={{ spot: 'think', at: 0.4 }}
></span>

<style>
  .dd-seat {
    position: absolute;
    height: 1px;
  }
  .dd-chart {
    fill: none;
    stroke: rgba(191, 227, 231, 0.2);
    stroke-width: 0.8;
    stroke-dasharray: 2 5;
    opacity: var(--daylight, 0);
  }
  .st {
    fill: #efe6d6;
    opacity: var(--o, 0.86);
  }
  .st-glow {
    fill: rgba(239, 230, 214, 0.1);
  }
  /* By day each question is a plotted point on the chart: ringed. */
  .st-ring {
    fill: none;
    stroke: rgba(191, 227, 231, 0.75);
    stroke-width: 0.7;
    opacity: var(--daylight, 0);
  }
  .dd-struck circle {
    fill: rgba(237, 228, 212, 0.62);
  }
  .dd-struck path {
    stroke: rgba(232, 134, 58, 0.45);
    stroke-width: 1;
    stroke-linecap: round;
  }
  .dd-line {
    fill: none;
    stroke: rgba(127, 184, 192, 0.55);
    stroke-width: 1;
    stroke-dasharray: 1;
    stroke-dashoffset: 0;
  }
  /* The verdicts stay quieter than the questions: no halo until their label is open. */
  .dd-vs {
    fill: #bfe3e7;
    opacity: 0.7;
  }
  .dd-halo {
    fill: rgba(127, 184, 192, 0.14);
    opacity: 0;
  }
  :global(.sp-scene[data-focus='useful']) .dd-halo {
    opacity: 1;
  }
  :global(.sp-scene[data-focus='useful']) .dd-vs {
    opacity: 1;
  }
  .dd-fall {
    fill: none;
    stroke: rgba(246, 207, 138, 0.75);
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-dasharray: 1;
    stroke-dashoffset: 0;
  }
  .dd-head {
    fill: #fff1d6;
  }
  .cl-body {
    fill: var(--city-cloud, #0f1213);
    opacity: 0.75;
  }
  .cl-fill {
    fill: #456c70;
  }
  .cl-rim {
    fill: none;
    stroke: #7fb8c0;
    stroke-width: 1.3;
  }
  .dd-cloud[data-mode='off'] .cl-rim,
  .dd-cloud[data-mode='rest'] .cl-rim {
    stroke: rgba(237, 228, 212, 0.4);
    stroke-dasharray: 2 3;
  }
  .dd-cloud[data-mode='late'] .cl-fill {
    fill: #3a4b4d;
  }
  .cl-fog,
  .cl-rain {
    fill: none;
    stroke: rgba(127, 184, 192, 0.5);
    stroke-width: 1.4;
    stroke-linecap: round;
  }
  .cl-rain {
    stroke: #bfe3e7;
  }
  .tw-shaft {
    fill: var(--city-body, #0c1018);
    stroke: rgba(237, 228, 212, 0.3);
    stroke-width: 0.9;
  }
  .tw-face {
    fill: var(--city-shade, #080b11);
  }
  .tw-sun {
    fill: var(--city-sunlit, #cfe0ec);
    opacity: var(--city-sun-on, 0);
  }
  .tw-fins {
    stroke: rgba(237, 228, 212, 0.12);
    stroke-width: 1;
  }
  .tw-floors {
    stroke: rgba(237, 228, 212, 0.06);
    stroke-width: 0.6;
  }
  .tw-rooms {
    fill: #f6c47a;
    opacity: calc(var(--windows, 1) * 0.7);
  }
  .tw-glint,
  .ob-sun {
    fill: none;
    stroke: var(--city-glint, #f08a3c);
    stroke-width: 1.4;
    opacity: var(--city-glint-on, 0);
  }
  .tw-crown,
  .ob-terrace,
  .ob-drum {
    fill: var(--city-deck, #15171b);
    stroke: rgba(237, 228, 212, 0.4);
    stroke-width: 0.8;
  }
  .ob-rail {
    fill: none;
    stroke: rgba(237, 228, 212, 0.38);
    stroke-width: 0.9;
  }
  .ob-door {
    fill: #070504;
  }
  .ob-glow {
    fill: url(#sp-dd-glow);
  }
  .ob-panel {
    fill: #15201f;
  }
  .ob-panel.on {
    fill: #2e4f53;
  }
  .ob-slit {
    fill: #070504;
  }
  .ob-lit {
    fill: #f0a24e;
  }
  .ob-rib {
    stroke: rgba(237, 228, 212, 0.26);
    stroke-width: 0.8;
  }
  .ob-shell {
    fill: none;
    stroke: rgba(237, 228, 212, 0.5);
    stroke-width: 1;
  }
  .ob-tube {
    stroke: #2c2f36;
    stroke-width: 9;
    stroke-linecap: round;
  }
  .ob-tube-hi {
    stroke: rgba(237, 228, 212, 0.42);
    stroke-width: 1;
    stroke-linecap: round;
    transform: translateY(-3.5px);
  }

  /* The flourish: the stars come on one by one as the count climbs, the
     verdicts join up, the shooting stars fall. Held at the first frame until
     seen (data-arm), never under reduced motion. */
  :global(.sp-scene[data-arm]) .st,
  :global(.sp-scene[data-arm]) .dd-head,
  :global(.sp-scene[data-arm]) .ob-lit {
    opacity: 0;
  }
  :global(.sp-scene[data-arm]) :is(.dd-line, .dd-fall) {
    stroke-dashoffset: 1;
  }
  :global(.sp-scene[data-play]) .st {
    animation: sp-dd-on 320ms ease-out var(--d) both;
  }
  :global(.sp-scene[data-play]) .st.tw {
    animation:
      sp-dd-on 320ms ease-out var(--d) both,
      sp-dd-tw 2.4s ease-in-out calc(var(--d) + 1400ms) 2;
  }
  :global(.sp-scene[data-play]) .dd-line {
    animation: sp-dd-draw 1100ms ease-out 700ms both;
  }
  :global(.sp-scene[data-play]) .dd-fall {
    animation: sp-dd-draw 520ms ease-in calc(var(--d) + 900ms) both;
  }
  :global(.sp-scene[data-play]) .dd-head {
    animation: sp-dd-on 200ms ease-out calc(var(--d) + 1400ms) both;
  }
  :global(.sp-scene[data-play]) .ob-lit {
    animation: sp-dd-on 900ms ease-out both;
  }
  /* Only the twinkle is still going after the flourish; it waits off screen. */
  :global(.sp-scene[data-away]) .st.tw {
    animation-play-state: paused;
  }
  @keyframes sp-dd-on {
    0% {
      opacity: 0;
    }
    55% {
      opacity: 1;
    }
    75% {
      opacity: 0.45;
    }
    100% {
      opacity: var(--o, 0.86);
    }
  }
  @keyframes sp-dd-tw {
    0%,
    100% {
      opacity: var(--o, 0.86);
    }
    50% {
      opacity: 0.3;
    }
  }
  @keyframes sp-dd-draw {
    from {
      stroke-dashoffset: 1;
    }
    to {
      stroke-dashoffset: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .st,
    .dd-line,
    .dd-fall,
    .dd-head,
    .ob-lit {
      animation: none !important;
    }
  }
</style>
