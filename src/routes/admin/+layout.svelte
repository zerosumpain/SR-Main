<script lang="ts">
  import '../../app.css';
  import '$lib/styles/nm-tokens.css';
  import './admin.css';
  import { onMount, setContext } from 'svelte';
  import { createBiomeStore } from '$lib/biome/store.svelte';
  import { page } from '$app/stores';
  import AdminShell from '$lib/components/admin/AdminShell.svelte';

  let { children } = $props();

  // Make admin token available to all admin pages (passed via ?token= URL param)
  setContext('adminToken', $page.url.searchParams.get('token') || '');

  // Biome store for admin effects page (no background rendering)
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

<AdminShell>
  {@render children()}
</AdminShell>
