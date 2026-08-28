<script lang="ts">
  // SectionNav — section tab bar + narrative toggle + mobile burger.
  // Pattern copied from data-spine/components/SectionNav.svelte; the tabs are
  // the study's own seven beats, in arc order, read off study.ts rather than
  // hand-listed, so a renamed beat cannot drift out of step with the nav.
  import { app } from '../lib/appState.svelte';
  import { page } from '$app/stores';
  import { study } from '../study';
  import { arcBeats, beatHref } from '$lib/fieldstudy/study';

  const SECTIONS = arcBeats(study).map((b) => ({ href: beatHref(study, b), label: b.name }));
  // The limits beat keeps the warning styling the reference study gives
  // governance — it is the beat a reader must not skim.
  const isWarn = (href: string) => href.endsWith('/limits');
  const pathname = $derived($page.url.pathname.replace(/\/$/, ''));
  const active = (href: string) => pathname === href.replace(/\/$/, '');
  const current = $derived(SECTIONS.find((n) => active(n.href))?.label ?? 'Sections');
  let menuOpen = $state(false);
</script>

<div class="secnav">
  <nav class="tabs" aria-label="Sections">
    {#each SECTIONS as n}
      <!-- The limits tab is marked by its claret styling alone. The reference
           study's governance tab carries a ⚖ glyph, but a warning sign renders
           as colour emoji on most platforms and the kit forbids emoji, so the
           label and the palette carry it here. -->
      <a class="tab" class:warn={isWarn(n.href)} class:active={active(n.href)} href={n.href}>{n.label}</a>
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
  .tab { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 500; color: var(--ink); text-decoration: none;
    padding: 7px 15px; border-radius: var(--radius-sharp); border: 1px solid rgba(28,22,17,0.22); background: rgba(255,255,255,0.55); transition: background 0.12s, color 0.12s, border-color 0.12s; }
  .tab:hover { background: rgba(28,22,17,0.08); border-color: rgba(28,22,17,0.4); }
  .tab.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .tab.warn { border-width: 1.5px; border-color: rgba(138,45,58,0.6); color: #8a2d3a; background: var(--error-bg); }
  .tab.warn:hover { background: var(--error-bg); border-color: #8a2d3a; }
  .tab.warn.active { background: #8a2d3a; color: var(--paper); border-color: #8a2d3a; }

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

  @media (max-width: 860px) {
    .tabs { display: none; }
    .burger { display: inline-flex; }
    .secnav { padding: 7px 14px; gap: 8px 12px; }
  }
</style>
