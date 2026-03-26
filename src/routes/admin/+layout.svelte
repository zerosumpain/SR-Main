<script lang="ts">
  import '../../app.css';
  import { onMount, setContext } from 'svelte';
  import BiomeBackground from '$lib/components/BiomeBackground.svelte';
  import { createBiomeStore } from '$lib/biome/store.svelte';

  import { page } from '$app/stores';

  let { children } = $props();

  // Make admin token available to all admin pages (passed via ?token= URL param)
  setContext('adminToken', $page.url.searchParams.get('token') || '');

  // Biome store for admin pages
  const store = createBiomeStore();
  setContext('biomeStore', store);

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
</script>

<BiomeBackground {store} />

<div class="relative z-10 min-h-screen">
  {@render children()}
</div>
