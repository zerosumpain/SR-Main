<script lang="ts">
  import { onMount } from 'svelte';
  import { registerJkaiSW } from '$lib/jkai/pwa/register';
  import { startAutoSync } from '$lib/jkai/pwa/syncManager';
  import OfflineBanner from '$lib/components/jkai/OfflineBanner.svelte';
  import PushOptInCard from '$lib/components/jkai/PushOptInCard.svelte';
  import JkaiLauncher from '$lib/components/jkai/JkaiLauncher.svelte';
  import ActivityStrip from '$lib/components/jkai/ActivityStrip.svelte';
  import HubHeader from '$lib/components/jkai/HubHeader.svelte';
  import JkaiTabBar from '$lib/components/jkai/JkaiTabBar.svelte';
  import { launcher, closeLauncher, toggleLauncher } from '$lib/jkai/launcher-bus.svelte';
  import { PUBLIC_VAPID_PUBLIC_KEY } from '$env/static/public';

  let { children, data } = $props();

  // Global JKAI hub navigation — a command-palette launcher reachable from every
  // /jkai page via ⌘/Ctrl-K or the header's ⌘K chip. The floating fallback
  // button is gone: the header carries the trigger on every surface now.

  onMount(() => {
    void registerJkaiSW();
    const dispose = startAutoSync();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        toggleLauncher();
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
  <!-- Cream, not black: the installed PWA's status bar has to continue the
       page, and the whole surface is #ede4d4. -->
  <meta name="theme-color" content="#ede4d4" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="apple-mobile-web-app-title" content="jkai" />
  <link rel="apple-touch-icon" href="/jkai-pwa/icon-192.png" />
</svelte:head>

<div class="jkai-root">
  <OfflineBanner />
  <PushOptInCard vapidPublicKey={PUBLIC_VAPID_PUBLIC_KEY} />
  <ActivityStrip />

  <HubHeader
    tokensToday={data.hub.tokensToday}
    spendTodayUsd={data.hub.spendTodayUsd}
    budgetUsd={data.hub.budgetUsd}
    credit={data.hub.credit}
    codex={data.hub.codex}
    defaultModelId={data.hub.defaultModelId}
    activeRuns={data.hub.activeRuns}
    workflowCount={data.hub.workflowCount}
    workflowLiveCount={data.hub.workflowLiveCount}
    workflowFailedToday={data.hub.workflowFailedToday}
  />

  <div class="jkai-body">
    {@render children()}
  </div>

  <JkaiTabBar />

  <JkaiLauncher open={launcher.open} onClose={closeLauncher} />
</div>

<style>
  /* Full-viewport application shell: only the page body scrolls, so the header
     metrics stay ambient and the chat page can own its own scroll regions. */
  .jkai-root {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  .jkai-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
</style>
