<svelte:options css="injected" />

<script lang="ts">
  // The ring round the pulse (HeroNotes), in three takes. One shows at a
  // time; while the pen keeps time the stylesheet swaps to the next on each R
  // wave as the nib crosses it ("the boil"), opacity alone, stepped, so the
  // compositor does it and nothing redraws. In pencil when there is no rate.
  import { inkRing, rng } from '$lib/landing/notes-ink';

  let { boil, blank }: { boil: boolean; blank: boolean } = $props();

  const RINGS = [31, 47, 59].map((s) => inkRing(rng(s), 58, 47, 52, 40));
</script>

<svg class="ir" class:boil class:blank viewBox="0 0 116 94" aria-hidden="true" focusable="false">
  {#each RINGS as d, i (i)}<path {d} data-beat style:--i={i} />{/each}
</svg>

<style>
  .ir {
    flex: none;
    width: 116px;
    height: 94px;
    overflow: visible;
  }
  .ir path {
    fill: none;
    stroke: var(--accent-on-dark);
    stroke-width: 2.2;
    stroke-linecap: round;
    opacity: 0;
  }
  .ir path:first-child {
    opacity: 1;
  }
  .blank path {
    stroke: var(--on-ink-45);
  }
  .boil path {
    will-change: opacity;
    animation: ir-boil calc(var(--beat) * 3) steps(1, end) calc(var(--beat) * (var(--peak) + var(--i))) infinite;
  }
  .boil path:first-child {
    animation-delay: calc(var(--beat) * var(--peak));
  }
  @keyframes ir-boil {
    0% {
      opacity: 1;
    }
    33.333%,
    100% {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .boil path {
      animation: none;
    }
  }
</style>
