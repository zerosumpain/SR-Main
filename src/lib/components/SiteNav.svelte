<script lang="ts">
  import { page } from '$app/state';

  type NavItem = { href: string; label: string };

  const DEFAULT_ITEMS: NavItem[] = [
    { href: '/', label: 'Home' },
    { href: '/projects', label: 'Projects' },
    { href: '/decks', label: 'Decks' },
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

<!-- The nav is a cell strip: each destination is a cell of one grid, divided by
     hairlines, and the current one is cut out of the strip — page ground behind
     it and a 2px accent seam on its bottom edge. That reads as "you are stood
     here" without a filled block shouting it.

     z-index lifts above sibling hero content (also z-10) while the phone menu is
     open, so the panel receives clicks instead of the overlay. -->
<div
  class="nav-strip"
  class:with-brand={showBrand}
  style:z-index={menuOpen ? 60 : 10}
>
  {#if showBrand}
    <a
      href="/"
      class="brand nav-brand no-underline"
      class:hero={variant === 'hero'}
      aria-label="Strange Ramblings — Home"
    >
      strange ramblings
    </a>
  {/if}

  <!-- Inline nav — tablet / desktop (>= 640px) -->
  <nav class="nav-cells" aria-label="Primary">
    {#each displayItems as item (item.href)}
      <a
        href={item.href}
        class="nav-cell"
        aria-current={isActive(item.href) ? 'page' : undefined}
      >
        {item.label}
      </a>
    {/each}
  </nav>

  <!-- Burger — mobile (< 640px) -->
  <div class="burger-wrap">
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
  .nav-strip {
    position: relative;
    display: flex;
    align-items: stretch;
    align-self: stretch;
    min-width: 0;
    flex: 1;
    justify-content: flex-end;
  }
  .nav-strip.with-brand {
    justify-content: space-between;
  }

  .nav-brand {
    display: inline-flex;
    align-items: center;
    padding: 0 20px;
    border-right: 1px solid var(--line-hair);
    font-size: 15px;
    flex-shrink: 0;
    transition: color 0.2s var(--ease-out);
  }
  .nav-brand.hero {
    font-size: 18px;
  }
  .nav-brand:hover {
    color: var(--accent);
  }

  .nav-cells {
    display: flex;
    align-items: stretch;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .nav-cells::-webkit-scrollbar {
    display: none;
  }
  .nav-cell {
    display: inline-flex;
    align-items: center;
    flex: none;
    padding: 0 16px;
    border-right: 1px solid var(--line-hair);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
    text-decoration: none;
    white-space: nowrap;
    transition: color 0.2s var(--ease-out), background 0.2s var(--ease-out);
  }
  /* The brand already owns the left edge; without it the first cell needs one. */
  .nav-strip:not(.with-brand) .nav-cells .nav-cell:first-child {
    border-left: 1px solid var(--line-hair);
  }
  .nav-cell:hover {
    color: var(--text-primary);
    background: var(--accent-tint-04);
  }
  /* Cut out of the strip: page ground behind it, accent seam on the bottom. */
  .nav-cell[aria-current='page'] {
    color: var(--text-primary);
    background: var(--bg);
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .burger-wrap {
    display: none;
    position: relative;
    flex-shrink: 0;
    align-items: center;
    padding: 0 12px;
    border-left: 1px solid var(--line-hair);
  }
  .burger {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
    width: 38px;
    height: 38px;
    padding: 0 7px;
    background: transparent;
    border: 1px solid var(--line-strong);
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
  /* A floating layer — one of the two places elevation is allowed. */
  .burger-panel {
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 51;
    display: flex;
    flex-direction: column;
    min-width: 190px;
    background: var(--surface-shell);
    border: 1px solid var(--line-strong);
    box-shadow: var(--elev-pop);
  }
  .burger-link {
    font-family: var(--font-mono);
    font-size: var(--fs-nav);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-secondary);
    text-decoration: none;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line-hair);
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

  /* Phone: the cells become a burger. The strip keeps its shape so the brand
     cell and its divider stay put. */
  @media (max-width: 640px) {
    .nav-cells {
      display: none;
    }
    .burger-wrap {
      display: flex;
    }
    .nav-brand {
      padding: 0 14px;
    }
  }
</style>
