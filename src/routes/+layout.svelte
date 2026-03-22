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
