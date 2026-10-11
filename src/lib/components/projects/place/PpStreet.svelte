<svelte:options css="injected" />

<script lang="ts">
  // The skyline: every project on the index as one building on one street,
  // quarter by quarter ($lib/projects/place `street`). Each building is a
  // real link to its project; pointing at one or focusing it raises its name
  // over the roof and lets the rest of the street fall back. Three readings
  // hang in the sky on leaders to the roofs they count, and the quarters'
  // numbers stand on the pavement under them, for the fingerpost below.
  //
  // The street's box keeps the street's own proportions (aspect-ratio), so
  // every building, label and leader is placed in shares of it and nothing
  // is measured. Two fits are drawn (wide, and narrow for a phone, where
  // the buildings are slimmer rather than smaller); CSS shows one.
  import { range, shortName, type Street } from './place';
  import PpBuilding from './PpBuilding.svelte';

  let { s, owner }: { s: Street; owner: boolean } = $props();

  const pc = (n: number, of: number) => `${Math.round((n / of) * 10000) / 100}%`;
  const far = range('pp-far', 46, 26, 74);
  const near = range('pp-near', 30, 12, 44);
</script>

<div class="ps" data-fit={s.fit} style:aspect-ratio="{s.W} / {s.H}">
  <!-- The distance: two pale ranges of plain towers, full bleed behind the street. -->
  <svg class="ps-range" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path class="r-far" d={far.d} />
    <path class="r-mast" d={far.masts} />
    <path class="r-near" d={near.d} />
  </svg>
  <i class="ps-haze" aria-hidden="true"></i>

  <!-- Between the quarters: a tree and a street lamp. The New Town's plot, while it is empty. -->
  <svg class="ps-deco" viewBox="0 0 {s.W} {s.H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    {#each s.trees as x (x)}
      {@const r = s.fit === 'wide' ? 9 : 5}
      <path class="d-post" d="M{x + r * 1.6},{s.H} V{s.H - r * 4.2} h{r * 0.9}" />
      <circle class="d-lamp" cx={x + r * 2.5} cy={s.H - r * 4.05} r={r * 0.28} />
      <path class="d-trunk" d="M{x - r * 0.6},{s.H} V{s.H - r * 1.7}" />
      <circle class="d-tree" cx={x - r * 0.6} cy={s.H - r * 2.5} r={r} />
    {/each}
    {#if s.vacant}
      {@const v = s.vacant}
      {@const fh = s.fit === 'wide' ? 14 : 10}
      <rect class="d-lot" x={v.x} y={s.H - 3} width={v.w} height="3" />
      <rect class="d-hoard" x={v.x + v.w * 0.06} y={s.H - fh} width={v.w * 0.88} height={fh - 1} />
      <path class="d-peg" d="M{v.x + v.w * 0.5},{s.H - fh} V{s.H - fh * 2.6}" />
      <path class="d-flag" d="M{v.x + v.w * 0.5},{s.H - fh * 2.6} l{fh * 0.7},{fh * 0.25} l{-fh * 0.7},{fh * 0.25} Z" />
    {/if}
  </svg>

  <!-- The readings, pinned to the roofs they count. -->
  {#each s.callouts as c (c.id)}
    <p class="ps-co" data-id={c.id} data-tier={c.tier} data-hang={c.hang} style:--x={c.x} style:--y={c.y}>
      <span class="co-t">
        <span class="k">{c.kicker}</span>
        <span class="vu"><span class="v">{c.value}</span> <span class="u">{c.unit}</span></span>
        <span class="s">{c.sub}</span>
      </span>
    </p>
  {/each}

  {#each s.lots as l (l.entry.key)}
    {@const e = l.entry}
    {@const mid = (l.x + l.w / 2) / s.W}
    <a
      class="ps-b"
      href={e.href}
      rel={e.external ? 'noopener' : undefined}
      aria-label={e.label}
      data-hang={mid > 0.62 ? 'l' : 'r'}
      style:left={pc(l.x, s.W)}
      style:width={pc(l.w, s.W)}
      style:height={pc(l.h, s.H)}
      style:--roof={pc(l.h - l.roof, l.h)}
    >
      <PpBuilding f={l.facade} hidden={!e.isPublic} />
      <span class="ps-tag" aria-hidden="true">
        <span class="tk">No. {e.n} · {e.section === 'agent' ? 'Agent built' : e.kind}{owner && !e.isPublic ? ' · not public' : ''}</span>
        <span class="tt">{shortName(e.title)}</span>
      </span>
    </a>
  {/each}

  <!-- The quarters' numbers on the pavement, under the stretch of street each one takes. -->
  <div class="ps-spans" aria-hidden="true">
    {#each s.spans as q (q.id)}
      <span style:left={pc(q.x, s.W)} style:width={pc(q.w, s.W)}><i>{String(q.no).padStart(2, '0')}</i></span>
    {/each}
  </div>
</div>

<style>
  .ps {
    --ink: 26, 16, 8;
    position: relative;
    width: 100%;
  }
  .ps[data-fit='narrow'] {
    max-width: 480px;
    margin: 0 auto;
  }

  /* --------------------------------------------------------- the distance */

  .ps-range {
    position: absolute;
    bottom: 0;
    left: calc(50% - 50vw);
    width: 100vw;
    height: 46%;
    pointer-events: none;
  }
  .ps[data-fit='narrow'] .ps-range {
    height: 34%;
  }
  .r-far {
    fill: #d5e1eb;
  }
  .r-near {
    fill: #b9cadb;
  }
  .r-mast {
    fill: none;
    stroke: #c3d3e1;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  /* Distance is haze: the far towers' feet fade into the light along the street. */
  .ps-haze {
    position: absolute;
    bottom: 0;
    left: calc(50% - 50vw);
    width: 100vw;
    height: 22%;
    background: linear-gradient(to top, rgba(246, 250, 252, 0.6), rgba(246, 250, 252, 0));
    pointer-events: none;
  }
  .ps-deco {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .d-trunk,
  .d-post,
  .d-peg {
    fill: none;
    stroke: #2a3442;
    stroke-width: 1.2;
    vector-effect: non-scaling-stroke;
  }
  .d-tree {
    fill: #6d8f7a;
    stroke: rgba(var(--ink), 0.4);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .d-lamp {
    fill: #ffefcf;
    stroke: rgba(var(--ink), 0.5);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .d-lot {
    fill: #8a7a62;
  }
  .d-hoard {
    fill: rgba(239, 232, 218, 0.7);
    stroke: rgba(var(--ink), 0.55);
    stroke-width: 1;
    stroke-dasharray: 3 2;
    vector-effect: non-scaling-stroke;
  }
  .d-flag {
    fill: #6e2c06;
  }

  /* ---------------------------------------------------------- buildings */

  .ps-b {
    position: absolute;
    bottom: 0;
    z-index: 2;
    display: block;
    color: inherit;
    text-decoration: none;
    -webkit-tap-highlight-color: transparent;
  }
  .ps-b :global(.pb) {
    transition:
      opacity var(--t-base, 220ms) ease,
      transform var(--t-base, 220ms) ease;
  }
  /* Pointing at one building lets the rest of the street fall back. */
  .ps:has(.ps-b:hover, .ps-b:focus-visible) .ps-b:not(:hover, :focus-visible) :global(.pb) {
    opacity: 0.45;
  }
  .ps-b:hover :global(.pb),
  .ps-b:focus-visible :global(.pb) {
    transform: translateY(-3px);
  }
  .ps-b:hover,
  .ps-b:focus-visible {
    z-index: 5;
  }
  .ps-b:focus-visible {
    outline: 2px solid #6e2c06;
    outline-offset: 3px;
    border-radius: 2px;
  }
  /* Its name, raised over the roof on a leader. */
  .ps-tag {
    position: absolute;
    bottom: calc(100% - var(--roof) + 16px);
    left: 50%;
    display: block;
    width: max-content;
    max-width: 220px;
    padding: 6px 9px 7px;
    background: #f4f8fb;
    border: 1px solid rgba(var(--ink), 0.34);
    color: rgb(var(--ink));
    opacity: 0;
    transform: translateY(4px);
    pointer-events: none;
    transition:
      opacity var(--t-base, 220ms) ease,
      transform var(--t-base, 220ms) ease;
  }
  .ps-b[data-hang='l'] .ps-tag {
    left: auto;
    right: 50%;
    text-align: right;
  }
  .ps-tag::after {
    content: '';
    position: absolute;
    top: 100%;
    left: -1px;
    width: 1px;
    height: 16px;
    background: rgba(var(--ink), 0.5);
  }
  .ps-b[data-hang='l'] .ps-tag::after {
    left: auto;
    right: -1px;
  }
  .ps-b:hover .ps-tag,
  .ps-b:focus-visible .ps-tag {
    opacity: 1;
    transform: none;
  }
  .tk {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #6e2c06;
  }
  .tt {
    display: block;
    margin-top: 2px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: var(--fs-body-sm);
    line-height: 1.2;
    letter-spacing: -0.01em;
  }

  /* ----------------------------------------------------------- callouts */

  /* A reading sits on its anchor (the roof it counts); the leader runs up
     from that roof to its words, over the skyline at one of two heights. */
  .ps-co {
    --lift: 16px;
    position: absolute;
    z-index: 3;
    left: calc(var(--x) * 100%);
    bottom: calc(var(--y) * 100% + 2px);
    top: calc(-1 * var(--lift));
    width: 0;
    margin: 0;
    border-left: 1px solid rgba(var(--ink), 0.42);
    pointer-events: none;
  }
  .ps-co[data-tier='1'] {
    --lift: 70px;
  }
  .ps-co::after {
    content: '';
    position: absolute;
    left: -3px;
    bottom: -3px;
    width: 5px;
    height: 5px;
    border-radius: 100px;
    background: rgb(var(--ink));
  }
  .co-t {
    position: absolute;
    bottom: 100%;
    left: -1px;
    display: block;
    padding: 0 0 4px 9px;
    border-left: 1px solid rgba(var(--ink), 0.42);
    white-space: nowrap;
    color: rgb(var(--ink));
  }
  .ps-co[data-hang='l'] .co-t {
    left: auto;
    right: 0;
    padding: 0 9px 4px 0;
    border-left: 0;
    border-right: 1px solid rgba(var(--ink), 0.42);
    text-align: right;
  }
  .k {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #6e2c06;
  }
  .ps-co[data-id='agent'] .k {
    color: #164651;
  }
  .vu {
    display: block;
    line-height: 1.15;
  }
  .v {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 24px;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .u {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(var(--ink), 0.78);
  }
  .s {
    display: block;
    margin-top: 1px;
    font-size: var(--fs-label);
    line-height: 1.3;
    color: rgba(var(--ink), 0.76);
  }

  /* --------------------------------------------------- the quarters' spans */

  .ps-spans {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    height: 30px;
  }
  .ps-spans span {
    position: absolute;
    top: 9px;
    height: 6px;
    border: 1px solid rgba(237, 228, 212, 0.42);
    border-bottom: 0;
    box-sizing: border-box;
  }
  .ps-spans i {
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    font-style: normal;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    line-height: 1;
    color: rgba(237, 228, 212, 0.78);
  }

  @media (max-width: 639px) {
    .v {
      font-size: 20px;
    }
    .ps-co[data-tier='1'] {
      --lift: 72px;
    }
    /* A phone keeps each reading to its figure, so two can stand one over the other. */
    .s {
      display: none;
    }
    .ps-tag {
      max-width: 180px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ps-b :global(.pb),
    .ps-tag {
      transition: none;
    }
    .ps-b:hover :global(.pb),
    .ps-b:focus-visible :global(.pb) {
      transform: none;
    }
  }
</style>
