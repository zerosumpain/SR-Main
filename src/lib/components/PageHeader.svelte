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
    { href: '/decks', label: 'Decks' },
    { href: '/blog', label: 'Writing' },
    { href: '/health', label: 'Health' },
    { href: '/live', label: 'Live' },
    { href: '/jkai', label: 'jkai' },
    { href: '/drive', label: 'Drive' },
  ];
  const JKAI_ITEMS: NavItem[] = [
    { href: '/', label: 'Home' },
    { href: '/jkai', label: 'Chat' },
    { href: '/jkai/intel', label: 'Intel' },
    { href: '/jkai/research', label: 'Research' },
    { href: '/jkai/builds', label: 'Builds' },
    { href: '/jkai/canvas', label: 'Canvases' },
    { href: '/jkai/briefing', label: 'Briefing' },
    { href: '/jkai/improvement', label: 'Improvement' },
    { href: '/jkai/prompts', label: 'Prompts' },
  ];

  let resolvedItems = $derived.by(() => {
    if (items) return items;
    const path = page.url.pathname;
    if (path.startsWith('/jkai')) return JKAI_ITEMS;
    return SITE_ITEMS;
  });
</script>

<header class="site-nav-bar flex items-center justify-between gap-4 flex-shrink-0">
  <div class="flex items-center gap-3 sm:gap-5 min-w-0 flex-shrink">
    {#if before}{@render before()}{/if}
    {#if titleHref}
      <a
        href={titleHref}
        title={title}
        class="brand text-[18px] sm:text-[22px] leading-none truncate min-w-0 flex-shrink"
        style="max-width: min(55vw, 520px);"
      >
        {title}
      </a>
    {:else}
      <h1
        title={title}
        class="brand text-[18px] sm:text-[22px] leading-none truncate min-w-0 flex-shrink"
        style="max-width: min(55vw, 520px);"
      >
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
