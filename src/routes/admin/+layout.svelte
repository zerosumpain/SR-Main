<script lang="ts">
  import '../../app.css';
  import { onMount, setContext } from 'svelte';
  import BiomeBackground from '$lib/components/BiomeBackground.svelte';
  import BiomeToggle from '$lib/components/BiomeToggle.svelte';
  import { createBiomeStore } from '$lib/biome/store.svelte';

  import { page } from '$app/stores';

  let { children } = $props();

  // Make admin token available to all admin pages (passed via ?token= URL param)
  setContext('adminToken', $page.url.searchParams.get('token') || '');

  // Biome store for admin pages
  const store = createBiomeStore();
  setContext('biomeStore', store);

  let biomeVisible = $state(true);

  onMount(() => {
    const stored = localStorage.getItem('biome-visible');
    if (stored === 'false') biomeVisible = false;

    store.initTier();
    store.startPolling();

    let raf: number;
    function loop() {
      store.tick();
      raf = requestAnimationFrame(loop);
    }
    loop();

    function handleBiomeToggle(e: Event) {
      biomeVisible = (e as CustomEvent<{ visible: boolean }>).detail.visible;
    }
    window.addEventListener('biome-toggle', handleBiomeToggle);

    return () => {
      cancelAnimationFrame(raf);
      store.stopPolling();
      window.removeEventListener('biome-toggle', handleBiomeToggle);
    };
  });
</script>

{#if biomeVisible}
  <BiomeBackground {store} />
{/if}

<div class="relative z-10 min-h-screen">
  {@render children()}
</div>

<BiomeToggle />
