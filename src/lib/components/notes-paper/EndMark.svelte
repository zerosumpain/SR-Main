<script lang="ts">
  // The end of a piece: a small ringed full stop in the orange pen, centred
  // on its own rule. Decorative; the page says "the end" in its own words
  // where that matters.
  import { inkRing, rng } from '$lib/landing/notes-ink';

  let { seed = 71 }: { seed?: number } = $props();
  // svelte-ignore state_referenced_locally
  const ring = inkRing(rng(seed), 14, 14, 9, 8.5, 1.18, 0.06);
</script>

<svg class="np-end" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
  <circle cx="14" cy="14" r="3" />
  <path d={ring} />
</svg>

<style>
  circle {
    fill: currentColor;
  }
  path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }
  @media print {
    .np-end {
      color: #1a1008;
    }
  }
</style>
