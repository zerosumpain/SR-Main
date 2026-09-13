<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();

  onMount(() => {
    if (!('serviceWorker' in navigator)) return;
    // Narrow to /capture. The script sits at the origin root, so its default
    // scope is the whole site — this worker would then control every /jkai,
    // /drive and /health navigation on a hostname that now serves several
    // applications. Narrowing needs no Service-Worker-Allowed header.
    void retireRootScopedCaptureWorker().finally(() => {
      navigator.serviceWorker.register('/capture-sw.js', { scope: '/capture' }).catch((err) => {
        console.warn('[capture] SW registration failed:', err);
      });
    });
  });

  /**
   * Narrowing the scope above only affects NEW registrations. A browser that has
   * already installed this worker at "/" keeps it there, controlling the whole
   * origin, until it is explicitly unregistered — the same migration
   * $lib/jkai/pwa/register.ts does for its own legacy scope.
   */
  async function retireRootScopedCaptureWorker(): Promise<void> {
    if (typeof navigator.serviceWorker.getRegistrations !== 'function') return;
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations
          .filter((registration) => {
            const scope = new URL(registration.scope, window.location.origin);
            if (scope.origin !== window.location.origin || scope.pathname !== '/') return false;
            // Only OUR worker. Another root-scoped registration is not this
            // page's to unregister.
            const script =
              registration.active?.scriptURL ??
              registration.waiting?.scriptURL ??
              registration.installing?.scriptURL ??
              '';
            return new URL(script, window.location.origin).pathname === '/capture-sw.js';
          })
          .map((registration) => registration.unregister()),
      );
    } catch (err) {
      // A failed migration must not stop the correctly scoped worker registering.
      console.warn('[capture] legacy worker cleanup failed', err);
    }
  }
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
