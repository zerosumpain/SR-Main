<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { page } from '$app/stores';

  let { authed = false }: { authed?: boolean } = $props();

  const BASE = '/projects/dfe-data-strategy';
  const BRIEFING = [{ href: BASE, label: 'Briefing' }];
  const STUDIES = [
    { href: `${BASE}/landscape`, label: 'Landscape' },
    { href: `${BASE}/strategies`, label: 'Influence map' },
    { href: `${BASE}/frameworks`, label: 'Frameworks' },
    { href: `${BASE}/legislation`, label: 'Legislation' },
    { href: `${BASE}/dfe`, label: 'DfE in context' },
    { href: `${BASE}/sector`, label: 'Sector voices' },
  ];
  const POLICYB = { href: `${BASE}/policy-builder`, label: 'Policy builder' };
  const INTEL = { href: `${BASE}/intel`, label: 'Intel radar' };
  const WORKBENCH = [
    { href: `${BASE}/workbench`, label: 'Workbench' },
    { href: `${BASE}/workbench/upload`, label: 'Upload' },
  ];
  const METHOD = { href: `${BASE}/method`, label: 'How it works' };

  const pathname = $derived($page.url.pathname.replace(/\/$/, ''));
  const active = (href: string) => pathname === href.replace(/\/$/, '');

  const MENU_GROUPS = $derived([
    { label: '', items: BRIEFING },
    { label: 'Field studies', items: STUDIES },
    { label: 'Build & track', items: [POLICYB, INTEL] },
    ...(authed ? [{ label: 'Workbench (private)', items: WORKBENCH }] : []),
    { label: 'Reference', items: [METHOD] },
  ]);
  const ALL = $derived([...BRIEFING, ...STUDIES, POLICYB, INTEL, ...(authed ? WORKBENCH : []), METHOD]);
  const current = $derived(ALL.find((n) => active(n.href))?.label ?? 'Sections');
  let menuOpen = $state(false);
</script>

<div class="secnav">
  <nav class="tabs" aria-label="Sections">
    {#each BRIEFING as n}<a class="tab" class:active={active(n.href)} href={n.href}>{n.label}</a>{/each}
    <span class="nav-sep" aria-hidden="true"></span>
    <span class="grp-lab" aria-hidden="true">Field studies</span>
    {#each STUDIES as n}<a class="tab" class:active={active(n.href)} href={n.href}>{n.label}</a>{/each}
    <span class="nav-sep" aria-hidden="true"></span>
    <a class="tab pb" class:active={active(POLICYB.href)} href={POLICYB.href} title="Write headline policies and get a grounded appraisal">✎ {POLICYB.label}</a>
    <a class="tab live" class:active={active(INTEL.href)} href={INTEL.href} title="Daily sweep of new intelligence, scored against the strategy">◉ {INTEL.label}</a>
    {#if authed}
      <span class="nav-sep" aria-hidden="true"></span>
      <span class="grp-lab" aria-hidden="true">Private</span>
      {#each WORKBENCH as n}<a class="tab wb" class:active={active(n.href)} href={n.href}>◆ {n.label}</a>{/each}
    {/if}
    <span class="nav-sep" aria-hidden="true"></span>
    <a class="tab method" class:active={active(METHOD.href)} href={METHOD.href}>⚙ {METHOD.label}</a>
  </nav>

  <button class="burger" onclick={() => (menuOpen = !menuOpen)} aria-expanded={menuOpen} aria-label="Sections menu">
    <span class="bg-icon" aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
    <span class="bg-cur">{current}</span>
    <span class="bg-chev" class:open={menuOpen} aria-hidden="true">▾</span>
  </button>

  <div class="detail" role="group" aria-label="Explanation detail">
    <span class="d-lab">Explain it as</span>
    <div class="seg">
      <button class:on={app.narrative === 'research'} onclick={() => (app.narrative = 'research')} title="Research view — the full explanation with the evidence.">Research</button>
      <button class:on={app.narrative === 'eli5'} onclick={() => (app.narrative = 'eli5')} title="ELI5 — plain, jargon-free English.">ELI5</button>
    </div>
  </div>

  {#if menuOpen}
    <button class="nav-scrim" aria-label="Close menu" onclick={() => (menuOpen = false)}></button>
    <nav class="nav-menu" aria-label="Sections">
      {#each MENU_GROUPS as g}
        {#if g.label}<span class="nm-grp">{g.label}</span>{/if}
        {#each g.items as n}
          <a class="nm-item" class:active={active(n.href)} href={n.href} onclick={() => (menuOpen = false)}>{n.label}</a>
        {/each}
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
  .nav-sep { width: 1px; height: 22px; background: rgba(28,22,17,0.2); margin: 0 6px; }
  .grp-lab { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(28,22,17,0.42); margin-right: 2px; }
  .tab.wb { border-width: 1.5px; border-color: var(--accent-ink-tint-35); color: var(--accent-ink); background: var(--accent-ink-tint-06); }
  .tab.wb:hover { background: var(--accent-ink-tint-12); border-color: var(--accent-ink); }
  .tab.wb.active { background: var(--accent-ink); color: var(--paper); border-color: var(--accent-ink); }
  .tab.pb { border-width: 1.5px; border-color: rgba(138,45,58,0.6); color: #8a2d3a; background: rgba(138,45,58,0.05); }
  .tab.pb:hover { background: rgba(138,45,58,0.12); border-color: #8a2d3a; }
  .tab.pb.active { background: #8a2d3a; color: var(--paper); border-color: #8a2d3a; }
  .tab.live { border-width: 1.5px; border-color: var(--accent-ink-tint-35); color: var(--accent-ink); background: var(--accent-ink-tint-06); }
  .tab.live:hover { background: var(--accent-ink-tint-12); border-color: var(--accent-ink); }
  .tab.live.active { background: var(--accent-ink); color: var(--paper); border-color: var(--accent-ink); }
  .tab.method { border-style: dashed; background: transparent; color: var(--ink-soft, rgba(28,22,17,0.6)); }
  .tab.method:hover { background: rgba(28,22,17,0.05); color: var(--ink); }
  .tab.method.active { background: var(--ink); color: var(--paper); border-style: solid; }

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
  .nm-grp { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(28,22,17,0.42); margin: 8px 0 2px; }
  .nm-grp:first-child { margin-top: 2px; }
  .nm-item { font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 500; color: var(--ink); text-decoration: none;
    padding: 9px 12px; border-radius: var(--radius-round); border: 1px solid transparent; }
  .nm-item:hover { background: rgba(28,22,17,0.06); }
  .nm-item.active { background: var(--ink); color: var(--paper); }

  @media (max-width: 980px) {
    .tabs { display: none; }
    .burger { display: inline-flex; }
    .secnav { padding: 7px 14px; gap: 8px 12px; }
  }
</style>
