<script lang="ts">
  // SectionNav — section tab bar + narrative toggle + mobile burger.
  // Pattern copied from data-spine/components/SectionNav.svelte. Guardrails keeps its
  // warning styling via isGuard(), not list position; the trace instrument sits outside
  // the ten sections and keeps its own CTA.
  import { app } from '../lib/appState.svelte';
  import { page } from '$app/stores';

  const B = '/projects/engine-room';
  const SECTIONS = [
    { href: B, label: 'Machine' },
    { href: `${B}/chat`, label: 'Conversation' },
    { href: `${B}/models`, label: 'Models' },
    { href: `${B}/tools`, label: 'Tools' },
    { href: `${B}/memory`, label: 'Memory' },
    { href: `${B}/research`, label: 'Research' },
    { href: `${B}/automation`, label: 'Automation' },
    { href: `${B}/building`, label: 'Building' },
    { href: `${B}/shipping`, label: 'Shipping' },
    { href: `${B}/guardrails`, label: 'Guardrails' },
  ];
  const isGuard = (href: string) => href.endsWith('/guardrails');
  const pathname = $derived($page.url.pathname.replace(/\/$/, ''));
  const active = (href: string) => pathname === href.replace(/\/$/, '');

  const TRACE_HREF = `${B}/trace`;
  const onTrace = $derived(pathname.startsWith(TRACE_HREF));
  const current = $derived(
    onTrace ? 'Trace a turn' : (SECTIONS.find((n) => active(n.href))?.label ?? 'Sections'),
  );
  let menuOpen = $state(false);
</script>

<div class="secnav">
  <nav class="tabs" aria-label="Sections">
    {#each SECTIONS as n}
      <a class="tab" class:gov={isGuard(n.href)} class:active={active(n.href)} href={n.href}>{isGuard(n.href) ? '⚖ ' : ''}{n.label}</a>
    {/each}
    <a class="tab tracelink" class:active={onTrace} href={TRACE_HREF} title="Follow one message through every stage and every layer of the stack">◧ Trace a turn</a>
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
              title="Engineering view — the full explanation, with the mechanism.">Engineering</button>
      <button class:on={app.narrative === 'eli5'} onclick={() => (app.narrative = 'eli5')}
              title="Plain English — the same thing without the jargon.">Plain English</button>
    </div>
  </div>

  {#if menuOpen}
    <button class="nav-scrim" aria-label="Close menu" onclick={() => (menuOpen = false)}></button>
    <nav class="nav-menu" aria-label="Sections">
      {#each SECTIONS as n}
        <a class="nm-item" class:active={active(n.href)} href={n.href} onclick={() => (menuOpen = false)}>{n.label}</a>
      {/each}
      <a class="nm-item tracelink" class:active={onTrace} href={TRACE_HREF} onclick={() => (menuOpen = false)}>◧ Trace a turn</a>
    </nav>
  {/if}
</div>

<style>
  .secnav { position: sticky; top: var(--topH, 0px); z-index: 12; display: flex; align-items: center; justify-content: space-between; gap: 10px 16px; flex-wrap: wrap;
    padding: 8px 32px; background: rgba(241,234,214,0.96); backdrop-filter: blur(6px); border-bottom: 1px solid rgba(28,22,17,0.1); }
  .tabs { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
  .tab { font-family: 'DM Sans', system-ui, sans-serif; font-size: 13px; font-weight: 500; color: var(--ink); text-decoration: none;
    padding: 6px 13px; border-radius: var(--radius-round); border: 1px solid rgba(28,22,17,0.22); background: rgba(255,255,255,0.55); transition: background 0.12s, color 0.12s, border-color 0.12s; }
  .tab:hover { background: rgba(28,22,17,0.08); border-color: rgba(28,22,17,0.4); }
  .tab.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .tab.gov { border-width: 1.5px; border-color: rgba(138,45,58,0.6); color: #8a2d3a; background: var(--error-bg); }
  .tab.gov:hover { background: var(--error-bg); border-color: #8a2d3a; }
  .tab.gov.active { background: #8a2d3a; color: var(--paper); border-color: #8a2d3a; }

  /* the instrument CTA — deliberately the loudest thing in the bar */
  .tab.tracelink { background: var(--accent-ink); color: #fff; border-color: var(--accent-ink); font-weight: 600; margin-left: 6px; letter-spacing: 0.01em; }
  .tab.tracelink:hover { background: #0b4a53; border-color: #0b4a53; color: #fff; }
  .tab.tracelink.active { background: var(--ink); border-color: var(--ink); color: var(--paper); }

  .detail { display: inline-flex; align-items: center; gap: 7px; }
  .d-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.5); }
  .seg { display: inline-flex; background: rgba(28,22,17,0.07); padding: 2px; border-radius: var(--radius-round); border: 1px solid rgba(28,22,17,0.12); }
  .seg button { background: transparent; border: none; color: var(--ink); padding: 5px 11px; border-radius: var(--radius-round); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; cursor: pointer; white-space: nowrap; }
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
  .nm-item.tracelink { background: var(--accent-ink); color: #fff; font-weight: 600; margin-top: 6px; }
  .nm-item.tracelink.active { background: var(--ink); color: var(--paper); }

  @media (max-width: 1100px) {
    .tabs { display: none; }
    .burger { display: inline-flex; }
    .secnav { padding: 7px 14px; gap: 8px 12px; }
  }
</style>
