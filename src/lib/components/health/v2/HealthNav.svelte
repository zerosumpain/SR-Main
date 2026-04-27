<script lang="ts">
  import { fmtAgo } from './utils';

  let { syncedAgoSeconds = 0 }: { syncedAgoSeconds?: number } = $props();

  const items = [
    { href: '/', label: 'Home' },
    { href: '/projects', label: 'Projects' },
    { href: '/blog', label: 'Writing' },
    { href: '/health', label: 'Health' },
    { href: '/live', label: 'Live' },
    { href: '/jkai', label: 'jkai' },
  ];
</script>

<header class="h-nav-bar">
  <div class="h-nav-title-wrap">
    <a href="/" class="brand h-brand">strange ramblings</a>
    <h1 class="h-page-title">health</h1>
    <span class="h-page-sub"
      ><span class="h-pulse-dot" aria-hidden="true"></span>Live · synced {fmtAgo(
        syncedAgoSeconds,
      )} ago</span
    >
  </div>
  <nav class="sr-nav" aria-label="Primary">
    {#each items as it, i (it.href)}
      <a
        href={it.href}
        class="sr-nav-link"
        data-index={String(i + 1).padStart(2, '0')}
        aria-current={it.href === '/health' ? 'page' : undefined}>{it.label}</a
      >
    {/each}
  </nav>
</header>

<style>
  .h-nav-bar {
    position: sticky;
    top: 0;
    z-index: 30;
    min-height: 56px;
    padding: 12px 32px;
    background: color-mix(in srgb, var(--bg) 86%, transparent);
    backdrop-filter: blur(12px) saturate(1.1);
    -webkit-backdrop-filter: blur(12px) saturate(1.1);
    border-bottom: 1px solid var(--divider);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
  }
  .h-nav-title-wrap {
    display: flex;
    align-items: baseline;
    gap: 14px;
    flex-wrap: wrap;
  }
  .h-brand {
    font-size: 22px;
  }
  .h-page-title {
    font-family: var(--font-brand);
    font-weight: 500;
    font-size: 22px;
    text-transform: lowercase;
    letter-spacing: -0.01em;
    line-height: 1;
    margin: 0;
    color: var(--text-primary);
    display: inline-flex;
    align-items: baseline;
    gap: 0.45ch;
  }
  .h-page-title::before {
    content: '>';
    color: var(--accent);
    opacity: 0.7;
  }
  .h-page-sub {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .h-pulse-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 8px rgba(196, 87, 10, 0.6);
    animation: sr-pulse 1.5s ease-in-out infinite;
    display: inline-block;
    margin-right: 8px;
    vertical-align: middle;
  }
  .sr-nav {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .sr-nav-link {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    position: relative;
    transition: color 0.2s ease-out;
    padding: 6px 10px;
    text-decoration: none;
    border: 1px solid transparent;
    border-radius: 2px;
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
  }
  .sr-nav-link[data-index]::before {
    content: attr(data-index);
    font-size: 9px;
    letter-spacing: 0.05em;
    color: var(--text-ghost);
    font-weight: 500;
    transition: color 0.2s;
  }
  .sr-nav-link::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 10px;
    right: 10px;
    height: 2px;
    background: var(--accent);
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.22s ease-out;
  }
  .sr-nav-link:hover {
    color: var(--text-primary);
    border-color: var(--card-border);
  }
  .sr-nav-link:hover::before {
    color: var(--accent);
  }
  .sr-nav-link:hover::after {
    transform: scaleX(1);
  }
  .sr-nav-link[aria-current='page'] {
    color: #fff;
    background: var(--accent);
    border-color: var(--accent);
  }
  .sr-nav-link[aria-current='page']::before {
    color: rgba(255, 255, 255, 0.65);
  }
  .sr-nav-link[aria-current='page']::after {
    transform: scaleX(0);
  }
  @media (prefers-reduced-motion: reduce) {
    .h-pulse-dot {
      animation: none;
    }
  }
  @media (max-width: 720px) {
    .h-nav-bar {
      min-height: 48px;
      padding: 10px 16px;
    }
    .h-page-title {
      font-size: 18px;
    }
  }
</style>
