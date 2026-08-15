<script lang="ts">
  import { page } from '$app/state';
  import { getContext } from 'svelte';
  import { activeSection, isItemActive } from './admin-nav';

  const adminToken = getContext<string>('adminToken');

  function tokenHref(href: string): string {
    if (!adminToken) return href;
    const sep = href.includes('?') ? '&' : '?';
    return `${href}${sep}token=${adminToken}`;
  }

  const section = $derived(activeSection(page.url.pathname));
</script>

{#if section && section.items.length > 0}
  <nav class="admin-subnav" aria-label="{section.label} sub-navigation">
    <div class="admin-subnav-inner">
      {#each section.items as item (item.href)}
        <a
          href={tokenHref(item.href)}
          class="section-tab"
          aria-current={isItemActive(item, page.url.pathname) ? 'page' : undefined}
        >
          {item.label}
        </a>
      {/each}
    </div>
  </nav>
{/if}

<style>
  .admin-subnav {
    position: sticky;
    top: var(--site-nav-height);
    z-index: 20;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: blur(8px) saturate(1.05);
    -webkit-backdrop-filter: blur(8px) saturate(1.05);
    border-bottom: 1px solid var(--line-hair);
  }
  .admin-subnav-inner {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 8px 24px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .admin-subnav-inner::-webkit-scrollbar {
    display: none;
  }

  @media (max-width: 640px) {
    /* The top-nav grows to two rows on mobile, so a sticky sub-nav would need a
       variable offset and overlap it. Keep the sub-nav in normal flow instead. */
    .admin-subnav {
      position: static;
    }
    .admin-subnav-inner {
      padding: 7px 16px;
    }
  }
</style>
