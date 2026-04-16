<script lang="ts">
  import '../../app.css';
  import { onMount, setContext } from 'svelte';
  import { createBiomeStore } from '$lib/biome/store.svelte';

  import { page } from '$app/stores';

  let { children } = $props();

  // Make admin token available to all admin pages (passed via ?token= URL param)
  setContext('adminToken', $page.url.searchParams.get('token') || '');

  // Biome store for admin config page (no background rendering)
  const store = createBiomeStore();
  setContext('biomeStore', store);

  onMount(() => {
    store.initTier();
    store.startPolling();

    return () => {
      store.stopPolling();
    };
  });
</script>

<div class="relative min-h-screen" style="background: var(--bg-base);">
  {@render children()}
</div>
