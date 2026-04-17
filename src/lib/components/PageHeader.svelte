<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import SiteNav from './SiteNav.svelte';

  type NavItem = { href: string; label: string };

  let {
    title,
    items,
    meta,
    before,
    titleHref,
  }: {
    title: string;
    /** Optional nav item override; defaults to context-derived site nav */
    items?: NavItem[];
    /** Slot for small metadata beside the title (counts, status, etc.) */
    meta?: Snippet;
    /** Slot rendered before the title (e.g. mobile menu toggle) */
    before?: Snippet;
    /** Optional href to wrap the title (e.g. parent/hub link). */
    titleHref?: string;
  } = $props();

  const SITE_ITEMS: NavItem[] = [
    { href: '/', label: 'Home' },
    { href: '/projects', label: 'Projects' },
    { href: '/blog', label: 'Writing' },
    { href: '/health', label: 'Health' },
    { href: '/live', label: 'Live' },
    { href: '/jkai', label: 'jkai' },
  ];
  const JKAI_ITEMS: NavItem[] = [
    { href: '/', label: 'Home' },
    { href: '/jkai', label: 'Chat' },
    { href: '/jkai/builds', label: 'Builds' },
    { href: '/jkai/prompts', label: 'Prompts' },
    { href: '/jkai/workflows', label: 'Workflows' },
    { href: '/jkai/channels', label: 'Channels' },
  ];
  const DEEPDIVE_ITEMS: NavItem[] = [
    { href: '/', label: 'Home' },
    { href: '/projects', label: 'Projects' },
    { href: '/deepdive', label: 'Deep Dive' },
    { href: '/quickanswer', label: 'Quick' },
  ];

  let resolvedItems = $derived.by(() => {
    if (items) return items;
    const path = page.url.pathname;
    if (path.startsWith('/jkai')) return JKAI_ITEMS;
    if (path.startsWith('/deepdive') || path.startsWith('/quickanswer')) return DEEPDIVE_ITEMS;
    return SITE_ITEMS;
  });
</script>

<header class="site-nav-bar flex items-center justify-between gap-4 flex-shrink-0">
  <div class="flex items-center gap-3 sm:gap-5 min-w-0">
    {#if before}{@render before()}{/if}
    {#if titleHref}
      <a href={titleHref} class="display text-[20px] sm:text-[24px] leading-none truncate hover:text-[var(--accent)] transition-colors" style="color: var(--text-primary);">
        {title}
      </a>
    {:else}
      <h1 class="display text-[20px] sm:text-[24px] leading-none truncate" style="color: var(--text-primary);">
        {title}
      </h1>
    {/if}
    {#if meta}
      <div class="min-w-0 hidden md:flex items-center">
        {@render meta()}
      </div>
    {/if}
  </div>
  <SiteNav variant="compact" showBrand={false} items={resolvedItems} />
</header>
