<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { page } from '$app/stores';
  import { invalidateAll } from '$app/navigation';
  import { isFreshIntel, type IntelSlim } from '../lib/intelTargets';

  let { authed = false }: { authed?: boolean } = $props();

  const BASE = '/projects/dfe-data-strategy';
  const BRIEFING = { href: BASE, label: 'Briefing' };
  const UNDERSTAND = [
    { href: `${BASE}/landscape`, label: 'Landscape' },
    { href: `${BASE}/commitments`, label: 'Commitments' },
    { href: `${BASE}/strategies`, label: 'Influence map' },
    { href: `${BASE}/frameworks`, label: 'Frameworks' },
    { href: `${BASE}/legislation`, label: 'Legislation' },
    { href: `${BASE}/dfe`, label: 'DfE in context' },
    { href: `${BASE}/sector`, label: 'Sector voices' },
  ];
  const WRITE = [
    { href: `${BASE}/author`, label: '✎ Workspace', title: 'Diagnose the posture, draft the strategy, verify it, plan it — one workspace' },
    { href: `${BASE}/policy-builder`, label: 'Policy builder', title: 'Write headline policies and get a grounded appraisal' },
  ];
  const METHOD = { href: `${BASE}/method`, label: 'How it works' };

  const pathname = $derived($page.url.pathname.replace(/\/$/, ''));
  const active = (href: string) => pathname === href.replace(/\/$/, '');

  const MENU_GROUPS = [
    { label: '', items: [BRIEFING] },
    { label: '1 · Understand', items: UNDERSTAND },
    { label: '2 · Write', items: WRITE },
    { label: 'Reference', items: [METHOD] },
  ];
  const ALL = [BRIEFING, ...UNDERSTAND, ...WRITE, METHOD];
  const current = $derived(ALL.find((n) => active(n.href))?.label ?? 'Sections');
  let menuOpen = $state(false);

  // ---- on-demand intelligence scan (the radar has no page — this is its trigger) ----
  const intelItems = $derived<IntelSlim[]>($page.data.intel?.items ?? []);
  const freshCount = $derived(intelItems.filter((i) => isFreshIntel(i)).length);
  let scanning = $state(false);
  let scanNote = $state('');
  async function runScan() {
    if (scanning) return;
    scanning = true;
    scanNote = '';
    try {
      const res = await fetch('/api/dfe-data-strategy/intel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      if (res.ok) {
        const s = await res.json().catch(() => null);
        await invalidateAll();
        scanNote = s && typeof s.new === 'number' ? `✓ ${s.new} new` : '✓ swept';
      } else {
        scanNote = '⚠ scan failed';
      }
    } catch {
      scanNote = '⚠ scan failed';
    } finally {
      scanning = false;
      setTimeout(() => (scanNote = ''), 5000);
    }
  }
</script>

<div class="secnav">
  <nav class="tabs" aria-label="Sections">
    <a class="tab lone" class:active={active(BRIEFING.href)} href={BRIEFING.href}>{BRIEFING.label}</a>
    <span class="flow" aria-hidden="true">→</span>
    <div class="grp" aria-label="Step 1 — understand the landscape">
      <span class="stage" aria-hidden="true"><b>1</b>Understand</span>
      {#each UNDERSTAND as n}<a class="tab" class:active={active(n.href)} href={n.href}>{n.label}</a>{/each}
    </div>
    <span class="flow" aria-hidden="true">→</span>
    <div class="grp" aria-label="Step 2 — write the strategy">
      <span class="stage" aria-hidden="true"><b>2</b>Write</span>
      <a class="tab ws" class:active={active(WRITE[0].href)} href={WRITE[0].href} title={WRITE[0].title}>{WRITE[0].label}</a>
      <a class="tab pb" class:active={active(WRITE[1].href)} href={WRITE[1].href} title={WRITE[1].title}>{WRITE[1].label}</a>
    </div>
    <span class="flow" aria-hidden="true">→</span>
    <a class="tab method" class:active={active(METHOD.href)} href={METHOD.href}>⚙ {METHOD.label}</a>
  </nav>

  <button class="burger" onclick={() => (menuOpen = !menuOpen)} aria-expanded={menuOpen} aria-label="Sections menu">
    <span class="bg-icon" aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
    <span class="bg-cur">{current}</span>
    <span class="bg-chev" class:open={menuOpen} aria-hidden="true">▾</span>
  </button>

  <div class="right">
    {#if authed}
      <button class="scan" class:hot={freshCount > 0 && !scanning && !scanNote} onclick={runScan} disabled={scanning}
        title="Sweep GOV.UK for new intelligence now — finds surface inside the section they bear on">
        {#if scanning}◉ Scanning…{:else if scanNote}{scanNote}{:else if freshCount > 0}◉ Intel <b>{freshCount} new</b>{:else}◉ Scan intel{/if}
      </button>
    {/if}
    <div class="detail" role="group" aria-label="Explanation detail">
      <span class="d-lab">Explain it as</span>
      <div class="seg">
        <button class:on={app.narrative === 'research'} onclick={() => (app.narrative = 'research')} title="Research view — the full explanation with the evidence.">Research</button>
        <button class:on={app.narrative === 'eli5'} onclick={() => (app.narrative = 'eli5')} title="ELI5 — plain, jargon-free English.">ELI5</button>
      </div>
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
  .secnav { position: sticky; top: var(--topH, 0px); z-index: 12; display: flex; align-items: center; justify-content: space-between; gap: 10px 16px; flex-wrap: wrap;
    padding: 8px 32px; background: rgba(241,234,214,0.96); backdrop-filter: blur(6px); border-bottom: 1px solid rgba(28,22,17,0.1); }
  .tabs { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }

  /* the flow: Briefing → (1 Understand …) → (2 Write …) → How it works */
  .flow { font-size: 12px; color: rgba(28,22,17,0.35); }
  .grp { display: inline-flex; align-items: center; gap: 2px; padding: 3px 6px 3px 4px;
    border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.4); }
  .stage { display: inline-flex; align-items: center; gap: 5px; margin: 0 6px 0 4px;
    font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(28,22,17,0.5); white-space: nowrap; }
  .stage b { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px;
    border-radius: var(--radius-pill, 99px); background: var(--ink); color: var(--paper, #f1ead6); font-size: 9px; font-weight: 600; letter-spacing: 0; }

  /* tabs are quiet inside their group — only the active one is a filled button */
  .tab { font-family: 'DM Sans', system-ui, sans-serif; font-size: 13px; font-weight: 500; color: var(--ink); text-decoration: none;
    padding: 6px 11px; border-radius: var(--radius-round); border: 1px solid transparent; transition: background 0.12s, color 0.12s, border-color 0.12s; white-space: nowrap; }
  .tab:hover { background: rgba(28,22,17,0.07); }
  .tab.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .tab.lone { border-color: rgba(28,22,17,0.22); background: rgba(255,255,255,0.55); }
  .tab.lone:hover { background: rgba(28,22,17,0.08); }
  .tab.lone.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .tab.ws { color: var(--accent-ink); font-weight: 600; }
  .tab.ws:hover { background: var(--accent-ink-tint-12); }
  .tab.ws.active { background: var(--accent-ink); color: var(--paper); border-color: var(--accent-ink); }
  .tab.pb { color: #8a2d3a; }
  .tab.pb:hover { background: rgba(138,45,58,0.1); }
  .tab.pb.active { background: #8a2d3a; color: var(--paper); border-color: #8a2d3a; }
  .tab.method { border: 1px dashed rgba(28,22,17,0.25); background: transparent; color: var(--ink-soft, rgba(28,22,17,0.6)); }
  .tab.method:hover { background: rgba(28,22,17,0.05); color: var(--ink); }
  .tab.method.active { background: var(--ink); color: var(--paper); border-style: solid; }

  .right { display: inline-flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .scan { display: inline-flex; align-items: center; gap: 5px; font-family: 'JetBrains Mono', monospace; font-size: 10px; padding: 5px 11px;
    border: 1px solid rgba(28,22,17,0.25); background: rgba(255,255,255,0.55); border-radius: var(--radius-round); color: var(--ink); cursor: pointer; }
  .scan:hover { background: rgba(28,22,17,0.06); }
  .scan:disabled { opacity: 0.65; cursor: default; }
  .scan.hot { border-color: rgba(138,45,58,0.5); color: #8a2d3a; background: rgba(138,45,58,0.06); }
  .scan b { font-weight: 600; }

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

  @media (max-width: 1180px) {
    .tabs { display: none; }
    .burger { display: inline-flex; }
    .secnav { padding: 7px 14px; gap: 8px 12px; }
  }
  @media (max-width: 560px) { .d-lab { display: none; } }
</style>
