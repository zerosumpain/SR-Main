<script lang="ts">
  // Thin shell for Broads Pilot. Loads Leaflet (same vendor bundle as /live),
  // links the PWA manifest, and renders a slim SR top bar above the slot.
  import { page } from '$app/stores';
  let { children } = $props();
  const onMethod = $derived($page.url.pathname.endsWith('/method'));
</script>

<svelte:head>
  <link rel="stylesheet" href="/vendor/leaflet.min.css" />
  <script src="/vendor/leaflet.min.js"></script>
  <link rel="manifest" href="/broads-pilot/manifest.webmanifest" />
  <meta name="theme-color" content="#c4570a" />
</svelte:head>

<div class="bp-shell">
  <header class="bp-bar">
    <a class="bp-brand" href="/projects" aria-label="Back to projects">
      <span class="bp-monogram">sr.</span>
      <span class="bp-title">Broads&nbsp;Pilot</span>
    </a>
    <nav class="bp-nav">
      <a class="bp-link" class:active={!onMethod} href="/projects/broads-pilot">Planner</a>
      <a class="bp-link" class:active={onMethod} href="/projects/broads-pilot/method">Method</a>
    </nav>
  </header>
  <main class="bp-main">
    {@render children?.()}
  </main>
</div>

<style>
  /* Full-viewport app shell. The planner is a full-bleed map; Method is a doc. */
  :global(html, body) {
    height: 100%;
  }
  .bp-shell {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    background: var(--bg);
    color: var(--text-primary);
  }
  .bp-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 0.9rem;
    border-bottom: 1px solid var(--card-border);
    background: var(--surface-elevated, var(--bg));
    z-index: 1000;
  }
  .bp-brand {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
    text-decoration: none;
    color: var(--text-primary);
  }
  .bp-monogram {
    font-family: var(--font-brand, 'DM Mono', monospace);
    font-weight: 600;
    color: var(--accent);
    font-size: 0.95rem;
  }
  .bp-title {
    font-family: var(--font-display, 'Archivo Black', sans-serif);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.82rem;
  }
  .bp-nav {
    display: flex;
    gap: 0.25rem;
  }
  .bp-link {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    text-decoration: none;
    padding: 0.35rem 0.6rem;
    border-radius: 0.4rem;
  }
  .bp-link.active {
    color: var(--accent);
    background: var(--accent-tint-08, rgba(196, 87, 10, 0.08));
  }
  .bp-main {
    flex: 1 1 auto;
    min-height: 0;
    position: relative;
  }
</style>
