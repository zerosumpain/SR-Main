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
  .admin-top-nav {
    gap: 1rem;
  }

  .admin-wordmark {
    flex-shrink: 0;
    font-size: 18px;
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
    text-decoration: none;
  }
  .admin-tag {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--accent);
  }

  .admin-sections {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .admin-sections::-webkit-scrollbar {
    display: none;
  }

  .view-site {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--text-muted);
    padding: 5px 10px;
    border: 1px solid var(--card-border);
    border-radius: 2px;
    text-decoration: none;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .view-site:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  @media (max-width: 640px) {
    /* Brand + "View site" stay on the first row; the section nav wraps to a
       full-width, horizontally-scrollable second row so all six sections stay
       reachable (the site uses a burger here; a scroll strip suits a dense
       settings area better and matches the sub-nav treatment below). */
    .admin-top-nav {
      flex-wrap: wrap;
      row-gap: 0;
    }
    .admin-wordmark {
      font-size: 15px;
      order: 1;
    }
    .view-site {
      order: 2;
      margin-left: auto;
      letter-spacing: 0.12em;
    }
    .admin-sections {
      order: 3;
      width: 100%;
      margin-left: 0;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--divider);
    }
  }
</style>
