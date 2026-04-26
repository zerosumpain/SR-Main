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

  // The login page renders standalone (no shell, no token).
  const isLogin = $derived($page.url.pathname === '/admin/login');
</script>

{#if isLogin}
  <div class="login-frame" style="background: var(--bg-base);">
    {@render children()}
  </div>
{:else}
  <AdminShell>
    {@render children()}
  </AdminShell>
{/if}

<style>
  .login-frame {
    min-height: 100vh;
  }
</style>
