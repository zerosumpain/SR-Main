<script lang="ts">
  // A coloured-pencil dot: a filled spot with a looser ring round it, the way
  // a pencil marks a list. The pencil is chosen from the word it marks, so a
  // tag wears the same colour on every page. Decoration only (aria-hidden):
  // the word beside it carries the meaning, never the colour.
  import { inkRing, rng } from '$lib/landing/notes-ink';
  import { PENCILS, pencilFor, seedFor } from './paper';

  let { word, size = 12 }: { word: string; size?: number } = $props();

  let colour = $derived(PENCILS[pencilFor(word)]);
  let ring = $derived(inkRing(rng(seedFor(word)), 7, 7, 5.6, 5.2, 1.15, 0.08));
</script>

<svg class="np-dot" viewBox="0 0 14 14" width={size} height={size} style:--pencil={colour} aria-hidden="true" focusable="false">
  <circle cx="7" cy="7" r="3.6" />
  <path d={ring} />
</svg>

<style>
  .np-dot {
    display: inline-block;
    flex: none;
    vertical-align: -0.05em;
    overflow: visible;
  }
  circle {
    fill: var(--pencil);
    opacity: 0.85;
  }
  path {
    fill: none;
    stroke: var(--pencil);
    stroke-width: 1.2;
    stroke-linecap: round;
  }
  @media print {
    .np-dot {
      display: none;
    }
  }
</style>
