<svelte:options css="injected" />

<script lang="ts">
  // A coloured-pencil dot for a family of project: a filled spot with a looser
  // ring round it, the way a pencil marks a list (the notes-paper kit's
  // PencilDot, coloured by family rather than by word). Decoration only: the
  // family's word is always written beside it.
  import { inkRing, rng } from '$lib/landing/notes-ink';
  import { FAMILY_PENCIL, hashKey } from '$lib/projects/notes';
  import type { ProjectFamily } from '$lib/projects/views';

  let { family, on = 'paper', seed = 1 }: { family: ProjectFamily; on?: 'paper' | 'ink'; seed?: number } = $props();

  let colour = $derived(FAMILY_PENCIL[family][on]);
  let ring = $derived(inkRing(rng(hashKey(family) + seed), 7, 7, 5.6, 5.2, 1.15, 0.08));
</script>

<svg class="pn-dot" viewBox="0 0 14 14" width="12" height="12" style:--pencil={colour} aria-hidden="true" focusable="false">
  <circle cx="7" cy="7" r="3.6" />
  <path d={ring} />
</svg>

<style>
  .pn-dot {
    display: inline-block;
    flex: none;
    overflow: visible;
  }
  circle {
    fill: var(--pencil);
    opacity: 0.9;
  }
  path {
    fill: none;
    stroke: var(--pencil);
    stroke-width: 1.2;
    stroke-linecap: round;
  }
  @media print {
    .pn-dot {
      display: none;
    }
  }
</style>
