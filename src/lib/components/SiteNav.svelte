<script lang="ts">
  import { page } from '$app/state';

  type NavItem = { href: string; label: string };

  const DEFAULT_ITEMS: NavItem[] = [
    { href: '/', label: 'Home' },
    { href: '/projects', label: 'Projects' },
    { href: '/blog', label: 'Writing' },
    { href: '/health', label: 'Health' },
    { href: '/live', label: 'Live' },
    { href: '/jkai', label: 'jkai' },
  ];

  let {
    variant = 'hero',
    items = DEFAULT_ITEMS,
  }: {
    variant?: 'hero' | 'compact';
    items?: NavItem[];
  } = $props();

  // Treat the logo-linked item as "Home" and exclude it from the list if present
  const displayItems = $derived(items.filter((i) => i.href !== '/'));

  function isActive(href: string): boolean {
    const path = page.url.pathname;
    if (href === '/') return path === '/';
    // Match exact or nested (e.g. /blog matches /blog/foo)
    return path === href || path.startsWith(`${href}/`);
  }
</script>

<div
  class="relative z-10 flex justify-between items-center"
  class:site-nav-hero={variant === 'hero'}
>
  <a
    href="/"
    class="display leading-none no-underline site-brand"
    class:text-[28px]={variant === 'hero'}
    class:sm:text-[32px]={variant === 'hero'}
    class:text-[20px]={variant === 'compact'}
    class:sm:text-[24px]={variant === 'compact'}
    style="color: var(--text-primary);"
    aria-label="Strange Ramblings — Home"
  >
    {#if variant === 'hero'}
      STRANGE<br />RAMBLINGS
    {:else}
      SR
    {/if}
  </a>

  <nav class="flex items-center gap-5 sm:gap-6 pt-1 flex-wrap justify-end" aria-label="Primary">
    {#each displayItems as item (item.href)}
      <a
        href={item.href}
        class="nav-link"
        aria-current={isActive(item.href) ? 'page' : undefined}
      >
        {item.label}
      </a>
    {/each}
  </nav>
</div>

<style>
  .site-brand {
    transition: color 0.2s;
  }
  .site-brand:hover {
    color: var(--accent);
  }
</style>
