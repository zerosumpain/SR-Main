<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { page } from '$app/stores';

  const NAV = [
    { href: '/projects/policy-engine', label: 'Overview' },
    { href: '/projects/policy-engine/outcomes', label: 'Outcomes' },
    { href: '/projects/policy-engine/population', label: 'Population' },
    { href: '/projects/policy-engine/regions', label: 'Regions' },
    { href: '/projects/policy-engine/method', label: 'Method' },
  ];
  const pathname = $derived($page.url.pathname.replace(/\/$/, ''));
</script>

<div class="secnav">
  <nav class="tabs" aria-label="Sections">
    {#each NAV as n}<a class:active={pathname === n.href.replace(/\/$/, '')} href={n.href}>{n.label}</a>{/each}
  </nav>
  <div class="detail" role="group" aria-label="Explanation detail">
    <span class="d-lab">Explain it as</span>
    <div class="seg">
      <button class:on={app.narrative === 'research'} onclick={() => (app.narrative = 'research')}
              title="Research view — the full explanation with the evidence and the model mechanism.">Research</button>
      <button class:on={app.narrative === 'eli5'} onclick={() => (app.narrative = 'eli5')}
              title="ELI5 — the same thing in plain, jargon-free English.">ELI5</button>
    </div>
  </div>
</div>

<style>
  .secnav { position: sticky; top: var(--topH, 0px); z-index: 12; display: flex; align-items: center; justify-content: space-between; gap: 12px 16px; flex-wrap: wrap;
    padding: 8px 32px; background: rgba(241,234,214,0.96); backdrop-filter: blur(6px); border-bottom: 1px solid rgba(28,22,17,0.1); }
  .tabs { display: flex; gap: 4px; flex-wrap: wrap; }
  .tabs a { font-family: 'DM Sans', system-ui, sans-serif; font-size: 13px; color: var(--ink-soft, rgba(28,22,17,0.62)); text-decoration: none;
    padding: 6px 13px; border-radius: 8px; transition: background 0.12s, color 0.12s; }
  .tabs a:hover { background: rgba(28,22,17,0.06); color: var(--ink, #1c1611); }
  .tabs a.active { background: var(--ink, #1c1611); color: var(--paper, #f1ead6); font-weight: 500; }
  .detail { display: inline-flex; align-items: center; gap: 7px; }
  .d-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.5); }
  .seg { display: inline-flex; background: rgba(28,22,17,0.07); padding: 2px; border-radius: 7px; border: 1px solid rgba(28,22,17,0.12); }
  .seg button { background: transparent; border: none; color: var(--ink, #1c1611); padding: 5px 11px; border-radius: 5px; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; cursor: pointer; }
  .seg button.on { background: #3f7d6e; color: #fff; }
  @media (max-width: 760px) { .secnav { padding: 7px 14px; } }
</style>
