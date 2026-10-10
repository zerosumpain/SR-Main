<svelte:options css="injected" />

<script lang="ts">
  // The place's city (HeroPlace): the distant skyline of every release day,
  // the street of the last forty (a building a day, a lit pane per deploy),
  // the tallest tower, whose beacon keeps the last heart rate, and the
  // promenade of today's steps. Pictures only, every number is in HeroPlace's
  // labels; each part carries `data-part`, so the label it answers to lights
  // it. Its geometry comes from $lib/landing/place and place-city, its sizes
  // from the custom properties HeroPlace sets for each width, and its light
  // from the sky's (--sky-*, --daylight, --windows, …) and the city's
  // (--city-*): no script runs per frame.
  import type { Path, Ridge } from '$lib/landing/place';
  import type { City } from '$lib/landing/place-city';
  import { scenery } from '$lib/landing/ramblers/scenery';

  let {
    hills,
    houses,
    bpm,
    path,
    sun,
  }: {
    hills: Ridge | null;
    houses: City | null;
    /** A fresh heart rate, or null: the beacon is lit only for a real one. */
    bpm: number | null;
    path: Path;
    /** The sun is low enough to draw: in the skyline's haze, where no text sits. */
    sun: boolean;
  } = $props();

  const HOURS = [6, 12, 18];
  // Street lights along the promenade, at the odd hours (clear of the hour ticks).
  const LAMPS = Array.from({ length: 12 }, (_, i) => ((i * 2 + 1) / 24) * 100);
</script>

<div class="pl-ground" aria-hidden="true"></div>
{#if hills}
  <!-- The farther range, then the sun (when it is low), then the nearer: the far towers cut its disc. -->
  <div class="pl-ridge pl-far" data-part="releases" aria-hidden="true">
    <svg viewBox="0 0 1000 100" preserveAspectRatio="none" focusable="false">
      <path class="r-far" d={hills.far} />
    </svg>
  </div>
{/if}
{#if sun}
  <!-- The sun itself, only while it is low: over the far skyline, behind the near one and the street. -->
  <i class="pl-sun" aria-hidden="true"></i>
{/if}
{#if hills}
  <div class="pl-ridge" data-part="releases" aria-hidden="true">
    <svg viewBox="0 0 1000 100" preserveAspectRatio="none" focusable="false">
      <path class="r-mast" d={hills.masts} />
      <path class="r-land" d={hills.d} />
      <path class="r-lights" d={hills.lights} />
      <path class="r-crest" d={hills.crest} />
      <path class="r-rim" d={hills.crest} />
    </svg>
    <!-- Distance is haze: the far towers' feet fade into the skyline's glow. -->
    <i class="r-mist"></i>
  </div>
  <!-- With Releases open the skyline lights up, but not under the plate's words. -->
  <div class="pl-veil" aria-hidden="true"></div>
{/if}

{#if houses}
  <div class="pl-town" data-part="ship" aria-hidden="true">
    <svg viewBox="0 0 1000 100" preserveAspectRatio="none" focusable="false">
      <defs>
        <!-- By day the glass catches the sky: lighter high up, as a curtain wall reflects it. -->
        <linearGradient id="pl-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0.26" />
          <stop offset="0.55" stop-color="#fff" stop-opacity="0.08" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path class="t-mast" d={houses.masts} />
      <path class="t-body t-glass" d={houses.bodies[0]} />
      <path class="t-body t-stone" d={houses.bodies[1]} />
      <path class="t-body t-metal" d={houses.bodies[2]} />
      <path class="t-face t-left" d={houses.faceL} />
      <path class="t-face t-right" d={houses.faceR} />
      <path class="t-glaze" d={houses.glaze} />
      <path class="t-sheen" d={houses.glaze} />
      <path class="t-band" d={houses.bands} />
      <path class="t-dark" d={houses.dark} />
      <path class="t-mullion" d={houses.mullions} />
      <path class="t-lit" d={houses.lit} />
      <path class="t-lit2" d={houses.lit2} />
      <rect class="t-today" x={houses.today.x} y={houses.today.top} width={houses.today.w} height={100 - houses.today.top} />
    </svg>
  </div>
{/if}

<div class="pl-light" data-part="pulse" aria-hidden="true">
  {#if bpm != null}
    <span class="pl-glow" data-beat></span>
  {/if}
  <svg viewBox="0 0 60 200" focusable="false">
    <!-- A supertall: a podium, a broad shaft that sets back two thirds of the
         way up, the sky deck (the lookout) and a raked glass crown above it,
         the beacon inside the crown. -->
    <path class="tw-mast" d="M42,22 V6" />
    <path class="tw-base" d="M2,200 V187 H58 V200 Z" />
    <path class="tw-shaft" d="M7,187 V108 H53 V187 Z M11,108 V52 H49 V108 Z" />
    <path class="tw-face tw-left" d="M7,187 V108 H11 V52 H15 V108 H11.5 V187 Z" />
    <path class="tw-face tw-right" d="M53,187 V108 H49 V52 H45 V108 H48.5 V187 Z" />
    <path class="tw-grid" d="M18.5,110 V185 M30,110 V185 M41.5,110 V185 M23.5,54 V106 M36.5,54 V106" />
    <path class="tw-bands" d="M7,128 H53 M7,148 H53 M7,168 H53 M11,72 H49 M11,90 H49" />
    <path class="tw-set" d="M6,108.5 H54" />
    <rect class="tw-door" x="24" y="177" width="12" height="10" />
    <path class="tw-crown" d="M11,46 V32 L49,20 V46 Z" />
    <path class="tw-glass" d="M9,46 V41 H51 V46" />
    <rect class="tw-deck" x="9" y="46" width="42" height="6" />
    {#if bpm != null}
      <circle class="lh-lamp" cx="30" cy="35.5" r="3.4" />
    {:else}
      <circle class="lh-dark" cx="30" cy="35.5" r="3" />
    {/if}
  </svg>
  <!-- The lookout: he climbs to the sky deck and looks out over the city. -->
  <span class="pl-deck" use:scenery={{ spot: 'lookout', at: 0.5 }}></span>
</div>

<!-- The promenade's rail and street lights, stopping at the street's ends so
     they never cross its lowest panes. -->
<div class="pl-rail" class:cut={houses} aria-hidden="true"></div>
<div class="pl-lamps" class:cut={houses} aria-hidden="true">
  {#each LAMPS as x (x)}<i style:left="{x}%"></i>{/each}
</div>
<!-- The promenade is a floor a kerb's depth in front of the street: the
     rambler walks along it, nearer than the buildings. -->
<span class="pl-walk" use:scenery></span>

<div class="pl-path" data-part="steps" aria-hidden="true" style:--now="{path.now / 10}%">
  <svg viewBox="0 0 1000 30" preserveAspectRatio="none" focusable="false">
    <path class="p-trail" d="M0,15 H{path.now}" />
    <path class="p-marks" d={path.marks} />
    {#each HOURS as h (h)}<path class="p-tick" d="M{(h / 24) * 1000},24 V29" />{/each}
  </svg>
  {#if path.now < 1000}
    <span class="p-rest" class:roomy={path.now < 640} class:wide={path.now < 400}><span>the rest is pending</span></span>
  {/if}
  <span class="p-now"></span>
  {#each HOURS as h (h)}<span class="p-hour" data-h={h} style:left="{(h / 24) * 100}%">{String(h).padStart(2, '0')}:00</span>{/each}
</div>

<style>
  /* Type and strokes on the sky take the hero's tone (--type: cream on the
     deep sky, ink on the daytime blue; HeroPlace). On the ground they stay
     cream: the ground is dark at every hour. */
  .pl-ground {
    position: absolute;
    left: 50%;
    bottom: 0;
    width: 100vw;
    height: var(--ground);
    margin-left: -50vw;
    background: var(--ink-sky);
    border-top: 1px solid rgba(var(--type), 0.2);
  }
  /* The kerb: the pavement between the street's foot and the promenade the
     rambler walks, so he reads as in front of the buildings. */
  .pl-ground::before {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: var(--kerb);
    background: rgba(237, 228, 212, 0.05);
    border-bottom: 1px solid rgba(237, 228, 212, 0.12);
  }
  /* Rail and lamps run the screen's width but stop at the street's ends. */
  .cut {
    -webkit-mask-image: linear-gradient(
      90deg,
      #000 var(--town-l),
      transparent var(--town-l),
      transparent calc(var(--town-l) + var(--town-w)),
      #000 calc(var(--town-l) + var(--town-w))
    );
    mask-image: linear-gradient(
      90deg,
      #000 var(--town-l),
      transparent var(--town-l),
      transparent calc(var(--town-l) + var(--town-w)),
      #000 calc(var(--town-l) + var(--town-w))
    );
  }
  .pl-rail {
    pointer-events: none;
    position: absolute;
    left: 0;
    right: 0;
    bottom: var(--ground);
    height: 9px;
    background:
      linear-gradient(rgba(var(--type), 0.26), rgba(var(--type), 0.26)) top / 100% 1px no-repeat,
      repeating-linear-gradient(90deg, rgba(var(--type), 0.16) 0 1px, transparent 1px 14px);
  }
  .pl-walk {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(var(--ground) - var(--kerb));
    height: 1px;
  }

  /* Every part of the picture answers to its label: pointing at one lights it
     and lets the rest fall back (HeroPlace sets data-focus). The hours and
     "pending" are text, and keep their contrast. :where, so the part being
     explained always wins back its light. */
  [data-part],
  .pl-path svg,
  .p-now {
    transition: opacity 0.25s ease;
  }
  :global(.pl[data-focus]) :where(.pl-ridge, .pl-town, .pl-light, .pl-path svg, .p-now) {
    opacity: 0.3;
  }
  :global(.pl[data-focus='releases']) .pl-ridge,
  :global(.pl[data-focus='ship']) .pl-town,
  :global(.pl[data-focus='pulse']) .pl-light,
  :global(.pl[data-focus='steps']) :is(.pl-path svg, .p-now) {
    opacity: 1;
  }

  .pl-ridge,
  .pl-town {
    position: absolute;
    bottom: var(--ground);
  }
  .pl-ridge svg,
  .pl-town svg,
  .pl-path svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  /* ------------------------------------------------- the distant skyline */

  /* Two ranges of towers in the haze, the farther paler (place-city.ts
     works both out from the sky), their roofs rimmed in the releases' petrol
     and the low sun, and a few windows lit after dark. */
  .pl-ridge {
    left: var(--ridge-l);
    width: var(--ridge-w);
    height: var(--ridge-h);
  }
  .r-far {
    fill: var(--city-far, #15211f);
  }
  .r-land {
    fill: var(--city-near, #0e1515);
    transition: fill 0.25s ease;
  }
  .r-mast {
    fill: none;
    stroke: var(--city-near, #0e1515);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .r-lights {
    fill: #f2c482;
    opacity: calc(var(--windows, 1) * 0.5);
  }
  .r-crest,
  .r-rim {
    fill: none;
    vector-effect: non-scaling-stroke;
    stroke-width: 1;
  }
  .r-crest {
    stroke: var(--accent-ink-on-dark);
    stroke-opacity: 0.42;
  }
  /* The low sun catches the rooftops facing it. */
  .r-rim {
    stroke: var(--sky-sun, #f6b45e);
    stroke-width: 1.5;
    opacity: calc(var(--warmth, 0) * 0.85);
  }
  .r-mist {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, var(--sky-haze) 0%, transparent 75%);
    pointer-events: none;
  }
  /* Lit up: by day the skyline darkens against the pale sky and its roofs
     take the petrol, so lighting up still means more contrast. */
  :global(.pl[data-focus='releases']) .r-land {
    fill: var(--city-near-on, var(--city-near));
  }
  :global(.pl[data-focus='releases']) .r-crest {
    stroke-opacity: 0.9;
  }

  /* Under the plate's words while Releases is open: the low sky, feathered
     at every edge so it never reads as a box over the skyline. */
  .pl-veil {
    position: absolute;
    left: 0;
    bottom: var(--ground);
    width: calc(var(--plate-w) + 24px);
    height: var(--ridge-h);
    background: var(--sky-low);
    -webkit-mask-image:
      linear-gradient(90deg, #000 calc(100% - 64px), transparent), linear-gradient(0deg, #000 40%, transparent);
    -webkit-mask-composite: source-in;
    mask-image: linear-gradient(90deg, #000 calc(100% - 64px), transparent), linear-gradient(0deg, #000 40%, transparent);
    mask-composite: intersect;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.25s ease;
  }
  :global(.pl[data-focus='releases']) .pl-veil {
    opacity: 0.7;
  }

  /* The low sun: a disc at --sun-x across the picture, risen as far as
     --sun-y says, and never lower than a third of the way up the far
     skyline once it is up, so a sunrise shows over the towers. */
  .pl-sun {
    position: absolute;
    left: var(--sun-x, 50%);
    bottom: calc(var(--ground) + max(var(--sun-y, 0) * 560px - 54px, var(--ridge-h) * 0.35 - 34px));
    width: 96px;
    height: 96px;
    margin-left: -48px;
    border-radius: 100px;
    background: radial-gradient(
      closest-side,
      var(--sky-sun) 14px,
      color-mix(in srgb, var(--sky-sun) 42%, transparent) 16px,
      color-mix(in srgb, var(--sky-sun) 12%, transparent) 60%,
      transparent
    );
    pointer-events: none;
  }
  /* A low western sun sets in the clear gap between the street's end and the
     tower, rather than behind the street where nothing of it would show. */
  :global(.pl[data-side='west']) .pl-sun {
    left: calc(var(--town-l) + var(--town-w) + (100% - var(--town-l) - var(--town-w) - var(--lh-w)) / 2);
  }

  /* ----------------------------------------------------------- the street */

  /* Forty buildings: silhouettes with warm panes at night; by day sunlit
     glass and stone, the deploy panes a glint of sun edged in the site's
     orange. The faces either side of each curtain wall take the low sun on
     the side it stands (east while it climbs, west while it sinks) and a
     cool shade on the other. */
  .pl-town {
    left: var(--town-l);
    width: var(--town-w);
    height: var(--town-h);
  }
  .t-body {
    stroke: rgba(237, 228, 212, calc(0.22 - 0.2 * var(--daylight, 0)));
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .t-glass {
    fill: var(--city-glass, #0e121a);
  }
  .t-stone {
    fill: var(--city-stone, #13110f);
  }
  .t-metal {
    fill: var(--city-metal, #0b0d12);
  }
  .t-sheen {
    fill: url(#pl-sheen);
    opacity: var(--daylight, 0);
  }
  .t-face {
    fill: var(--sky-sun, #f6b45e);
    opacity: 0;
  }
  /* The sun's side catches the light; the other falls into shade. */
  :global(.pl[data-side='east']) .t-left,
  :global(.pl[data-side='west']) .t-right {
    opacity: var(--city-sunface, 0);
  }
  :global(.pl[data-side='east']) .t-right,
  :global(.pl[data-side='west']) .t-left {
    fill: var(--city-shade-fill, #000);
    opacity: var(--city-shade, 0);
  }
  .t-glaze {
    fill: var(--city-glaze, #07090e);
  }
  .t-band {
    fill: var(--city-band, #1a1d24);
  }
  .t-mullion {
    fill: none;
    stroke: var(--city-mullion, rgba(237, 228, 212, 0.1));
    stroke-width: 0.6;
    vector-effect: non-scaling-stroke;
  }
  .t-mast {
    fill: none;
    stroke: rgba(var(--type), 0.42);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .t-dark {
    fill: var(--city-unlit, rgba(237, 228, 212, 0.08));
  }
  .t-lit,
  .t-lit2 {
    stroke: var(--city-pane-edge, none);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .t-lit {
    fill: var(--city-pane, #f5bd6e);
  }
  .t-lit2 {
    fill: var(--city-pane2, #fbe0aa);
  }
  .t-today {
    fill: none;
    stroke: var(--accent-on-dark);
    stroke-width: 1;
    stroke-dasharray: 3 2;
    vector-effect: non-scaling-stroke;
  }

  /* ------------------------------------------------------ the tall tower */

  /* The tallest tower, at the end of the street; its sky deck is the lookout
     and its glass crown carries the beacon. */
  .pl-light {
    position: absolute;
    right: 0;
    bottom: var(--lh-b);
    width: var(--lh-w);
    height: var(--lh-h);
  }
  .pl-light svg {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
  }
  .tw-base {
    fill: var(--city-metal, #0b0d12);
    stroke: rgba(var(--type), 0.2);
    stroke-width: 0.8;
  }
  .tw-shaft {
    fill: var(--city-glass, #0e121a);
    stroke: rgba(var(--type), 0.38);
    stroke-width: 0.8;
  }
  .tw-crown {
    fill: var(--city-glaze, #07090e);
    stroke: rgba(var(--type), 0.45);
    stroke-width: 0.8;
  }
  .tw-face {
    fill: var(--sky-sun, #f6b45e);
    opacity: 0;
  }
  :global(.pl[data-side='east']) .tw-left,
  :global(.pl[data-side='west']) .tw-right {
    opacity: var(--city-sunface, 0);
  }
  :global(.pl[data-side='east']) .tw-right,
  :global(.pl[data-side='west']) .tw-left {
    fill: var(--city-shade-fill, #000);
    opacity: var(--city-shade, 0);
  }
  .tw-grid {
    fill: none;
    stroke: var(--city-mullion, rgba(237, 228, 212, 0.1));
    stroke-width: 0.5;
  }
  .tw-bands {
    fill: none;
    stroke: rgba(var(--type), 0.14);
    stroke-width: 0.6;
  }
  .tw-set {
    fill: none;
    stroke: var(--accent-ink-on-dark);
    stroke-opacity: 0.5;
    stroke-width: 0.8;
  }
  .tw-door {
    fill: var(--city-glaze, #07090e);
  }
  .tw-mast {
    fill: none;
    stroke: rgba(var(--type), 0.55);
    stroke-width: 1;
  }
  .tw-glass {
    fill: rgba(127, 184, 192, 0.12);
    stroke: rgba(var(--type), 0.38);
    stroke-width: 0.8;
  }
  .tw-deck {
    fill: var(--city-metal, #0b0d12);
    stroke: rgba(var(--type), 0.5);
    stroke-width: 0.8;
  }
  .lh-lamp {
    fill: #ff8a63;
  }
  .lh-dark {
    fill: none;
    stroke: rgba(var(--type), 0.5);
    stroke-width: 0.9;
  }
  /* As wide as the drawn deck, and never under 44px: the rambler keeps a
     margin from a floor's ends, and a narrower deck leaves him nowhere to
     climb to. */
  .pl-deck {
    position: absolute;
    left: 50%;
    width: max(66.7%, 44px);
    top: 23%;
    height: 3%;
    transform: translateX(-50%);
  }
  /* The beacon's glow: a plain box whose opacity alone animates. */
  .pl-glow {
    position: absolute;
    top: 17.75%;
    left: 50%;
    width: 120px;
    height: 120px;
    margin: -60px 0 0 -60px;
    border-radius: 100px;
    background: radial-gradient(closest-side, rgba(255, 170, 140, 0.7), rgba(255, 96, 64, 0.2) 50%, rgba(255, 96, 64, 0));
    opacity: 0.8;
    pointer-events: none;
  }
  /* Never more than three flashes a second: lub-dub (two a beat) up to 90 a
     minute, a single flash a beat up to 180, and above that the beacon stays
     lit at rest, as the sentence's glow sits out. */
  :global(.pl:not([data-still])[data-lamp='lubdub']) .pl-glow {
    will-change: opacity;
    animation: pl-lamp var(--beat) ease-out infinite;
  }
  :global(.pl:not([data-still])[data-lamp='flash']) .pl-glow {
    will-change: opacity;
    animation: pl-flash var(--beat) ease-out infinite;
  }
  @keyframes pl-flash {
    0% {
      opacity: 1;
    }
    40%,
    100% {
      opacity: 0.18;
    }
  }
  /* Lub-dub: a bright flash, a dip, a second softer flash, then rest. */
  @keyframes pl-lamp {
    0% {
      opacity: 1;
    }
    9% {
      opacity: 0.4;
    }
    17% {
      opacity: 0.88;
    }
    42%,
    100% {
      opacity: 0.18;
    }
  }

  /* -------------------------------------------------------- the promenade */

  /* Street lights: a post and a lamp, its pool of light strongest at night. */
  .pl-lamps {
    position: absolute;
    left: 0;
    right: 0;
    bottom: var(--ground);
    height: 22px;
    pointer-events: none;
  }
  .pl-lamps i {
    position: absolute;
    bottom: 0;
    width: 1px;
    height: 19px;
    background: rgba(var(--type), 0.34);
  }
  .pl-lamps i::before {
    content: '';
    position: absolute;
    top: -1px;
    left: -2px;
    width: 5px;
    height: 2px;
    border-radius: 2px;
    background: color-mix(in srgb, #ffd9a0 calc(var(--windows, 1) * 100%), rgba(var(--type), 0.5));
  }
  .pl-lamps i::after {
    content: '';
    position: absolute;
    top: -6px;
    left: -9px;
    width: 19px;
    height: 19px;
    border-radius: 100px;
    background: radial-gradient(closest-side, rgba(255, 214, 150, 0.36), rgba(255, 214, 150, 0));
    opacity: calc(var(--windows, 1) - 0.15);
  }

  /* The footpath along the promenade: today's steps, midnight to 23:59. On
     the ground, so cream at every hour. */
  .pl-path {
    --type: 237, 228, 212;
    --cream: #ede4d4;
    --accent-on-dark: #e8863a;
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(var(--ground) - 30px);
    height: 30px;
  }
  .p-trail {
    fill: none;
    stroke: rgba(var(--type), 0.4);
    stroke-width: 1.2;
    stroke-dasharray: 1 4;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .p-marks {
    fill: none;
    stroke: rgba(var(--type), 0.78);
    stroke-width: 2;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .p-tick {
    stroke: rgba(var(--type), 0.3);
    vector-effect: non-scaling-stroke;
  }
  .p-now {
    position: absolute;
    left: var(--now);
    top: 15px;
    width: 8px;
    height: 8px;
    margin: -4px 0 0 -4px;
    border-radius: 100px;
    background: var(--accent-on-dark);
  }
  /* The rest of the day, hatched, and said so where it fits. */
  .p-rest {
    position: absolute;
    left: calc(var(--now) + 8px);
    right: 0;
    top: 7px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: repeating-linear-gradient(135deg, rgba(var(--type), 0.12) 0 1px, transparent 1px 6px);
  }
  .p-rest > span {
    display: none;
    padding: 0 8px;
    background: var(--ink-sky);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 16px;
    letter-spacing: 0.06em;
    color: rgba(var(--type), 0.72);
    white-space: nowrap;
  }
  .p-rest.roomy > span {
    display: block;
  }
  .p-hour {
    position: absolute;
    top: 31px;
    transform: translateX(-50%);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    color: rgba(var(--type), 0.72);
  }

  /* A very wide screen: the far skyline's first towers fade into the haze
     rather than stop at a hard edge in the empty margin. */
  @media (min-width: 1600px) {
    .pl-ridge {
      -webkit-mask-image: linear-gradient(90deg, transparent, #000 60px);
      mask-image: linear-gradient(90deg, transparent, #000 60px);
    }
  }
  @media (max-width: 1099px) {
    /* The steps label's room on the promenade: 06:00 stands aside. */
    .p-hour[data-h='6'] {
      display: none;
    }
  }
  @media (max-width: 759px) {
    .pl-veil {
      display: none;
    }
    .pl-glow {
      width: 80px;
      height: 80px;
      margin: -40px 0 0 -40px;
    }
    .pl-lamps i {
      height: 15px;
    }
    .p-hour {
      display: none;
    }
    .p-rest.roomy:not(.wide) > span {
      display: none;
    }
    .pl-sun {
      bottom: calc(var(--ground) + max(var(--sun-y, 0) * 380px - 52px, var(--ridge-h) * 0.35 - 30px));
      transform: scale(0.75);
    }
  }
  /* The light changes with the sun; let it ease where motion is welcome. */
  .t-sheen,
  .t-face,
  .tw-face,
  .r-lights,
  .r-rim,
  .pl-lamps i::after {
    transition: opacity 2s ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-glow {
      animation: none !important;
    }
    [data-part],
    .r-land,
    .t-sheen,
    .t-face,
    .tw-face,
    .r-lights,
    .r-rim,
    .pl-lamps i::after {
      transition: none;
    }
  }
  @media print {
    .pl-sun {
      display: none;
    }
  }
</style>
