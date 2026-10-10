<script lang="ts">
  // A date, rubber-stamped onto the paper: Inter 800 in a hand-inked box,
  // turned a few degrees, with an optional mono line under it. The paper twin
  // of the landing hero's stamp (which is set on the ink cover). Text in the
  // darker orange, so it clears 4.5:1 on the cream.
  //
  //   <DateStamp date="28 Sept 2026" sub="eleven minute read" datetime="2026-09-28" />
  import { inkLine, rng } from '$lib/landing/notes-ink';

  let {
    date,
    sub = null,
    datetime = null,
    tilt = -4,
    seed = 43,
  }: {
    /** The date as it should read. */
    date: string;
    /** A small mono line under the date. */
    sub?: string | null;
    /** Machine-readable date; renders a <time> when given. */
    datetime?: string | null;
    /** Degrees; 0 for a straight stamp. */
    tilt?: number;
    seed?: number;
  } = $props();

  // svelte-ignore state_referenced_locally
  const box = [
    inkLine(rng(seed), 2, 2, 98, 2.5, 0.3, 0.004),
    inkLine(rng(seed + 1), 98, 2, 97.5, 38, 0.3, 0.01),
    inkLine(rng(seed + 2), 98, 38, 2, 37.5, 0.3, 0.004),
    inkLine(rng(seed + 3), 2, 38, 2.5, 2, 0.3, 0.01),
  ].join(' ');
</script>

<span class="np-stamp" style:--np-stamp-tilt="{tilt}deg">
  <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d={box} /></svg>
  {#if datetime}<time class="np-stamp-d" {datetime}>{date}</time>{:else}<span class="np-stamp-d">{date}</span>{/if}
  {#if sub}<span class="np-stamp-s">{sub}</span>{/if}
</span>

<style>
  .np-stamp {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 7px 14px 8px;
    transform: rotate(var(--np-stamp-tilt));
    font-family: var(--font-mono);
    text-transform: uppercase;
    color: var(--accent-hover);
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  path {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    opacity: 0.75;
    vector-effect: non-scaling-stroke;
  }
  .np-stamp-d {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 19px;
    line-height: 1.1;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .np-stamp-s {
    font-size: var(--fs-label-xs);
    line-height: 1.3;
    letter-spacing: 0.16em;
    white-space: nowrap;
  }
  :global(html[data-reading-theme='night']) .np-stamp {
    color: var(--accent);
  }
  @media (max-width: 760px) {
    .np-stamp {
      padding: 5px 10px 6px;
    }
    .np-stamp-d {
      font-size: 16px;
    }
  }
  @media print {
    .np-stamp {
      transform: none;
      color: #1a1008;
    }
    svg {
      display: none;
    }
  }
</style>
