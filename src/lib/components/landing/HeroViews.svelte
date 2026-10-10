<script module lang="ts">
  import type { Component, ComponentProps } from 'svelte';
  import type HeroSentence from './HeroSentence.svelte';

  /** The props every view takes, identically. */
  export type HeroProps = ComponentProps<typeof HeroSentence>;
  export type HeroViewComponent = Component<HeroProps>;
</script>

<script lang="ts">
  // One hero, three ways to read it: the same live numbers told as a
  // sentence, drawn as a place, or kept as notes. This component is the
  // switch: a quiet "read it as" control in the hero's top corner. The choice
  // itself (the view on screen, the cookie that remembers it, loading each
  // view's chunks and the swap) lives in the page's PageView
  // (./page-view.svelte), so the showcase below the hero follows it too. Each
  // view renders its own masthead (HeroTitle) and takes the identical props,
  // passed straight through.
  //
  // The server picks the first view ($lib/landing/hero-view: a ?view= link,
  // then the visitor's cookie, then the notes), so the page arrives already
  // showing it and nothing flashes. A click swaps the hero and the showcase
  // in place, crossfading the two of them for 180ms where the browser can
  // (View Transitions), and not at all under prefers-reduced-motion.
  //
  // The rambler's floors follow on their own: the outgoing view's
  // `use:scenery` elements unregister as it unmounts, the incoming one's
  // register as it mounts, and each change tells the rambler to measure again.
  import { scenery } from '$lib/landing/ramblers/scenery';
  import { HERO_VIEWS } from '$lib/landing/hero-view';
  import type { PageView } from './page-view.svelte';

  let {
    page,
    ...hero
  }: {
    /** The page's live view choice, shared with the showcase below. */
    page: PageView;
  } & HeroProps = $props();

  let View = $derived(page.hero);

  // Read only through the switch's aria-describedby.
  let how = $derived(
    page.source === 'cookie'
      ? `Kept as you chose it. Choose ${page.choice.auto} to go back to the default.`
      : page.source === 'query'
        ? 'Set by the link you followed, for this visit only.'
        : 'The notes are the default. Choose another to keep it.',
  );
</script>

<div class="hv">
  <div class="hv-bar">
    <div
      class="hv-switch"
      role="group"
      aria-label="Read the live numbers as"
      aria-describedby="hv-how"
      onpointerenter={page.warm}
      onfocusin={page.warm}
      ontouchstart={page.warm}
    >
      <span class="hv-k" aria-hidden="true">read it as:</span>
      {#each HERO_VIEWS as k, i (k)}
        {#if i}<span class="hv-dot" aria-hidden="true">·</span>{/if}
        <button type="button" class="hv-b" aria-pressed={page.view === k} onclick={() => page.pick(k)}>{k}</button>
      {/each}
    </div>
    <span id="hv-how" hidden>{how}</span>
  </div>

  <View {...hero} />
  <!-- A zero-size, hidden scenery mark: it is never a floor (the rambler skips
       anything with no width), but updating it after a swap asks him to
       measure the page again once the incoming view has settled its layout. -->
  <span class="hv-settle" hidden use:scenery={{ at: page.settle }}></span>
</div>

<style>
  .hv {
    --gut: clamp(16px, 4vw, 64px);
    position: relative;
  }

  /* The switch hangs in the hero's top corner, inside the page's 1312px
     measure, in the band of ink above the title's first line. It takes no
     room of its own on a desktop, so every view keeps its height. */
  .hv-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    /* Over the view, under the rambler's canvas (20). */
    z-index: 1;
    display: flex;
    justify-content: flex-end;
    max-width: 1312px;
    margin: 0 auto;
    padding: 6px var(--gut) 0;
    box-sizing: border-box;
    pointer-events: none;
  }
  .hv-switch {
    display: flex;
    align-items: baseline;
    gap: 0 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    pointer-events: auto;
  }
  .hv-k {
    margin-right: 6px;
    color: var(--on-ink-55);
  }
  .hv-dot {
    padding: 0 4px;
    color: var(--on-ink-55);
  }
  .hv-b {
    position: relative;
    min-width: 44px;
    margin: 0;
    padding: 2px 0;
    border: 0;
    background: none;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: var(--on-ink-80);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  /* A finger-sized target without spacing the words apart. */
  .hv-b::after {
    content: '';
    position: absolute;
    inset: -10px -4px;
  }
  .hv-b:hover {
    color: var(--bg);
  }
  /* Pressed reads by colour and by its underline, never by colour alone. */
  .hv-b[aria-pressed='true'] {
    color: var(--accent-on-dark);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 4px;
  }
  .hv-b:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 4px;
    border-radius: 2px;
  }

  /* A phone has no spare ink above the title: the switch takes its own short
     row, right-aligned, with full-height targets, and lets the view's top
     padding tuck under it. */
  @media (max-width: 760px) {
    .hv-bar {
      position: relative;
      padding-top: 0;
      margin-bottom: -10px;
    }
    .hv-b {
      min-height: 44px;
    }
    .hv-b::after {
      inset: 0 -4px;
    }
  }

  @media print {
    .hv-bar {
      display: none;
    }
  }

  /* Named only while a swap runs, so the hero is never its own stacking
     context otherwise. */
  :global(html.hero-swapping) .hv {
    view-transition-name: hero-view;
  }

  /* The swap: only the hero and the showcase (ShowcaseViews) crossfade. The
     rest of the page settles at once
     rather than fading through itself, and the rambler stays live and on top
     instead of being frozen into the page's snapshot under the hero. */
  :global(html.hero-swapping::view-transition-old(root)),
  :global(html.hero-swapping::view-transition-new(root)) {
    animation: none;
  }
  :global(html.hero-swapping canvas.rambler) {
    view-transition-name: hero-rambler;
  }
  :global(html.hero-swapping::view-transition-old(hero-rambler)) {
    display: none;
  }
  :global(html.hero-swapping::view-transition-new(hero-rambler)) {
    animation: none;
  }
  /* Every view sets the same masthead, a few pixels apart at most: the name
     and its subtitle slide to their new places as one piece each instead of
     fading through a double. */
  :global(html.hero-swapping .ht-title) {
    view-transition-name: hero-title;
  }
  :global(html.hero-swapping .ht-lede) {
    view-transition-name: hero-lede;
  }
  :global(html.hero-swapping::view-transition-group(hero-title)),
  :global(html.hero-swapping::view-transition-group(hero-lede)),
  :global(html.hero-swapping::view-transition-group(hero-view)),
  :global(html.hero-swapping::view-transition-old(hero-view)),
  :global(html.hero-swapping::view-transition-new(hero-view)) {
    animation-duration: 180ms;
    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }
</style>
