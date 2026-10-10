<script lang="ts">
  // The showcase slot: the chapters below the hero (Daydream, the health
  // record, the app, how it ships itself, and the rest), told in whichever
  // view the hero is reading in. The page's PageView holds the chosen view's
  // showcase component, already loaded; a pick swaps it in the same View
  // Transition as the hero, so the two crossfade together.
  import type { ShowcaseProps } from '$lib/landing/showcase';
  import type { PageView } from './page-view.svelte';

  let { page, ...props }: { page: PageView } & ShowcaseProps = $props();

  let Showcase = $derived(page.showcase);
</script>

<div class="sv" data-view={page.view}>
  <Showcase {...props} />
</div>

<style>
  .sv {
    display: block;
  }
  /* Named only while a swap runs (PageView adds the class), so the showcase
     is never its own stacking context otherwise. */
  :global(html.hero-swapping) .sv {
    view-transition-name: showcase-view;
  }
  :global(html.hero-swapping::view-transition-group(showcase-view)),
  :global(html.hero-swapping::view-transition-old(showcase-view)),
  :global(html.hero-swapping::view-transition-new(showcase-view)) {
    animation-duration: 180ms;
    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    :global(html.hero-swapping::view-transition-group(showcase-view)),
    :global(html.hero-swapping::view-transition-old(showcase-view)),
    :global(html.hero-swapping::view-transition-new(showcase-view)) {
      animation: none;
    }
  }
</style>
