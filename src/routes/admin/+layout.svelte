<script lang="ts">
  import '../../app.css';
  import { onMount, setContext } from 'svelte';
  import BiomeBackground from '$lib/components/BiomeBackground.svelte';
  import { createBiomeStore } from '$lib/biome/store.svelte';

  let { children, data } = $props();

  // Make admin token available to all admin pages
  setContext('adminToken', data?.adminToken || '');

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
