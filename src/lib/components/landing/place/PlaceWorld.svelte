<script lang="ts">
  // The place's landscape (HeroPlace): the ridge of every release day, the
  // terrace of the last forty, the lighthouse that keeps the last heart rate
  // and the footpath of today's steps along the shore. Pictures only, every
  // number is in HeroPlace's labels; each part carries `data-part`, so the
  // label it answers to lights it. Its geometry comes from $lib/landing/place
  // and its sizes from the custom properties HeroPlace sets for each width.
  import type { Path, Ridge, Town } from '$lib/landing/place';
  import { scenery } from '$lib/landing/ramblers/scenery';

  let {
    hills,
    houses,
    bpm,
    path,
  }: {
    hills: Ridge | null;
    houses: Town | null;
    /** A fresh heart rate, or null: the lamp is lit only for a real one. */
    bpm: number | null;
    path: Path;
  } = $props();

  const HOURS = [6, 12, 18];
</script>

<div class="pl-ground" aria-hidden="true"></div>
{#if hills}
  <div class="pl-ridge" data-part="releases" aria-hidden="true">
    <svg viewBox="0 0 1000 100" preserveAspectRatio="none" focusable="false">
      <defs>
        <linearGradient id="pl-ridge-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#20393c" />
          <stop offset="1" stop-color="#0e1515" />
        </linearGradient>
      </defs>
      <path class="r-far" d={hills.far} />
      <path class="r-land" d={hills.d} />
      <path class="r-strata" d={hills.strata} />
      <path class="r-crest" d={hills.crest} />
    </svg>
  </div>
  <!-- With Releases open the ridge lights up, but not under the plate's words. -->
  <div class="pl-veil" aria-hidden="true"></div>
{/if}

{#if houses}
  <div class="pl-town" data-part="ship" aria-hidden="true">
    <svg viewBox="0 0 1000 100" preserveAspectRatio="none" focusable="false">
      {#each houses.blocks as b (b.x)}<rect class="t-block" x={b.x} y={b.top} width={b.w} height={100 - b.top} />{/each}
      <path class="t-dark" d={houses.dark} />
      <path class="t-lit" d={houses.lit} />
      <path class="t-lit2" d={houses.lit2} />
      <rect class="t-today" x={houses.today.x + 0.8} y={houses.today.top} width={houses.today.w - 1.6} height={100 - houses.today.top} />
    </svg>
    <!-- The flat roofs are floors: a block stands as tall as its busiest day. -->
    {#each houses.blocks as b (b.x)}
      <span class="pl-roof" style:left="{b.x / 10}%" style:width="{b.w / 10}%" style:top="{b.top}%" use:scenery></span>
    {/each}
  </div>
{/if}

<div class="pl-light" data-part="pulse" aria-hidden="true">
  {#if bpm != null}
    <span class="pl-beam" data-beat></span>
    <span class="pl-glow" data-beat></span>
  {/if}
  <svg viewBox="0 0 60 200" focusable="false">
    <path class="lh-rock" d="M0,200 C4,188 14,181 30,180 C46,181 56,188 60,200 Z" />
    <path class="lh-tower" d="M19.5,182 L23,52 L37,52 L40.5,182 Z" />
    <path class="lh-band" d="M20.6,148 L21,136 L39,136 L39.4,148 Z M21.7,108 L22,97 L38,97 L38.3,108 Z" />
    <rect class="lh-door" x="27" y="168" width="6" height="14" />
    <rect class="lh-room" x="21.5" y="25" width="17" height="21" />
    <path class="lh-room" d="M18.5,25 L30,14 L41.5,25 Z M30,14 V8" />
    <rect class="lh-deck" x="10" y="46" width="40" height="6" />
    <path class="lh-rail" d="M12,46 V40 M20,46 V40 M40,46 V40 M48,46 V40 M11,40.5 H21 M39,40.5 H49" />
    {#if bpm != null}
      <circle class="lh-lamp" cx="30" cy="35.5" r="3.4" />
    {:else}
      <circle class="lh-dark" cx="30" cy="35.5" r="3" />
    {/if}
  </svg>
  <!-- The lookout: he climbs to the gallery and looks out over the town. -->
  <span class="pl-deck" use:scenery={{ spot: 'lookout', at: 0.5 }}></span>
</div>

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
  .pl-ground {
    position: absolute;
    left: 50%;
    bottom: 0;
    width: 100vw;
    height: var(--ground);
    margin-left: -50vw;
    background: var(--ink-sky);
    border-top: 1px solid rgba(237, 228, 212, 0.16);
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
  .pl-ridge {
    left: var(--ridge-l);
    width: var(--ridge-w);
    height: var(--ridge-h);
  }
  .r-far {
    fill: #15211f;
    stroke: rgba(127, 184, 192, 0.2);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .r-land {
    fill: url(#pl-ridge-g);
  }
  .r-strata,
  .r-crest {
    fill: none;
    vector-effect: non-scaling-stroke;
    stroke-linejoin: round;
  }
  .r-strata {
    stroke: rgba(127, 184, 192, 0.14);
    stroke-width: 1;
  }
  .r-crest {
    stroke: rgba(127, 184, 192, 0.62);
    stroke-width: 1.2;
  }

  .pl-veil {
    position: absolute;
    left: 0;
    bottom: var(--ground);
    width: calc(var(--plate-w) + 24px);
    height: var(--ridge-h);
    background: var(--sky-low);
    -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 48px), transparent);
    mask-image: linear-gradient(90deg, #000 calc(100% - 48px), transparent);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.25s ease;
  }
  :global(.pl[data-focus='releases']) .pl-veil {
    opacity: 0.8;
  }
  .pl-town {
    left: var(--town-l);
    width: var(--town-w);
    height: var(--town-h);
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
  .t-today {
    fill: none;
    stroke: var(--accent-on-dark);
    stroke-width: 1;
    stroke-dasharray: 3 2;
    vector-effect: non-scaling-stroke;
  }
  .pl-roof {
    position: absolute;
    bottom: 0;
  }

  /* The lighthouse at the end of the town; its gallery is the lookout. */
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
  .lh-rock {
    fill: #0d0907;
    stroke: rgba(237, 228, 212, 0.14);
  }
  .lh-tower {
    fill: #1d1611;
    stroke: rgba(237, 228, 212, 0.32);
    stroke-width: 0.8;
  }
  .lh-band {
    fill: rgba(127, 184, 192, 0.24);
  }
  .lh-door {
    fill: #070504;
  }
  .lh-room {
    fill: #1b130d;
    stroke: rgba(237, 228, 212, 0.42);
    stroke-width: 0.8;
  }
  .lh-deck {
    fill: #2c2119;
    stroke: rgba(237, 228, 212, 0.48);
    stroke-width: 0.8;
  }
  .lh-rail {
    fill: none;
    stroke: rgba(237, 228, 212, 0.38);
    stroke-width: 0.8;
  }
  .lh-lamp {
    fill: #fff1d6;
  }
  .lh-dark {
    fill: none;
    stroke: rgba(237, 228, 212, 0.5);
    stroke-width: 0.9;
  }
  /* As wide as the drawn gallery, and never under 44px: the rambler keeps a
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
  /* The lamp's glow and its beam: plain boxes whose opacity alone animates. */
  .pl-glow,
  .pl-beam {
    position: absolute;
    top: 17.75%;
    pointer-events: none;
  }
  .pl-glow {
    left: 50%;
    width: 120px;
    height: 120px;
    margin: -60px 0 0 -60px;
    border-radius: 100px;
    background: radial-gradient(closest-side, rgba(255, 232, 190, 0.62), rgba(255, 196, 120, 0.16) 50%, rgba(255, 196, 120, 0));
    opacity: 0.8;
  }
  .pl-beam {
    right: 50%;
    width: min(380px, 34vw);
    height: 96px;
    margin-top: -48px;
    transform: rotate(5deg);
    transform-origin: 100% 50%;
    background: linear-gradient(to left, rgba(255, 226, 170, 0.26), rgba(255, 226, 170, 0) 92%);
    clip-path: polygon(0 0, 100% 47%, 100% 53%, 0 100%);
    opacity: 0.6;
  }
  /* Never more than three flashes a second: lub-dub (two a beat) up to 90 a
     minute, a single flash a beat up to 180, and above that the lamp stays
     lit at rest, as the sentence's glow sits out. */
  :global(.pl:not([data-still])[data-lamp='lubdub']) :is(.pl-glow, .pl-beam) {
    will-change: opacity;
    animation: pl-lamp var(--beat) ease-out infinite;
  }
  :global(.pl:not([data-still])[data-lamp='flash']) :is(.pl-glow, .pl-beam) {
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

  /* The footpath along the shore: today's steps, midnight to 23:59. */
  .pl-path {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(var(--ground) - 30px);
    height: 30px;
  }
  .p-trail {
    fill: none;
    stroke: rgba(237, 228, 212, 0.4);
    stroke-width: 1.2;
    stroke-dasharray: 1 4;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .p-marks {
    fill: none;
    stroke: rgba(237, 228, 212, 0.78);
    stroke-width: 2;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .p-tick {
    stroke: rgba(237, 228, 212, 0.3);
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
    background: repeating-linear-gradient(135deg, rgba(237, 228, 212, 0.12) 0 1px, transparent 1px 6px);
  }
  .p-rest > span {
    display: none;
    padding: 0 8px;
    background: var(--ink-sky);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 16px;
    letter-spacing: 0.06em;
    color: rgba(237, 228, 212, 0.72);
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
    color: rgba(237, 228, 212, 0.72);
  }

  @media (max-width: 1099px) {
    /* The steps label's room on the shore: 06:00 stands aside. */
    .p-hour[data-h='6'] {
      display: none;
    }
  }
  @media (max-width: 759px) {
    .pl-veil {
      display: none;
    }
    /* The beam turns out to sea, off the labels; the glow keeps the beat. */
    .pl-beam {
      right: auto;
      left: 50%;
      width: 120px;
      height: 60px;
      margin-top: -30px;
      transform: rotate(-4deg);
      transform-origin: 0 50%;
      background: linear-gradient(to right, rgba(255, 226, 170, 0.26), rgba(255, 226, 170, 0) 92%);
      clip-path: polygon(0 47%, 100% 0, 100% 100%, 0 53%);
    }
    .pl-glow {
      width: 80px;
      height: 80px;
      margin: -40px 0 0 -40px;
    }
    .p-hour {
      display: none;
    }
    .p-rest.roomy:not(.wide) > span {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-glow,
    .pl-beam {
      animation: none !important;
    }
    [data-part] {
      transition: none;
    }
  }
</style>
