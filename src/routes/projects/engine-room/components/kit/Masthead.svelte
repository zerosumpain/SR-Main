<script lang="ts">
  // Masthead — /health's SectionHead, in this study's voice. A mono kicker, a display
  // headline given as an array of lines (so the break is designed, not left to the window),
  // and one standfirst pushed to the right edge.
  //
  // A line wrapped in *asterisks* is set in the part's colour, for the one word that carries
  // the headline.
  import type { Snippet } from 'svelte';
  import { reveal } from '../../lib/motion';

  interface Props {
    kicker?: string;
    lines: string[];
    /** One sentence or two. Sits at the right edge on wide screens, under on narrow. */
    strap?: string;
    size?: 'hero' | 'xl' | 'lg' | 'md';
    /** h1 for the page's title, h2 for a section. */
    level?: 1 | 2;
    aside?: Snippet;
  }
  let { kicker, lines, strap, size = 'lg', level = 2, aside }: Props = $props();

  const parts = (l: string) => l.split(/(\*[^*]+\*)/g).filter(Boolean).map((s) => (s.startsWith('*') ? { hl: true, t: s.slice(1, -1) } : { hl: false, t: s }));
</script>

<header class="mh size-{size}">
  <div class="mh-main">
    {#if kicker}<span class="er-kicker" {@attach reveal({ y: 10, duration: 0.6 })}>{kicker}</span>{/if}
    <svelte:element this={level === 1 ? 'h1' : 'h2'} class="er-display mh-title">
      {#each lines as l, i}
        <span class="ln"><span class="ln-in" {@attach reveal({ y: 60, delay: 0.06 * i, duration: 1 })}>{#each parts(l) as p}{#if p.hl}<span class="hl">{p.t}</span>{:else}{p.t}{/if}{/each}</span></span>
      {/each}
    </svelte:element>
  </div>
  {#if strap || aside}
    <div class="mh-side" {@attach reveal({ y: 16, delay: 0.2 })}>
      {#if strap}<p class="mh-strap">{strap}</p>{/if}
      {#if aside}{@render aside()}{/if}
    </div>
  {/if}
</header>

<style>
  .mh { display: flex; align-items: flex-end; justify-content: space-between; gap: 22px 44px; flex-wrap: wrap; margin: 0 0 clamp(28px, 3.5vw, 48px); }
  .mh-main { min-width: 0; flex: 1 1 520px; }
  .mh-title { display: flex; flex-direction: column; }
  .ln { display: block; overflow: hidden; padding-bottom: 0.04em; }
  .ln-in { display: inline-block; }
  .size-hero .mh-title { font-size: clamp(48px, 9.2vw, 148px); }
  .size-xl .mh-title { font-size: clamp(42px, 7vw, 104px); }
  .size-lg .mh-title { font-size: clamp(32px, 4.6vw, 64px); }
  .size-md .mh-title { font-size: clamp(26px, 3.2vw, 42px); }
  .mh-side { flex: 0 1 42ch; min-width: 0; }
  .mh-strap { margin: 0; font-size: clamp(16px, 1.35vw, 19px); line-height: 1.55; color: var(--fg-2); }
  .size-md .mh-strap { font-size: var(--fs-body-sm); }
  @media (max-width: 760px) { .mh-side { flex-basis: 100%; } }
</style>
