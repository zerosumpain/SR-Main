<svelte:options css="injected" />

<script lang="ts">
  // Today's steps pencilled onto a ruler of the day: midnight at the left
  // end, 23:59 at the right, a stroke per quarter-hour that had steps, and the
  // rest of the day hatched out as still to come. It marks time of day only;
  // nothing is drawn after now.
  //
  // The ruler is the rambler's lookout in this view: an unrotated, unmoving
  // box with a flat top edge, so he can sit on it with his legs over the
  // part of the day that has not happened yet (at 0.88, above the hatch).
  // The mark is the whole block, ruler first, so its top is the ruler's top
  // and its sides reach as far down as the view lets it stretch.
  import { inkRuler, rulerHours } from '$lib/landing/notes-ink';
  import { scenery } from '$lib/landing/ramblers/scenery';

  let {
    bins,
    nowBin,
    summary,
  }: {
    /** Steps per quarter-hour, or null when none have arrived today. */
    bins: number[] | null;
    nowBin: number;
    /** The ruler in words, for a screen reader (stepsSummary in rhythm.ts). */
    summary: string;
  } = $props();

  let w = $state(460);
  let h = $state(60);
  let r = $derived(inkRuler(w, h, bins, nowBin));
  let hours = $derived(rulerHours(r.x0, r.x1, r.now));
  // The hatch is lettered only when the words fit inside it.
  let lettered = $derived(r.x1 - r.now >= 150);
</script>

<div class="dr" use:scenery={{ spot: 'lookout', at: 0.88 }}>
  <span class="vh">{summary}</span>
  <div class="dr-box" bind:clientWidth={w} bind:clientHeight={h} aria-hidden="true">
    <svg viewBox="0 0 {w} {h}" preserveAspectRatio="none" focusable="false">
      <path class="hatch" d={r.hatch} />
      <path class="ticks" d={r.ticks} />
      <path class="quiet" d={r.quiet} />
      <path class="busy" d={r.busy} />
      <path class="frame" d={r.frame} />
      <path class="nowline" d="M{r.now},{h - 4} L{r.now},{h + 7}" />
    </svg>
    {#if lettered}<span class="pend" style:left="{r.now + 10}px">the rest is pending</span>{/if}
  </div>
  <div class="dr-hours" aria-hidden="true">
    {#each hours as l (l.h)}<span style:left="{l.x}px" class:first={l.h === 0} class:last={l.h === 24}
        >{String(l.h).padStart(2, '0')}</span
      >{/each}
    <!-- Kept inside the ruler's ends, so a late or early now never runs off the page. -->
    <span
      class="now"
      style:left="{r.now}px"
      style:transform={r.now > r.x1 - 34 ? 'translateX(-100%)' : r.now < r.x0 + 34 ? 'none' : undefined}>now-ish</span
    >
  </div>
</div>

<style>
  .dr {
    position: relative;
  }
  .vh {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .dr-box {
    position: relative;
    height: 60px;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .frame {
    stroke: var(--on-ink-80);
    stroke-width: 1.6;
  }
  .ticks {
    stroke: var(--on-ink-45);
    stroke-width: 1;
  }
  .quiet {
    stroke: var(--on-ink-70);
    stroke-width: 2;
  }
  .busy {
    stroke: var(--accent-on-dark);
    stroke-width: 2.5;
  }
  .hatch {
    stroke: var(--on-ink-16);
    stroke-width: 1;
  }
  .nowline {
    stroke: var(--on-ink-80);
    stroke-width: 1.4;
  }
  /* Lettered into the hatch on a dab of ink, so the strokes never cross it. */
  .pend {
    position: absolute;
    bottom: 9px;
    padding: 0 6px;
    background: var(--text-primary);
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 15px;
    line-height: 1.3;
    color: var(--on-ink-70);
    white-space: nowrap;
  }
  .dr-hours {
    position: relative;
    height: 20px;
    margin-top: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    letter-spacing: 0.06em;
    color: var(--on-ink-55);
  }
  .dr-hours span {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    white-space: nowrap;
  }
  .dr-hours .first {
    transform: none;
  }
  .dr-hours .last {
    transform: translateX(-100%);
  }
  .dr-hours .now {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 15px;
    line-height: 1.2;
    letter-spacing: 0;
    color: var(--bg);
  }
  @media (max-width: 760px) {
    .dr-box {
      height: 56px;
    }
  }
  @media print {
    .frame,
    .quiet,
    .busy,
    .nowline {
      stroke: #1a1008;
    }
    .ticks,
    .hatch {
      stroke: rgba(26, 16, 8, 0.4);
    }
    .pend {
      background: #fff;
    }
    .pend,
    .dr-hours,
    .dr-hours .now {
      color: #1a1008;
    }
  }
</style>
