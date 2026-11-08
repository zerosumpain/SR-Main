<svelte:options css="injected" />

<script lang="ts">
  // The date, stamped in the empty corner beside "JK's" (HeroNotes), with the
  // town and the temperature under it once the feed has said. Rubber-stamp
  // ink: rotated a few degrees, so it is never scenery for the rambler.
  import { inkLine, rng } from '$lib/landing/notes-ink';

  let { date, place }: { date: string; place: string | null } = $props();

  const STAMP = [
    inkLine(rng(43), 2, 2, 98, 2.5, 0.3, 0.004),
    inkLine(rng(44), 98, 2, 97.5, 38, 0.3, 0.01),
    inkLine(rng(45), 98, 38, 2, 37.5, 0.3, 0.004),
    inkLine(rng(46), 2, 38, 2.5, 2, 0.3, 0.01),
  ].join(' ');
</script>

<p class="hn-stamp ink">
  <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d={STAMP} /></svg>
  <span class="hn-stamp-d">{date}</span>{#if place}<span class="vh">, </span><span class="hn-stamp-p">{place}</span>{/if}
</p>

<style>
  .vh {
    position: absolute !important;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  .hn-stamp {
    position: absolute;
    top: 2px;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    margin: 0;
    padding: 7px 14px 8px;
    transform: rotate(-4deg);
    font-family: var(--font-mono);
    text-transform: uppercase;
    color: var(--accent-on-dark);
    pointer-events: none;
  }
  .hn-stamp svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .hn-stamp path {
    fill: none;
    stroke: var(--accent-on-dark);
    stroke-width: 1.5;
    opacity: 0.7;
    vector-effect: non-scaling-stroke;
  }
  .hn-stamp-d {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 19px;
    line-height: 1.1;
    letter-spacing: 0.02em;
  }
  .hn-stamp-p {
    font-size: var(--fs-label-xs);
    line-height: 1.3;
    letter-spacing: 0.16em;
  }
  /* Typed up, the scribbles go (HeroNotes' fair copy). */
  :global(.hn[data-fair]) .hn-stamp {
    visibility: hidden;
  }
  @media (max-width: 760px) {
    :global(.hn[data-fair]) .hn-stamp {
      display: none;
    }
    .hn-stamp {
      top: 0;
      padding: 5px 10px 6px;
    }
    .hn-stamp-d {
      font-size: 16px;
    }
  }
  @media print {
    .hn-stamp {
      display: none;
    }
  }
</style>
