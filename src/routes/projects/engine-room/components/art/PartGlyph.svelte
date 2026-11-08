<script lang="ts">
  // PartGlyph — each part's emblem, drawn rather than picked from an icon set, so the three
  // read as one family: Daydream a moon over a clock face, Build a gear with a bracket for
  // code, the App a phone beside a watch. Lines draw themselves the first time they're seen.
  import type { PartId } from '../../lib/nav';
  import { shown } from '../../lib/motion';
  let { part }: { part: PartId } = $props();
</script>

<svg viewBox="0 0 120 120" aria-hidden="true" data-part={part} {@attach shown()}>
  <circle class="bg" cx="60" cy="60" r="56" />
  {#if part === 'daydream'}
    <circle class="ln" cx="60" cy="64" r="34" pathLength="1" data-draw />
    <path class="ln" d="M60 64 V40 M60 64 L76 72" pathLength="1" data-draw style="--d:0.4s" />
    <path class="fill" d="M86 18 A16 16 0 1 0 100 40 A12 12 0 1 1 86 18Z" data-pop style="--d:0.8s" />
    <circle class="fill" cx="30" cy="26" r="3" data-pop style="--d:1s" /><circle class="fill" cx="20" cy="44" r="2" data-pop style="--d:1.1s" />
  {:else if part === 'build'}
    <path class="ln" d="M60 22 l6 8 10-3 2 10 10 3-3 10 8 6-8 6 3 10-10 3-2 10-10-3-6 8-6-8-10 3-2-10-10-3 3-10-8-6 8-6-3-10 10-3 2-10 10 3Z" pathLength="1" data-draw />
    <path class="ln thick" d="M50 52 L42 60 L50 68 M70 52 L78 60 L70 68 M63 48 L57 72" pathLength="1" data-draw style="--d:0.6s" />
  {:else}
    <rect class="ln" x="28" y="22" width="40" height="76" rx="8" pathLength="1" data-draw />
    <path class="ln" d="M42 30 H54" pathLength="1" data-draw style="--d:0.5s" />
    <rect class="ln" x="76" y="50" width="26" height="32" rx="7" pathLength="1" data-draw style="--d:0.4s" />
    <path class="ln" d="M82 50 V40 H96 V50 M82 82 V92 H96 V82" pathLength="1" data-draw style="--d:0.7s" />
    <rect class="fill" x="34" y="44" width="28" height="14" rx="2" data-pop style="--d:1s" />
  {/if}
</svg>

<style>
  svg { width: 100%; height: 100%; display: block; overflow: visible; }
  .bg { fill: var(--tone); opacity: 0.14; }
  .ln { fill: none; stroke: var(--fg); stroke-width: 4; stroke-linejoin: round; stroke-linecap: square; }
  .ln.thick { stroke: var(--tone-text); stroke-width: 5; }
  .fill { fill: var(--tone); }
</style>
