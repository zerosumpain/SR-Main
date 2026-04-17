<script lang="ts">
  import '../app.css';
  import { onMount, setContext } from 'svelte';
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
