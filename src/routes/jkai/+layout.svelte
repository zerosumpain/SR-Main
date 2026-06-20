<script lang="ts">
  import { onMount } from 'svelte';
  import { registerJkaiSW } from '$lib/jkai/pwa/register';
  import { startAutoSync } from '$lib/jkai/pwa/syncManager';
  import OfflineBanner from '$lib/components/jkai/OfflineBanner.svelte';
  import PushOptInCard from '$lib/components/jkai/PushOptInCard.svelte';
  import { PUBLIC_VAPID_PUBLIC_KEY } from '$env/static/public';

  let { children } = $props();

  onMount(() => {
    void registerJkaiSW();
    const dispose = startAutoSync();
    return () => dispose();
  });
</script>

<svelte:head>
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#0a0a0a" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="jkai" />
  <link rel="apple-touch-icon" href="/jkai-pwa/icon-192.png" />
</svelte:head>

<div class="jkai-root">
  <OfflineBanner />
  <PushOptInCard vapidPublicKey={PUBLIC_VAPID_PUBLIC_KEY} />
  {@render children()}
</div>

<style>
  .jkai-root {
    min-height: 100vh;
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-body);
  }
</style>
