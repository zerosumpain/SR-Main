<script lang="ts">
  import { page } from '$app/stores';
  import { getContext } from 'svelte';

  type NavItem = { label: string; href: string; match?: (path: string) => boolean };
  type NavGroup = { label: string | null; items: NavItem[] };

  let { children } = $props();

  const adminToken = getContext<string>('adminToken');

  let mobileOpen = $state(false);

  function tokenHref(href: string): string {
    if (!adminToken) return href;
    const sep = href.includes('?') ? '&' : '?';
    return `${href}${sep}token=${adminToken}`;
  }

  function isActive(item: NavItem, currentPath: string): boolean {
    if (item.match) return item.match(currentPath);
    if (item.href === '/admin') return currentPath === '/admin';
    return currentPath === item.href || currentPath.startsWith(item.href + '/');
  }

  const groups: NavGroup[] = [
    {
      label: null,
      items: [
        { label: 'Overview', href: '/admin', match: (p) => p === '/admin' },
      ],
    },
    {
      label: 'Content',
      items: [
        { label: 'Blog', href: '/admin/blog' },
        { label: 'Files', href: '/admin/files' },
      ],
    },
    {
      label: 'Health',
      items: [
        { label: 'Connections', href: '/admin/health' },
      ],
    },
    {
      label: 'Channels',
      items: [
        { label: 'Gmail', href: '/admin/gmail' },
        { label: 'Scraper', href: '/admin/scraper' },
      ],
    },
    {
      label: 'Agent',
      items: [
        { label: 'Dashboard', href: '/admin/agent', match: (p) => p === '/admin/agent' },
        { label: 'Tasks', href: '/admin/agent/tasks' },
        { label: 'Actions', href: '/admin/agent/actions' },
        { label: 'Costs', href: '/admin/agent/costs' },
        { label: 'Config', href: '/admin/agent/config' },
      ],
    },
    {
      label: 'AI Config',
      items: [
        { label: 'API Keys', href: '/admin/keys', match: (p) => p === '/admin/keys' || p === '/admin/deepdive' },
        { label: 'LLM Models', href: '/admin/models' },
        { label: 'Tools', href: '/admin/tools' },
      ],
    },
    {
      label: 'Site',
      items: [
        { label: 'Biome', href: '/admin/biome' },
      ],
    },
  ];
</script>

<div class="admin-shell">
  <!-- Mobile top bar -->
  <header class="mobile-bar">
    <a href={tokenHref('/admin')} class="mobile-brand admin-brand-link">
      <span class="brand admin-brand-mark">strange ramblings</span>
      <span class="brand-tag">admin</span>
    </a>
    <button
      type="button"
      class="mobile-toggle"
      aria-label="Toggle navigation"
      aria-expanded={mobileOpen}
      onclick={() => (mobileOpen = !mobileOpen)}
    >
      {mobileOpen ? '×' : '≡'}
    </button>
  </header>

  <aside class="sidebar" class:open={mobileOpen}>
    <a href={tokenHref('/admin')} class="admin-brand-link">
      <span class="brand admin-brand-mark">strange ramblings</span>
      <span class="brand-tag">admin</span>
    </a>

    <nav class="nav">
      {#each groups as group}
        <div class="nav-group">
          {#if group.label}
            <div class="nav-group-label">{group.label}</div>
          {/if}
          {#each group.items as item}
            <a
              href={tokenHref(item.href)}
              class="nav-item"
              class:active={isActive(item, $page.url.pathname)}
              onclick={() => (mobileOpen = false)}
            >
              {item.label}
            </a>
          {/each}
        </div>
      {/each}
    </nav>

    <div class="nav-foot">
      <a href="https://docs.strangeramblings.com" target="_blank" rel="noopener" class="foot-link">Docs ↗</a>
      <a href="/" class="foot-link">← Back to site</a>
    </div>
  </aside>

  {#if mobileOpen}
    <button class="scrim" aria-label="Close navigation" onclick={() => (mobileOpen = false)}></button>
  {/if}

  <main class="content">
    {@render children()}
  </main>
</div>

<style>
  .admin-shell {
    display: grid;
    grid-template-columns: 220px 1fr;
    min-height: 100vh;
    background: var(--bg-base);
    color: var(--text-primary);
    font-family: var(--font-body);
  }

  .mobile-bar {
    display: none;
  }

  .sidebar {
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
    background: var(--bg);
    border-right: 1px solid var(--card-border);
    display: flex;
    flex-direction: column;
    padding: 1.5rem 0 1rem;
  }

  .admin-brand-link {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0 1.25rem 1.25rem;
    border-bottom: 1px solid var(--divider);
    margin-bottom: 1rem;
    text-decoration: none;
  }
  .admin-brand-mark {
    font-size: 18px;
  }
  .brand-tag {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--accent);
  }

  .nav {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 0 0.75rem;
  }

  .nav-group {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .nav-group-label {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--text-ghost);
    padding: 0.4rem 0.5rem 0.3rem;
  }

  .nav-item {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-secondary);
    padding: 6px 10px;
    border-left: 2px solid transparent;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  .nav-item:hover {
    background: var(--accent-tint-08);
    color: var(--text-primary);
    border-left-color: var(--card-border);
  }
  .nav-item.active {
    background: var(--accent-tint-08);
    color: var(--accent);
    border-left-color: var(--accent);
  }

  .nav-foot {
    margin-top: 1rem;
    padding: 0.75rem 1.25rem 0;
    border-top: 1px solid var(--divider);
  }
  .foot-link {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--text-muted);
    transition: color 120ms ease;
  }
  .foot-link:hover { color: var(--accent); }

  .content {
    min-width: 0;
    padding: 0;
  }

  .scrim {
    display: none;
  }

  @media (max-width: 880px) {
    .admin-shell {
      grid-template-columns: 1fr;
    }
    .mobile-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.7rem 1rem;
      background: var(--bg);
      border-bottom: 1px solid var(--card-border);
      position: sticky;
      top: 0;
      z-index: 30;
    }
    .mobile-brand {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
    }
    .mobile-toggle {
      background: none;
      border: 1px solid var(--card-border);
      width: 32px;
      height: 32px;
      font-family: var(--font-mono);
      font-size: 18px;
      line-height: 1;
      color: var(--text-primary);
      cursor: pointer;
    }
    .sidebar {
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      width: 240px;
      transform: translateX(-100%);
      transition: transform 200ms ease;
      z-index: 50;
      border-right: 1px solid var(--card-border);
    }
    .sidebar.open {
      transform: translateX(0);
    }
    .scrim {
      display: block;
      position: fixed;
      inset: 0;
      background: rgba(26, 16, 8, 0.35);
      backdrop-filter: blur(2px);
      z-index: 40;
      border: 0;
      padding: 0;
    }
  }
</style>
