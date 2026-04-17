<script lang="ts">
  import '../app.css';
  import { onMount, setContext } from 'svelte';
  import { createBiomeStore } from '$lib/biome/store.svelte';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import { page } from '$app/state';

  const store = createBiomeStore();
  setContext('biome', store);

  onMount(() => {
    store.initTier();
    store.startPolling();

    let raf: number;
    function loop() {
      store.tick();
      raf = requestAnimationFrame(loop);
    }
    loop();

    return () => {
      cancelAnimationFrame(raf);
      store.stopPolling();
    };
  });

  let { children } = $props();

  // Routes that render their own chrome or are full-screen builder/auth surfaces.
  // The global nav would clash with their own headers, so hide it there.
  const HIDE_NAV_PREFIXES = [
    '/login',
    '/auth-error',
    '/admin',              // admin section has its own protected chrome
    '/jkai/workflows/new', // full-screen workflow builder
  ];
  const HIDE_NAV_PATTERNS = [
    /^\/jkai\/workflows\/[^/]+$/,  // workflow detail editor
    /^\/jkai\/?$/,                  // /jkai renders its own merged header row
  ];

  let showNav = $derived.by(() => {
    const path = page.url.pathname;
    if (HIDE_NAV_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return false;
    if (HIDE_NAV_PATTERNS.some((r) => r.test(path))) return false;
    return true;
  });

  // On the home page, the page itself renders the hero SiteNav — don't double up.
  let isHome = $derived(page.url.pathname === '/');

  // Context-aware nav items — pick based on which section the user is in.
  // One nav row; its contents adapt to the page hierarchy.
  const SITE_ITEMS = [
    { href: '/', label: 'Home' },
    { href: '/projects', label: 'Projects' },
    { href: '/blog', label: 'Writing' },
    { href: '/health', label: 'Health' },
    { href: '/live', label: 'Live' },
    { href: '/jkai', label: 'jkai' },
  ];
  const JKAI_ITEMS = [
    { href: '/', label: 'Home' },
    { href: '/jkai', label: 'Chat' },
    { href: '/jkai/builds', label: 'Builds' },
    { href: '/jkai/prompts', label: 'Prompts' },
    { href: '/jkai/workflows', label: 'Workflows' },
    { href: '/jkai/channels', label: 'Channels' },
  ];
  const DEEPDIVE_ITEMS = [
    { href: '/', label: 'Home' },
    { href: '/projects', label: 'Projects' },
    { href: '/deepdive', label: 'Deep Dive' },
    { href: '/quickanswer', label: 'Quick' },
  ];

  let navItems = $derived.by(() => {
    const path = page.url.pathname;
    if (path.startsWith('/jkai')) return JKAI_ITEMS;
    if (path.startsWith('/deepdive') || path.startsWith('/quickanswer')) return DEEPDIVE_ITEMS;
    return SITE_ITEMS;
  });
</script>

<div class="relative z-10 min-h-screen">
  {#if showNav && !isHome}
    <header class="site-nav-bar">
      <SiteNav variant="compact" showBrand={false} items={navItems} />
    </header>
  {/if}
  {@render children()}
</div>

<style>
  :global(:root) {
    --site-nav-height: 56px;
  }

  @media (max-width: 640px) {
    :global(:root) {
      --site-nav-height: 48px;
    }
  }

  :global(.site-nav-bar) {
    position: sticky;
    top: 0;
    z-index: 30;
    min-height: var(--site-nav-height);
    padding: 14px 24px;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(10px) saturate(1.1);
    -webkit-backdrop-filter: blur(10px) saturate(1.1);
    border-bottom: 1px solid var(--divider);
    display: flex;
    align-items: center;
  }

  @media (max-width: 640px) {
    :global(.site-nav-bar) {
      padding: 10px 16px;
    }
  }
</style>
