<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();

  onMount(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/capture-sw.js').catch((err) => {
        console.warn('[capture] SW registration failed:', err);
      });
    }
  });
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <meta name="theme-color" content="#030712" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <link rel="manifest" href="/capture-manifest.json" />
</svelte:head>

<div class="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
  {@render children()}
</div>
