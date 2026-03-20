<script lang="ts">
  import '../app.css';
  import { onMount, setContext } from 'svelte';
  import BiomeBackground from '$lib/components/BiomeBackground.svelte';
  import BiomeToggle from '$lib/components/BiomeToggle.svelte';
  import { createBiomeStore } from '$lib/biome/store.svelte';

  const store = createBiomeStore();
  setContext('biome', store);

  let biomeVisible = $state(true);

  onMount(() => {
    store.initTier();
    store.startPolling();

    // Restore from localStorage on mount
    const stored = localStorage.getItem('biome-visible');
    if (stored === 'false') biomeVisible = false;

    function handleBiomeToggle(e: Event) {
      biomeVisible = (e as CustomEvent<{ visible: boolean }>).detail.visible;
    }
    window.addEventListener('biome-toggle', handleBiomeToggle);

    let raf: number;
    function loop() {
      store.tick();
      raf = requestAnimationFrame(loop);
    }
    loop();

    return () => {
      cancelAnimationFrame(raf);
      store.stopPolling();
      window.removeEventListener('biome-toggle', handleBiomeToggle);
    };
  });

  let { children } = $props();
</script>

{#if biomeVisible}
  <BiomeBackground {store} />
{/if}

<div class="relative z-10 min-h-screen">
  {@render children()}
</div>

<BiomeToggle />
