<script lang="ts">
  // A ring drawn round something in pen: a figure, a word, a count. The
  // landing's notes ring (notes-ink's inkRing), static: the wobble is baked
  // into the path, nothing redraws and nothing moves. Sized from the thing it
  // circles, with room either side so it never cuts a letter.
  //
  //   <InkRing seed={seedFor(slug)}>11</InkRing>
  //
  // Decoration only: the ring is aria-hidden and the content reads as itself.
  import type { Snippet } from 'svelte';
  import { inkRing, rng } from '$lib/landing/notes-ink';

  let {
    seed = 31,
    tone = 'accent',
    pad = 0.45,
    children,
  }: {
    seed?: number;
    /** Orange for what matters, petrol for structure. */
    tone?: 'accent' | 'ink';
    /** Room either side of the content, in em. */
    pad?: number;
    children: Snippet;
  } = $props();

  // svelte-ignore state_referenced_locally
  const d = inkRing(rng(seed), 60, 40, 56, 35, 1.12, 0.04);
</script>

<span class="np-ring" data-tone={tone} style:--np-ring-pad="{pad}em">
  {@render children()}<svg viewBox="0 0 120 80" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path {d} /></svg>
</span>

<style>
  .np-ring {
    --tone: var(--accent);
    position: relative;
    display: inline-block;
    margin: 0 var(--np-ring-pad);
  }
  .np-ring[data-tone='ink'] {
    --tone: var(--accent-ink);
  }
  svg {
    position: absolute;
    left: calc(-1 * var(--np-ring-pad));
    top: calc(50% - 0.8em);
    width: calc(100% + 2 * var(--np-ring-pad));
    height: 1.6em;
    overflow: visible;
    pointer-events: none;
  }
  path {
    fill: none;
    stroke: var(--tone);
    stroke-width: 2;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  @media print {
    svg {
      display: none;
    }
  }
</style>
