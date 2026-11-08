<svelte:options css="injected" />

<script lang="ts" module>
  import type { TerrainClass, WildmindMap as MapData } from '$lib/landing/wildmind';
  import type { FrameRect } from '$lib/landing/wildmind-frame';

  /** What an overlay snippet gets: the map, and where a map point sits as a CSS position. */
  export interface WildmindOverlay {
    map: MapData;
    /** `left:…%;top:…%` for a point in map units, for an absolutely placed HTML label. */
    place: (x: number, y: number) => string;
    /** The same point as fractions of the frame (0–1), for a view's own placing. */
    frac: (x: number, y: number) => { x: number; y: number };
    /** The drawn frame in map units (the map itself unless `frame` pads it). */
    frame: FrameRect;
  }
  /** What a defs/under/over snippet gets: the map and this instance's id prefix. */
  export interface WildmindLayer {
    map: MapData;
    /** Unique per map on the page: prefix every id inside the SVG with it. */
    uid: string;
    /** The drawn frame in map units (the map itself unless `frame` pads it). */
    frame: FrameRect;
  }
  export type WildmindFill = TerrainClass | 'relief';
</script>

<script lang="ts">
  // The shared Wildmind map: the land the two of them have seen, traced on the
  // server into one path per terrain class (see wildmind-trace.server.ts), with
  // the people, what they built, fires and animals on top, and a night wash.
  // It draws the map and nothing else: no heading, caption, frame or label of
  // its own. Each view dresses it.
  //
  //  - Colour: every fill and stroke is a --wm-* variable the view sets on an
  //    ancestor (fallbacks are the game's own colours). A class can take a
  //    pattern instead: give its id suffix in `patterns` and define it in the
  //    `defs` snippet as `{uid}-{suffix}`.
  //  - Extra SVG: `under` draws above the ground and below the markers (a
  //    hatch, contours), `over` on top of everything (an LED mask, scanlines).
  //  - Words: never inside the SVG (a scaled viewBox would take type under the
  //    12px floor). `overlay` places HTML over the frame by percentage.
  //  - The SVG is aria-hidden: the view puts mapSummary() beside it.
  //  - Ids are prefixed `{id}-{instance}`, so two maps on one page never collide.
  //
  // It is static: the people move because the view passes WildmindPoll's
  // gliding `people`. It prints as it is.
  import type { Snippet } from 'svelte';
  import type { StructureClass, WildmindPerson } from '$lib/landing/wildmind';
  import { frameRect } from '$lib/landing/wildmind-frame';

  let {
    map,
    id,
    people = [],
    animals = [],
    structures = [],
    fires = [],
    species = [],
    night = null,
    mark = 1,
    trails = true,
    fit = 'meet',
    frame,
    patterns = {},
    defs,
    under,
    over,
    overlay,
    empty,
  }: {
    /** The traced map, or null (then `empty` is drawn in a frame of the same shape). */
    map: MapData | null;
    /** The view's id prefix ('ss-wm', 'sn-wm'). */
    id: string;
    people?: WildmindPerson[];
    animals?: Array<[number, number, number, 0 | 1]>;
    structures?: Array<[number, number, 0 | 1, 0 | 1, StructureClass]>;
    fires?: Array<[number, number]>;
    /** Species words the animals index into (sets data-species, so a view can pick out wolves). */
    species?: string[];
    /** 0 (day) to 1 (night). */
    night?: number | null;
    /** Marker size multiplier: markers are in map units, so a small map wants a bigger mark. */
    mark?: number;
    /** Draw each person's recent trail. */
    trails?: boolean;
    /** 'meet' keeps the whole map in a frame of its shape; 'slice' fills the view's own frame. */
    fit?: 'meet' | 'slice';
    /**
     * A fixed frame (with fit 'meet'): the viewBox is padded evenly to this
     * aspect and at least `minW` units wide, so the figure keeps one shape as
     * the map grows. `place`, `frac` and the aspect ratio then use the frame.
     */
    frame?: { aspect: number; minW: number };
    /** Terrain classes (and 'relief') filled with a pattern from `defs`: class → id suffix. */
    patterns?: Partial<Record<WildmindFill, string>>;
    defs?: Snippet<[WildmindLayer]>;
    under?: Snippet<[WildmindLayer]>;
    over?: Snippet<[WildmindLayer]>;
    overlay?: Snippet<[WildmindOverlay]>;
    empty?: Snippet;
  } = $props();

  const instance = $props.id();
  const uid = $derived(`${id}-${instance}`);
  const fillFor = (k: WildmindFill) => (patterns[k] ? `url(#${uid}-${patterns[k]})` : undefined);
  const pct = (n: number) => `${Math.round(n * 10_000) / 100}%`;
  const box = $derived(map ? frameRect(map, frame) : { x: 0, y: 0, w: 1, h: 1 });
  const frac = (x: number, y: number) => (map ? { x: (x - box.x) / box.w, y: (y - box.y) / box.h } : { x: 0, y: 0 });
  const place = (x: number, y: number) => {
    const f = frac(x, y);
    return `left:${pct(f.x)};top:${pct(f.y)}`;
  };
  const r = (n: number) => Math.round(n * 100) / 100;
  const trailPoints = (p: WildmindPerson) => [...p.trail, [p.x, p.y]].map(([x, y]) => `${x},${y}`).join(' ');
</script>

<div class="wm" data-fit={fit} data-empty={map ? undefined : ''} style:aspect-ratio={map && fit === 'meet' ? `${r(box.w)} / ${r(box.h)}` : undefined}>
  {#if map}
    <svg
      viewBox="{r(box.x)} {r(box.y)} {r(box.w)} {r(box.h)}"
      preserveAspectRatio={fit === 'slice' ? 'xMidYMid slice' : 'xMidYMid meet'}
      aria-hidden="true"
      focusable="false"
    >
      {#if defs}<defs>{@render defs({ map, uid, frame: box })}</defs>{/if}
      <g class="wm-ground">
        <path class="wm-seen" d={map.seen} />
        {#each map.layers as l (l.cls)}
          <path class="wm-l" data-cls={l.cls} d={l.d} style:fill={fillFor(l.cls)} />
        {/each}
        {#if map.relief}<path class="wm-relief" d={map.relief} style:fill={fillFor('relief')} />{/if}
        <path class="wm-edge" d={map.seen} />
      </g>
      {@render under?.({ map, uid, frame: box })}
      {#if night}<path class="wm-night" d={map.seen} style:--wm-n={r(night)} />{/if}
      <g class="wm-marks">
        {#each animals as [x, y, s], i (i)}
          <circle class="wm-animal" data-species={species[s] ?? 'animal'} cx={x} cy={y} r={r((species[s] === 'wolf' ? 0.6 : 0.45) * mark)} />
        {/each}
        {#each structures as [x, y, complete, lit, cls], i (i)}
          {#if lit}<circle class="wm-lit" cx={x} cy={y} r={r(3 * mark)} />{/if}
          <rect
            class="wm-built"
            data-cls={cls}
            data-unfinished={complete ? undefined : ''}
            x={r(x - 0.6 * mark)}
            y={r(y - 0.6 * mark)}
            width={r(1.2 * mark)}
            height={r(1.2 * mark)}
          />
        {/each}
        {#each fires as [x, y], i (i)}
          <circle class="wm-fire" cx={x} cy={y} r={r(0.8 * mark)} />
        {/each}
        {#if trails}
          {#each people as p (p.id)}
            {#if p.alive && p.trail.length}<polyline class="wm-trail" data-who={p.id} points={trailPoints(p)} />{/if}
          {/each}
        {/if}
        {#each people as p (p.id)}
          <g class="wm-p" data-who={p.id} data-alive={p.alive ? undefined : 'no'} transform="translate({p.x} {p.y})">
            {#if p.alive}
              <line class="wm-tick" x1="0" y1="0" x2={r(Math.sin(p.heading) * 2.6 * mark)} y2={r(Math.cos(p.heading) * 2.6 * mark)} />
            {/if}
            <circle class="wm-disc" r={r(1.5 * mark)} />
          </g>
        {/each}
      </g>
      {@render over?.({ map, uid, frame: box })}
    </svg>
    {#if overlay}
      <div class="wm-over">{@render overlay({ map, place, frac, frame: box })}</div>
    {/if}
  {:else}
    {@render empty?.()}
  {/if}
</div>

<style>
  .wm {
    position: relative;
    width: 100%;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .wm[data-empty] {
    aspect-ratio: 3 / 2;
  }
  .wm[data-fit='slice'] {
    height: 100%;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  path {
    fill-rule: evenodd;
    clip-rule: evenodd;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .wm-seen {
    fill: var(--wm-ground, var(--wm-open, rgb(118, 152, 80)));
  }
  .wm-l {
    stroke: none;
  }
  .wm-l[data-cls='sea'] {
    fill: var(--wm-sea, rgb(28, 66, 96));
    stroke: var(--wm-coast, none);
    stroke-width: var(--wm-coast-width, 1px);
  }
  .wm-l[data-cls='fresh'] {
    fill: var(--wm-fresh, rgb(70, 132, 146));
    stroke: var(--wm-coast, none);
    stroke-width: var(--wm-coast-width, 1px);
  }
  .wm-l[data-cls='shore'] {
    fill: var(--wm-shore, rgb(210, 194, 148));
  }
  .wm-l[data-cls='open'] {
    fill: var(--wm-open, rgb(118, 152, 80));
  }
  .wm-l[data-cls='wood'] {
    fill: var(--wm-wood, rgb(68, 104, 58));
  }
  .wm-l[data-cls='wet'] {
    fill: var(--wm-wet, rgb(104, 118, 76));
  }
  .wm-l[data-cls='high'] {
    fill: var(--wm-high, rgb(138, 134, 126));
  }
  .wm-relief {
    fill: var(--wm-relief, none);
    stroke: var(--wm-relief-line, none);
    stroke-width: var(--wm-relief-width, 1px);
  }
  .wm-edge {
    fill: none;
    stroke: var(--wm-edge, none);
    stroke-width: var(--wm-edge-width, 1px);
    stroke-dasharray: var(--wm-edge-dash, none);
  }
  .wm-night {
    fill: var(--wm-night, rgb(8, 14, 34));
    opacity: calc(var(--wm-n, 0) * var(--wm-night-strength, 0.38));
  }
  .wm-animal {
    fill: var(--wm-animal, rgb(92, 74, 58));
  }
  .wm-built {
    fill: var(--wm-built, rgb(239, 230, 207));
    stroke: var(--wm-built-edge, var(--wm-halo, none));
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }
  .wm-built[data-unfinished] {
    opacity: 0.5;
  }
  .wm-lit {
    fill: var(--wm-lit, rgb(255, 179, 71));
    opacity: 0.35;
  }
  .wm-fire {
    fill: var(--wm-fire, rgb(255, 122, 26));
  }
  .wm-p {
    --wm-who: var(--wm-jkai, rgb(212, 98, 26));
  }
  .wm-p[data-who='companion'],
  .wm-trail[data-who='companion'] {
    --wm-who: var(--wm-companion, rgb(14, 91, 102));
  }
  .wm-trail {
    --wm-who: var(--wm-jkai, rgb(212, 98, 26));
    fill: none;
    stroke: var(--wm-who);
    stroke-width: var(--wm-trail-width, 1.5px);
    stroke-dasharray: var(--wm-trail-dash, 2 3);
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.6;
    vector-effect: non-scaling-stroke;
  }
  .wm-disc {
    fill: var(--wm-who);
    stroke: var(--wm-halo, rgb(255, 255, 255));
    stroke-width: 1.5px;
    vector-effect: non-scaling-stroke;
  }
  .wm-tick {
    stroke: var(--wm-who);
    stroke-width: 2px;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .wm-p[data-alive='no'] .wm-disc {
    fill: none;
    stroke: var(--wm-who);
    stroke-dasharray: 2 2;
  }
  .wm-over {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .wm-over > :global(*) {
    pointer-events: auto;
  }
</style>
