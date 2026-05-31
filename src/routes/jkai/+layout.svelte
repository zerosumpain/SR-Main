<script lang="ts">
  import { onMount } from 'svelte';
  import { registerJkaiSW } from '$lib/jkai/pwa/register';
  import { startAutoSync } from '$lib/jkai/pwa/syncManager';

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
  {@render children()}
</div>

<style>
  .jkai-root {
    min-height: 100vh;
    background: var(--bg, #ede4d4);
    color: var(--text-primary, #1a1008);
    font-family: var(--font-body);
  }
</style>
