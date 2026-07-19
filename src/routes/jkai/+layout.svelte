<script lang="ts">
  import { onMount } from 'svelte';
  import { registerJkaiSW } from '$lib/jkai/pwa/register';
  import { startAutoSync } from '$lib/jkai/pwa/syncManager';
  import OfflineBanner from '$lib/components/jkai/OfflineBanner.svelte';
  import PushOptInCard from '$lib/components/jkai/PushOptInCard.svelte';
  import JkaiLauncher from '$lib/components/jkai/JkaiLauncher.svelte';
  import ActivityStrip from '$lib/components/jkai/ActivityStrip.svelte';
  import { PUBLIC_VAPID_PUBLIC_KEY } from '$env/static/public';

  let { children } = $props();

  // Global JKAI hub navigation — a command-palette launcher reachable from every
  // /jkai page via the ⌘/Ctrl-K shortcut or the corner button.
  let launcherOpen = $state(false);

  onMount(() => {
    void registerJkaiSW();
    const dispose = startAutoSync();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        launcherOpen = !launcherOpen;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      dispose();
      window.removeEventListener('keydown', onKey);
    };
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
  <ActivityStrip />
  {@render children()}

  <button
    class="jkai-launch-btn"
    onclick={() => (launcherOpen = true)}
    title="JKAI launcher (⌘K)"
    aria-label="Open JKAI launcher"
  >
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <rect x="2" y="2" width="6" height="6" rx="1" /><rect x="12" y="2" width="6" height="6" rx="1" />
      <rect x="2" y="12" width="6" height="6" rx="1" /><rect x="12" y="12" width="6" height="6" rx="1" />
    </svg>
  </button>

  <JkaiLauncher open={launcherOpen} onClose={() => (launcherOpen = false)} />
</div>

<style>
  .jkai-root {
    min-height: 100vh;
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  .jkai-launch-btn {
    position: fixed;
    left: 16px;
    bottom: max(16px, env(safe-area-inset-bottom));
    z-index: 150;
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-elevated, var(--bg));
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    border-radius: 4px;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.12s, color 0.12s;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
  }
  .jkai-launch-btn:hover {
    opacity: 1;
    color: var(--accent-ink, var(--accent, #c4570a));
  }
  /* On mobile the composer docks at the bottom (chat) and the minimap sits
     bottom-left (canvas), so the launcher lives in the top band. The nav
     burger owns the top-right corner (38px wide at right:16px → occupies the
     right-most ~54px), so tuck the launcher just to its left with an 8px gap.
     Aligns with the sticky header, below the notch. */
  @media (max-width: 640px) {
    .jkai-launch-btn {
      left: auto;
      bottom: auto;
      right: 62px;
      top: max(12px, env(safe-area-inset-top));
      opacity: 0.85;
    }
  }
</style>
