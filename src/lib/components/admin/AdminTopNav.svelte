<script lang="ts">
  import { page } from '$app/state';
  import { getContext } from 'svelte';
  import { ADMIN_SECTIONS, isSectionActive } from './admin-nav';

  const adminToken = getContext<string>('adminToken');

  function tokenHref(href: string): string {
    if (!adminToken) return href;
    const sep = href.includes('?') ? '&' : '?';
    return `${href}${sep}token=${adminToken}`;
  }
</script>

<header class="site-nav-bar admin-top-nav">
  <a
    href={tokenHref('/admin')}
    class="brand admin-wordmark"
    aria-label="Strange Ramblings admin — dashboard"
  >
    strange ramblings<span class="admin-tag">admin</span>
  </a>

  <nav class="admin-sections" aria-label="Admin sections">
    {#each ADMIN_SECTIONS as s, i (s.id)}
      <a
        href={tokenHref(s.href)}
        class="nav-link"
        data-index={String(i + 1).padStart(2, '0')}
        aria-current={isSectionActive(s, page.url.pathname) ? 'page' : undefined}
      >
        {s.label}
      </a>
    {/each}
  </nav>

  <a href="/" class="view-site" aria-label="Back to main site">
    View site
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M2.5 7.5L7.5 2.5M7.5 2.5H3.5M7.5 2.5V6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="square" />
    </svg>
  </a>
</header>

<style>
  /* Admin wears the same cell strip as the site nav: each section is a cell of
     one grid, divided by hairlines, and the current one is cut out with an
     accent seam. Cells own their own padding — .site-nav-bar has none. */
  .admin-wordmark {
    flex-shrink: 0;
    font-size: var(--fs-body-sm);
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 20px;
    border-right: 1px solid var(--line-hair);
    text-decoration: none;
  }
  .admin-tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--accent);
  }

  .admin-sections {
    margin-left: auto;
    display: flex;
    align-items: stretch;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .admin-sections::-webkit-scrollbar {
    display: none;
  }
  .admin-sections :global(.nav-link) {
    display: inline-flex;
    align-items: center;
    flex: none;
    padding: 0 16px;
    border: none;
    border-right: 1px solid var(--line-hair);
    border-radius: 0;
    letter-spacing: var(--tracking-label);
    white-space: nowrap;
  }
  .admin-sections :global(.nav-link::after) {
    display: none;
  }
  .admin-sections :global(.nav-link:first-child) {
    border-left: 1px solid var(--line-hair);
  }
  .admin-sections :global(.nav-link:hover) {
    background: var(--accent-tint-04);
  }
  .admin-sections :global(.nav-link[aria-current='page']) {
    color: var(--text-primary);
    background: var(--bg);
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .admin-sections :global(.nav-link[aria-current='page']::before) {
    color: var(--accent);
  }

  .view-site {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 18px;
    border-left: 1px solid var(--line-hair);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
    text-decoration: none;
    transition: color 0.2s var(--ease-out), background 0.2s var(--ease-out);
  }
  .view-site:hover {
    color: var(--accent);
    background: var(--accent-tint-04);
  }

  /* The strip scrolls rather than wrapping on a phone — a second row would
     double the height of a bar that is meant to be one 48px band. */
  @media (max-width: 640px) {
    .admin-wordmark {
      padding: 0 14px;
    }
    .admin-tag {
      display: none;
    }
    .view-site {
      padding: 0 12px;
    }
  }
</style>
