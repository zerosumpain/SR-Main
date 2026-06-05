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
    --site-nav-height: 56px;
  }

  @media (max-width: 640px) {
    :global(:root) {
      --site-nav-height: 48px;
    }
  }

  :global(.site-nav-bar) {
    position: sticky;
    top: 0;
    z-index: 30;
    min-height: var(--site-nav-height);
    padding: 14px 24px;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(10px) saturate(1.1);
    -webkit-backdrop-filter: blur(10px) saturate(1.1);
    border-bottom: 1px solid var(--divider);
    display: flex;
    align-items: center;
  }

  @media (max-width: 640px) {
    :global(.site-nav-bar) {
      padding: 10px 16px;
    }
  }
</style>
