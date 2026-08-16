<script lang="ts">
  // SectionNav — section tab bar + narrative toggle + mobile burger
  // (pattern copied from policy-engine/components/SectionNav.svelte).
  // Governance keeps its warning styling via isGov(), not list position.
  import { app } from '../lib/appState.svelte';
  import { page } from '$app/stores';

  // The study reads as a research project: problem → sources → solutions →
  // recommendation → outcomes → governance → next steps. (The live 3-D simulation
  // lives at /federation + /federation/sim, reached from Solutions and Outcomes.)
  const SECTIONS = [
    { href: '/projects/data-spine', label: 'Problem' },
    { href: '/projects/data-spine/sources', label: 'Sources' },
    { href: '/projects/data-spine/architecture', label: 'Solutions' },
    { href: '/projects/data-spine/model', label: 'Recommendation' },
    { href: '/projects/data-spine/outcomes', label: 'Outcomes' },
    { href: '/projects/data-spine/governance', label: 'Governance' },
    { href: '/projects/data-spine/next', label: 'Next steps' },
  ];
  const isGov = (href: string) => href.endsWith('/governance');
  const pathname = $derived($page.url.pathname.replace(/\/$/, ''));
  const active = (href: string) => pathname === href.replace(/\/$/, '');
  // The two instruments live outside the 7 sections and keep their own CTAs: the 2-D
  // trace (what happens, in order, at every layer) and the 3-D simulator (the shape of
  // the whole network).
  const TRACE_HREF = '/projects/data-spine/trace';
  const SIM_HREF = '/projects/data-spine/federation/sim';
  const onTrace = $derived(pathname.startsWith(TRACE_HREF));
  const onSim = $derived(pathname.startsWith('/projects/data-spine/federation'));
  const current = $derived(
    onTrace ? 'Trace a request' : onSim ? 'Live simulator' : (SECTIONS.find((n) => active(n.href))?.label ?? 'Sections'),
  );
  let menuOpen = $state(false);
</script>

<div class="secnav">
  <nav class="tabs" aria-label="Sections">
    {#each SECTIONS as n}
      <a class="tab" class:gov={isGov(n.href)} class:active={active(n.href)} href={n.href}>{isGov(n.href) ? '⚖ ' : ''}{n.label}</a>
    {/each}
    <a class="tab tracelink" class:active={onTrace} href={TRACE_HREF} title="Trace one request through all six stages and all six layers (2-D)">◧ Trace a request</a>
    <a class="tab simlink" class:active={onSim} href={SIM_HREF} title="Open the live 3-D federation simulator">▶ Live simulator</a>
  </nav>

  <button class="burger" onclick={() => (menuOpen = !menuOpen)} aria-expanded={menuOpen} aria-label="Sections menu">
    <span class="bg-icon" aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
    <span class="bg-cur">{current}</span>
    <span class="bg-chev" class:open={menuOpen} aria-hidden="true">▾</span>
  </button>

  <!-- The trace page carries its own three-way depth control (ELI5 · Official ·
       Technical), so this two-way one would sit there doing nothing. Hide it rather
       than leave a dead control in the chrome. -->
  {#if !onTrace}
    <div class="detail" role="group" aria-label="Explanation detail">
      <span class="d-lab">Explain it as</span>
      <div class="seg">
        <button class:on={app.narrative === 'research'} onclick={() => (app.narrative = 'research')}
                title="Research view — the full explanation with the evidence.">Research</button>
        <button class:on={app.narrative === 'eli5'} onclick={() => (app.narrative = 'eli5')}
                title="ELI5 — the same thing in plain, jargon-free English.">ELI5</button>
      </div>
    </div>
  {/if}

  {#if menuOpen}
    <button class="nav-scrim" aria-label="Close menu" onclick={() => (menuOpen = false)}></button>
    <nav class="nav-menu" aria-label="Sections">
      {#each SECTIONS as n}
        <a class="nm-item" class:active={active(n.href)} href={n.href} onclick={() => (menuOpen = false)}>{n.label}</a>
      {/each}
      <a class="nm-item tracelink" class:active={onTrace} href={TRACE_HREF} onclick={() => (menuOpen = false)}>◧ Trace a request</a>
      <a class="nm-item simlink" class:active={onSim} href={SIM_HREF} onclick={() => (menuOpen = false)}>▶ Live simulator</a>
    </nav>
  {/if}
</div>

<style>
  .secnav { position: sticky; top: var(--topH, 0px); z-index: 12; display: flex; align-items: center; justify-content: space-between; gap: 12px 16px; flex-wrap: wrap;
    padding: 8px 32px; background: rgba(241,234,214,0.96); backdrop-filter: blur(6px); border-bottom: 1px solid rgba(28,22,17,0.1); }
  .tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .tab { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 500; color: var(--ink); text-decoration: none;
    padding: 7px 15px; border-radius: var(--radius-sharp); border: 1px solid rgba(28,22,17,0.22); background: rgba(255,255,255,0.55); transition: background 0.12s, color 0.12s, border-color 0.12s; }
  .tab:hover { background: rgba(28,22,17,0.08); border-color: rgba(28,22,17,0.4); }
  .tab.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .tab.gov { border-width: 1.5px; border-color: rgba(138,45,58,0.6); color: #8a2d3a; background: var(--error-bg); }
  .tab.gov:hover { background: var(--error-bg); border-color: #8a2d3a; }
  .tab.gov.active { background: #8a2d3a; color: var(--paper); border-color: #8a2d3a; }

  /* the two instrument CTAs — deliberately the loudest things in the bar */
  .tab.simlink { background: var(--accent-ink); color: #fff; border-color: var(--accent-ink); font-weight: 600; margin-left: 6px; letter-spacing: 0.01em; }
  .tab.simlink:hover { background: #0b4a53; border-color: #0b4a53; color: #fff; }
  .tab.simlink.active { background: var(--ink); border-color: var(--ink); color: var(--paper); }
  .tab.tracelink { background: #fff; color: var(--accent-ink); border-color: var(--accent-ink); border-width: 1.5px; font-weight: 600; margin-left: 8px; letter-spacing: 0.01em; }
  .tab.tracelink:hover { background: var(--accent-ink-tint-12, rgba(14,91,102,0.12)); border-color: var(--accent-ink); color: var(--accent-ink); }
  .tab.tracelink.active { background: var(--ink); border-color: var(--ink); color: var(--paper); }

  .detail { display: inline-flex; align-items: center; gap: 7px; }
  .d-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.5); }
  .seg { display: inline-flex; background: rgba(28,22,17,0.07); padding: 2px; border-radius: var(--radius-sharp); border: 1px solid rgba(28,22,17,0.12); }
  .seg button { background: transparent; border: none; color: var(--ink); padding: 5px 11px; border-radius: var(--radius-sharp); font-family: var(--font-mono); font-size: var(--fs-label-xs); cursor: pointer; }
  .seg button.on { background: var(--accent-ink); color: #fff; }

  .burger { display: none; align-items: center; gap: 8px; font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600;
    color: var(--ink); background: rgba(255,255,255,0.65); border: 1px solid rgba(28,22,17,0.28); border-radius: var(--radius-sharp); padding: 7px 13px; cursor: pointer; }
  .burger .bg-icon { font-size: var(--fs-nav); line-height: 1; }
  .burger .bg-cur { max-width: 46vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .burger .bg-chev { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); transition: transform 0.15s; }
  .burger .bg-chev.open { transform: rotate(180deg); }

  .nav-scrim { position: fixed; inset: 0; z-index: 18; background: rgba(28,22,17,0.18); border: none; cursor: pointer; }
  .nav-menu { position: absolute; top: 100%; left: 0; right: 0; z-index: 19; display: flex; flex-direction: column; gap: 2px;
    background: var(--paper); border-bottom: 1px solid rgba(28,22,17,0.18);
    padding: 8px 16px 12px; max-height: 72vh; overflow-y: auto; }
  .nm-item { font-family: var(--font-body); font-size: var(--fs-body-sm); font-weight: 500; color: var(--ink); text-decoration: none;
    padding: 9px 12px; border-radius: var(--radius-sharp); border: 1px solid transparent; }
  .nm-item:hover { background: rgba(28,22,17,0.06); }
  .nm-item.active { background: var(--ink); color: var(--paper); }
  .nm-item.simlink { background: var(--accent-ink); color: #fff; font-weight: 600; margin-top: 6px; }
  .nm-item.simlink.active { background: var(--ink); color: var(--paper); }
  .nm-item.tracelink { background: #fff; color: var(--accent-ink); border-color: var(--accent-ink); font-weight: 600; margin-top: 6px; }
  .nm-item.tracelink.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }

  @media (max-width: 860px) {
    .tabs { display: none; }
    .burger { display: inline-flex; }
    .secnav { padding: 7px 14px; gap: 8px 12px; }
  }
</style>
