<script lang="ts">
  // SectionNav — section tab bar + narrative toggle + mobile burger
  // (pattern copied from policy-engine/components/SectionNav.svelte).
  // Governance keeps its warning styling via isGov(), not list position.
  import { app } from '../lib/appState.svelte';
  import { page } from '$app/stores';

  const SECTIONS = [
    { href: '/projects/data-spine', label: 'Briefing' },
    { href: '/projects/data-spine/value', label: 'Value & personas' },
    { href: '/projects/data-spine/architecture', label: 'Architecture' },
    { href: '/projects/data-spine/federation', label: 'Federation' },
    { href: '/projects/data-spine/governance', label: 'Governance' },
  ];
  const isGov = (href: string) => href.endsWith('/governance');
  const pathname = $derived($page.url.pathname.replace(/\/$/, ''));
  const active = (href: string) => pathname === href.replace(/\/$/, '');
  const current = $derived(SECTIONS.find((n) => active(n.href))?.label ?? 'Sections');
  let menuOpen = $state(false);
</script>

<div class="secnav">
  <nav class="tabs" aria-label="Sections">
    {#each SECTIONS as n}
      <a class="tab" class:gov={isGov(n.href)} class:active={active(n.href)} href={n.href}>{isGov(n.href) ? '⚖ ' : ''}{n.label}</a>
    {/each}
  </nav>

  <button class="burger" onclick={() => (menuOpen = !menuOpen)} aria-expanded={menuOpen} aria-label="Sections menu">
    <span class="bg-icon" aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
    <span class="bg-cur">{current}</span>
    <span class="bg-chev" class:open={menuOpen} aria-hidden="true">▾</span>
  </button>

  <div class="detail" role="group" aria-label="Explanation detail">
    <span class="d-lab">Explain it as</span>
    <div class="seg">
      <button class:on={app.narrative === 'research'} onclick={() => (app.narrative = 'research')}
              title="Research view — the full explanation with the evidence.">Research</button>
      <button class:on={app.narrative === 'eli5'} onclick={() => (app.narrative = 'eli5')}
              title="ELI5 — the same thing in plain, jargon-free English.">ELI5</button>
    </div>
  </div>

  {#if menuOpen}
    <button class="nav-scrim" aria-label="Close menu" onclick={() => (menuOpen = false)}></button>
    <nav class="nav-menu" aria-label="Sections">
      {#each SECTIONS as n}
        <a class="nm-item" class:active={active(n.href)} href={n.href} onclick={() => (menuOpen = false)}>{n.label}</a>
      {/each}
    </nav>
  {/if}
</div>

<style>
  .secnav { position: sticky; top: var(--topH, 0px); z-index: 12; display: flex; align-items: center; justify-content: space-between; gap: 12px 16px; flex-wrap: wrap;
    padding: 8px 32px; background: rgba(241,234,214,0.96); backdrop-filter: blur(6px); border-bottom: 1px solid rgba(28,22,17,0.1); }
  .tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .tab { font-family: 'DM Sans', system-ui, sans-serif; font-size: 13.5px; font-weight: 500; color: var(--ink); text-decoration: none;
    padding: 7px 15px; border-radius: var(--radius-round); border: 1px solid rgba(28,22,17,0.22); background: rgba(255,255,255,0.55); transition: background 0.12s, color 0.12s, border-color 0.12s; }
  .tab:hover { background: rgba(28,22,17,0.08); border-color: rgba(28,22,17,0.4); }
  .tab.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .tab.gov { border-width: 1.5px; border-color: rgba(138,45,58,0.6); color: #8a2d3a; background: var(--error-bg); }
  .tab.gov:hover { background: var(--error-bg); border-color: #8a2d3a; }
  .tab.gov.active { background: #8a2d3a; color: var(--paper); border-color: #8a2d3a; }

  .detail { display: inline-flex; align-items: center; gap: 7px; }
  .d-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.5); }
  .seg { display: inline-flex; background: rgba(28,22,17,0.07); padding: 2px; border-radius: var(--radius-round); border: 1px solid rgba(28,22,17,0.12); }
  .seg button { background: transparent; border: none; color: var(--ink); padding: 5px 11px; border-radius: var(--radius-round); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; cursor: pointer; }
  .seg button.on { background: var(--accent-ink); color: #fff; }

  .burger { display: none; align-items: center; gap: 8px; font-family: 'DM Sans', sans-serif; font-size: 13.5px; font-weight: 600;
    color: var(--ink); background: rgba(255,255,255,0.65); border: 1px solid rgba(28,22,17,0.28); border-radius: var(--radius-round); padding: 7px 13px; cursor: pointer; }
  .burger .bg-icon { font-size: 14px; line-height: 1; }
  .burger .bg-cur { max-width: 46vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .burger .bg-chev { font-size: 10px; color: rgba(28,22,17,0.5); transition: transform 0.15s; }
  .burger .bg-chev.open { transform: rotate(180deg); }

  .nav-scrim { position: fixed; inset: 0; z-index: 18; background: rgba(28,22,17,0.18); border: none; cursor: pointer; }
  .nav-menu { position: absolute; top: 100%; left: 0; right: 0; z-index: 19; display: flex; flex-direction: column; gap: 2px;
    background: var(--paper); border-bottom: 1px solid rgba(28,22,17,0.18);
    padding: 8px 16px 12px; max-height: 72vh; overflow-y: auto; }
  .nm-item { font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 500; color: var(--ink); text-decoration: none;
    padding: 9px 12px; border-radius: var(--radius-round); border: 1px solid transparent; }
  .nm-item:hover { background: rgba(28,22,17,0.06); }
  .nm-item.active { background: var(--ink); color: var(--paper); }

  @media (max-width: 860px) {
    .tabs { display: none; }
    .burger { display: inline-flex; }
    .secnav { padding: 7px 14px; gap: 8px 12px; }
  }
</style>
