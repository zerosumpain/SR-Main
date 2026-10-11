<svelte:options css="injected" />

<script lang="ts">
  // One project's building ($lib/projects/place `facade`), drawn in its own
  // box: on the skyline, on its plot and in the key. A picture only; whatever
  // holds it carries the link and the words. The colours are the home page's
  // daylight city (pale stone, blue glass, slate metal) with the site's
  // orange for the funfair and the cranes, and petrol for a finished product.
  import type { Facade } from './place';

  let { f, hidden = false, fit = 'stretch' }: {
    f: Facade;
    /** Not public: drawn behind hoarding, paler and outlined in dashes. */
    hidden?: boolean;
    /** Fill the holder exactly (its box already has the building's proportions), or keep them and sit at the foot. */
    fit?: 'stretch' | 'keep';
  } = $props();
</script>

<svg
  class="pb"
  data-m={f.material}
  data-hidden={hidden ? '' : undefined}
  viewBox="0 0 {f.w} {f.h}"
  preserveAspectRatio={fit === 'keep' ? 'xMidYMax meet' : 'none'}
  overflow="visible"
  aria-hidden="true"
  focusable="false"
>
  <path class="pb-body" d={f.body} />
  <path class="pb-shade" d={f.shade} />
  <path class="pb-roof" d={f.roof} />
  <path class="pb-glaze" d={f.glaze} />
  <path class="pb-fine" d={f.fine} />
  <path class="pb-trim" d={f.trim} />
  <path class="pb-accent" d={f.accent} />
  <path class="pb-lit" d={f.lit} />
  <path class="pb-line" d={f.line} />
</svg>

<style>
  .pb {
    /* Materials: the daylight city's (place-city DAY_FRAME), one set per family. */
    --b: #cbbfa8;
    --r: #6f9a96;
    --g: #4f6f8f;
    --t: #efe8da;
    --a: #e8863a;
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .pb[data-m='fair'] {
    --b: #e2d3b8;
    --r: #2b3a4f;
    --g: #3f5f80;
    --t: #f6efe2;
  }
  .pb[data-m='metal'] {
    --b: #5b7392;
    --r: #3e5272;
    --g: #2f4868;
    --t: #c9d3dd;
  }
  .pb[data-m='glass'] {
    --b: #6f9cc8;
    --r: #4b7aab;
    --g: #4b7aab;
    --t: #dfe9f2;
  }
  /* A finished product: petrol glass, its accents petrol too, a different kind of thing rather than a louder one. */
  .pb[data-m='petrol'] {
    --b: #3f7f88;
    --r: #2a6870;
    --g: #245e66;
    --t: #d9ecee;
    --a: #a3d2d8;
  }
  path {
    vector-effect: non-scaling-stroke;
  }
  .pb-body {
    fill: var(--b);
    stroke: rgba(26, 16, 8, 0.42);
    stroke-width: 1;
    stroke-linejoin: round;
  }
  .pb-shade {
    fill: rgba(26, 40, 64, 0.16);
  }
  .pb-roof {
    fill: var(--r);
    stroke: rgba(26, 16, 8, 0.42);
    stroke-width: 1;
    stroke-linejoin: round;
  }
  .pb-glaze {
    fill: var(--g);
  }
  .pb-fine {
    fill: none;
    stroke: rgba(232, 242, 252, 0.5);
    stroke-width: 0.6;
  }
  .pb-trim {
    fill: var(--t);
  }
  .pb-accent {
    fill: var(--a);
  }
  .pb-lit {
    fill: #ffefcf;
    stroke: rgba(208, 138, 58, 0.5);
    stroke-width: 0.6;
  }
  .pb-line {
    fill: none;
    stroke: #2a3442;
    stroke-width: 1;
    stroke-linecap: round;
  }
  /* Not public: behind hoarding, paler, its outline dashed like a site boundary. */
  .pb[data-hidden] {
    opacity: 0.62;
  }
  .pb[data-hidden] .pb-body,
  .pb[data-hidden] .pb-roof {
    stroke: rgba(26, 16, 8, 0.7);
    stroke-dasharray: 3 2;
  }
  @media print {
    .pb {
      display: none;
    }
  }
</style>
