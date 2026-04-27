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
    showBrand = true,
  }: {
    variant?: 'hero' | 'compact';
    items?: NavItem[];
    showBrand?: boolean;
  } = $props();

  // When brand is shown it links home, so omit Home from the nav list.
  // When brand is hidden, we need Home in the list to remain reachable.
  const displayItems = $derived(showBrand ? items.filter((i) => i.href !== '/') : items);

  function isActive(href: string): boolean {
    const path = page.url.pathname;
    if (href === '/') return path === '/';
    return path === href || path.startsWith(`${href}/`);
  }
</script>

<div
  class="relative z-10 flex items-center gap-6"
  class:justify-between={showBrand}
  class:justify-end={!showBrand}
>
  {#if showBrand}
    <a
      href="/"
      class="brand leading-none no-underline site-brand"
      class:text-[24px]={variant === 'hero'}
      class:sm:text-[28px]={variant === 'hero'}
      class:text-[18px]={variant === 'compact'}
      class:sm:text-[20px]={variant === 'compact'}
      aria-label="Strange Ramblings — Home"
    >
      strange ramblings
    </a>
  {/if}

  <nav
    class="flex items-center gap-1 sm:gap-2 flex-wrap justify-end"
    aria-label="Primary"
  >
    {#each displayItems as item, i (item.href)}
      <a
        href={item.href}
        class="nav-link"
        data-index={String(i + 1).padStart(2, '0')}
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
    flex-shrink: 0;
  }
  .site-brand:hover {
    color: var(--accent);
  }
</style>
