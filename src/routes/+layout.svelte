<script lang="ts">
  import '../app.css';
  import '$lib/styles/nm-tokens.css';
  import { onMount, setContext } from 'svelte';
  import { onNavigate } from '$app/navigation';
  import { createBiomeStore } from '$lib/biome/store.svelte';

  const store = createBiomeStore();
  setContext('biome', store);

  onMount(() => {
    store.initTier();
    store.startPolling();

    let raf: number;
    function loop() {
      store.tick();
      raf = requestAnimationFrame(loop);
    }
    loop();

    return () => {
      cancelAnimationFrame(raf);
      store.stopPolling();
    };
  });

  // Subtle cross-fade between pages via the View Transitions API. Falls back to
  // an instant swap where unsupported or when the visitor prefers reduced
  // motion. Crossfade timing lives in app.css (::view-transition-old/new).
  onNavigate((navigation) => {
    const start = (document as any).startViewTransition?.bind(document) as
      | ((cb: () => Promise<void> | void) => unknown)
      | undefined;
    if (!start) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    return new Promise<void>((resolve) => {
      start(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });

  let { children } = $props();
</script>

<div class="relative z-10 min-h-screen">
  {@render children()}
</div>

<style>
  :global(:root) {
    --site-nav-height: 48px;
  }

  /* The nav is a full-bleed cell strip: no page padding, no translucency, no
     blur. Each destination is a cell of one grid divided by hairlines, so the
     strip reads as part of the page's structure rather than as chrome floating
     over it. Cells own their own padding — see SiteNav / PageHeader.
     
     It is INK, and that is the one declaration that docks the editorial system
     into the site. /health's own shell head was already `--text-primary` and
     /jkai's masthead joined it, so a cream strip here left the site
     contradicting itself: the same wordmark on two different grounds depending
     which page you were on. On ink the cell grammar gets BETTER, not worse —
     the current cell is cut out to the page ground, so it now reads as a
     notch of cream punched through the band and continuous with the page
     hanging beneath it.
     
     No bottom rule: the value change from #1a1008 to cream IS the edge, and a
     hairline on top of it only muddies the join. Everything rendered inside
     this strip is written for the dark ground — see SiteNav / PageHeader,
     where every paper token had to be relit. */
  :global(.site-nav-bar) {
    position: sticky;
    top: 0;
    z-index: 30;
    height: var(--site-nav-height);
    padding: 0;
    background: var(--text-primary);
    color: var(--bg);
    border-bottom: none;
    display: flex;
    align-items: stretch;
  }
</style>
