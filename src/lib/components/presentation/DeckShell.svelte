<script lang="ts">
  // Editorial deck theme wrapper — the field-study register (Fraunces /
  // DM Sans / JetBrains Mono over paper-and-ink), aliased from the site
  // tokens exactly as data-spine's layout does. A future theme is a new
  // data-theme block of vars; blocks never hardcode palette.
  import type { Snippet } from 'svelte';

  let { theme = 'editorial', children }: { theme?: string; children: Snippet } = $props();
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,500&family=DM+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500;600&display=swap"
  />
</svelte:head>

<div class="deck-root" data-theme={theme}>
  <div class="deck-grain" aria-hidden="true"></div>
  {@render children()}
</div>

<style>
  .deck-root {
    --paper: var(--bg);
    --paper-deep: var(--surface-elevated);
    --ink: var(--text-primary);
    --ink-soft: var(--text-muted);
    position: fixed;
    inset: 0;
    background: radial-gradient(ellipse 90% 50% at 50% 0%, rgba(255, 255, 255, 0.4), transparent 60%), var(--paper);
    color: var(--ink);
    font-family: 'DM Sans', system-ui, sans-serif;
    overflow: hidden;
  }
  .deck-grain {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    opacity: 0.5;
    mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.18  0 0 0 0 0.14  0 0 0 0 0.10  0 0 0 0.07 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  }
</style>
