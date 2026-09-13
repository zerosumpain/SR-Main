<script lang="ts">
  import { onMount } from 'svelte';
  import JkaiLauncher from '$lib/components/jkai/JkaiLauncher.svelte';
  import ActivityStrip from '$lib/components/jkai/ActivityStrip.svelte';
  import HubHeader from '$lib/components/jkai/HubHeader.svelte';
  import JkaiTabBar from '$lib/components/jkai/JkaiTabBar.svelte';
  import { launcher, closeLauncher, toggleLauncher } from '$lib/jkai/launcher-bus.svelte';

  let { children, data } = $props();

  // Global JKAI hub navigation — a command-palette launcher reachable from every
  // /jkai page via ⌘/Ctrl-K or the header's ⌘K chip. The floating fallback
  // button is gone: the header carries the trigger on every surface now.

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        toggleLauncher();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

<svelte:head>
  <!-- Selawik carries jkai's reading copy (see the jkai type scope in app.css).
       Preloaded here rather than in app.html so only /jkai pays for it, and only
       the regular weight: jkai asks for font-weight 500 in ~67 places and Selawik
       has no Medium, so 500 resolves down to this face. 600/700 swap in.
       `crossorigin` is required even same-origin — fonts always fetch in CORS
       mode, and without it the browser downloads the file a second time. -->
  <link
    rel="preload"
    as="font"
    type="font/woff2"
    href="/fonts/selawik/selawik-regular.woff2"
    crossorigin="anonymous"
  />
  <meta name="theme-color" content="#1a1008" />
</svelte:head>

<div class="jkai-root">
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
    activitySourceCount={data.hub.activitySourceCount}
    buildVersion={data.deploy.short}
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
    /* The shell sits one step behind the content it frames — rails go to
       --surface-rail, the conversation column stays on --bg, and this is what
       reads as "behind" both. */
    background: var(--surface-shell);
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
