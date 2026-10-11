<svelte:options css="injected" />

<script lang="ts">
  // The rule under the masthead: the home page's heartbeat line, except that
  // here it beats once per project on the bench, in reading order, orange for
  // the ones made by hand and blue-green for the agent's (the sentence below
  // says the same in words, so the colour is never the only signal). It draws
  // itself in once, left to right, and then keeps still; reduced motion and
  // print skip the flourish. Decoration: aria-hidden.
  import { benchLine } from '$lib/projects/sentence';
  import type { ProjectEntry } from '$lib/projects/views';

  let { sections }: { sections: ProjectEntry['section'][] } = $props();

  const H = 56;
  let line = $derived(benchLine(sections, H));
</script>

<div class="sp-ln" aria-hidden="true">
  <svg viewBox="0 0 1000 {H}" preserveAspectRatio="none" focusable="false">
    <path class="sp-base" d={line.base} />
    {#each line.beats as b, i (i)}
      <path class="sp-beat" data-section={b.section} d={b.d} />
    {/each}
  </svg>
</div>

<style>
  .sp-ln {
    height: 56px;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  path {
    fill: none;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .sp-base {
    stroke: var(--accent-on-dark);
    stroke-width: 1;
    opacity: 0.42;
  }
  .sp-beat {
    stroke: var(--accent-on-dark);
    stroke-width: 1.5;
  }
  .sp-beat[data-section='agent'] {
    stroke: var(--accent-ink-on-dark);
  }
  /* Drawn once, left to right, as a pen would, and then still. A wipe rather
     than a dash run: dashes and non-scaling strokes disagree in Chromium. */
  @media (prefers-reduced-motion: no-preference) {
    svg {
      animation: sp-draw 1400ms cubic-bezier(0.35, 0, 0.25, 1) 120ms both;
    }
  }
  @keyframes sp-draw {
    from {
      clip-path: inset(-20% 100% -20% 0);
    }
    to {
      clip-path: inset(-20% 0 -20% 0);
    }
  }
  @media (max-width: 760px) {
    .sp-ln {
      height: 44px;
    }
  }
  @media print {
    .sp-ln {
      display: none;
    }
  }
</style>
