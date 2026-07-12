<script lang="ts">
  // Print layout — the deck as a stack of fixed 1280×720 pages, one per slide,
  // in reading order. Consumed by the PDF export's headless browser
  // (page.pdf + a first-slide screenshot for the OG poster) and printable by
  // the owner directly. Everything renders still: no entrances, no background
  // sims, all build steps revealed.
  import { onMount } from 'svelte';
  import SlideView from '$lib/components/presentation/SlideView.svelte';

  let { data } = $props();

  let ready = $state(false);

  onMount(() => {
    // Fonts first, then a settle beat for chart draw-ins and count-ups — the
    // export waits for [data-print-ready] before rendering.
    void document.fonts.ready.then(() => {
      setTimeout(() => (ready = true), 400);
    });
  });
</script>

<svelte:head>
  <title>{data.deck.title} — print</title>
  <meta name="robots" content="noindex" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,500&family=DM+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500;600&display=swap"
  />
</svelte:head>

<div class="print-root" data-theme={data.deck.theme} data-print-ready={ready ? '1' : undefined}>
  {#each data.slides as slide (slide.id)}
    <div class="pslide">
      <SlideView {slide} still />
    </div>
  {/each}
</div>

<style>
  /* Same token aliasing as DeckShell, minus the fixed-viewport shell — this
     document scrolls and paginates. */
  .print-root {
    --paper: var(--bg);
    --paper-deep: var(--surface-elevated);
    --ink: var(--text-primary);
    --ink-soft: var(--text-muted);
    color: var(--ink);
    font-family: 'DM Sans', system-ui, sans-serif;
    background: var(--paper);
  }
  .pslide {
    position: relative;
    width: 1280px;
    height: 720px;
    overflow: hidden;
    background: radial-gradient(ellipse 90% 50% at 50% 0%, rgba(255, 255, 255, 0.4), transparent 60%), var(--paper);
    break-after: page;
    break-inside: avoid;
  }
  @page {
    size: 1280px 720px;
    margin: 0;
  }
</style>
