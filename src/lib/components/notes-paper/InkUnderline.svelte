<script lang="ts">
  // Something underlined twice in pen, as a total is: two hand-drawn strokes
  // just under the letters' feet. Static, aria-hidden, gone in print.
  import type { Snippet } from 'svelte';
  import { inkLine, rng } from '$lib/landing/notes-ink';

  let {
    seed = 5,
    tone = 'accent',
    children,
  }: { seed?: number; tone?: 'accent' | 'ink'; children: Snippet } = $props();

  // svelte-ignore state_referenced_locally
  const d = [inkLine(rng(seed), 1, 3, 99, 4.6, 0.4, 0.012), inkLine(rng(seed + 1), 6, 9, 95, 10, 0.4, 0.012)].join(' ');
</script>

<span class="np-under" data-tone={tone}>
  {@render children()}<svg viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path {d} /></svg>
</span>

<style>
  .np-under {
    --tone: var(--accent);
    position: relative;
    display: inline-block;
  }
  .np-under[data-tone='ink'] {
    --tone: var(--accent-ink);
  }
  svg {
    position: absolute;
    left: -2px;
    top: calc(50% + 0.42em);
    width: calc(100% + 4px);
    height: 12px;
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
