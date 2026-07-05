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
    { href: '/drive', label: 'Drive' },
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

  let menuOpen = $state(false);

  function isActive(href: string): boolean {
    const path = page.url.pathname;
    if (href === '/') return path === '/';
    return path === href || path.startsWith(`${href}/`);
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') menuOpen = false;
  }}
/>

<!-- z-index lifts above sibling hero content (also z-10) while the menu is
     open, so the dropdown panel receives clicks instead of the overlay. -->
<div
  class="relative flex items-center gap-6"
  class:justify-between={showBrand}
  class:justify-end={!showBrand}
  style:z-index={menuOpen ? 60 : 10}
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

  <!-- Inline nav — tablet / desktop (>= 640px) -->
  <nav
    class="hidden sm:flex items-center gap-1 sm:gap-2 flex-wrap justify-end"
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

  <!-- Burger — mobile (< 640px) -->
  <div class="burger-wrap sm:hidden">
    <button
      type="button"
      class="burger"
      class:is-open={menuOpen}
      aria-label={menuOpen ? 'Close menu' : 'Open menu'}
      aria-expanded={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}
    >
      <span></span>
      <span></span>
      <span></span>
    </button>

    {#if menuOpen}
      <button
        type="button"
        class="burger-backdrop"
        aria-label="Close menu"
        onclick={() => (menuOpen = false)}
      ></button>
      <nav class="burger-panel" aria-label="Primary">
        {#each displayItems as item (item.href)}
          <a
            href={item.href}
            class="burger-link"
            aria-current={isActive(item.href) ? 'page' : undefined}
            onclick={() => (menuOpen = false)}
          >
            {item.label}
          </a>
        {/each}
      </nav>
    {/if}
  </div>
</div>

<style>
  .site-brand {
    transition: color 0.2s;
    flex-shrink: 0;
  }
  .site-brand:hover {
    color: var(--accent);
  }

  .burger-wrap {
    position: relative;
    flex-shrink: 0;
  }
  .burger {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
    width: 38px;
    height: 38px;
    padding: 0 7px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    cursor: pointer;
  }
  .burger span {
    display: block;
    height: 2px;
    width: 100%;
    background: var(--text-primary);
    transition:
      transform 0.2s ease,
      opacity 0.2s ease;
  }
  .burger.is-open span:nth-child(1) {
    transform: translateY(7px) rotate(45deg);
  }
  .burger.is-open span:nth-child(2) {
    opacity: 0;
  }
  .burger.is-open span:nth-child(3) {
    transform: translateY(-7px) rotate(-45deg);
  }

  .burger-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: transparent;
    border: none;
    cursor: default;
  }
  .burger-panel {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    z-index: 51;
    display: flex;
    flex-direction: column;
    min-width: 190px;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
  }
  .burger-link {
    font-family: var(--font-mono);
    font-size: 13px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-secondary);
    text-decoration: none;
    padding: 12px 16px;
    border-bottom: 1px solid var(--divider);
    transition:
      background 0.15s,
      color 0.15s;
  }
  .burger-link:last-child {
    border-bottom: none;
  }
  .burger-link:hover {
    background: var(--accent-tint-04);
    color: var(--text-primary);
  }
  .burger-link[aria-current='page'] {
    color: var(--accent);
  }
</style>
