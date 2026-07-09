<script lang="ts">
  // Layout chrome for The Data Spine — field-study shell (adapted from policy-engine):
  // fonts, masthead, SectionNav, .pe-* route helpers, sources footer, Ask dock.
  import { onMount } from 'svelte';
  import { app } from './lib/appState.svelte';
  import { SOURCES } from './lib/sources';
  import SectionNav from './components/SectionNav.svelte';
  import AskModel from './components/AskModel.svelte';

  let { children } = $props();
  let askOpen = $state(false);
  let topH = $state(0);

  onMount(() => {
    try {
      const n = localStorage.getItem('ds-narrative');
      if (n === 'research' || n === 'eli5') app.narrative = n;
    } catch { /* ignore */ }
    app.mounted = true;
  });
  $effect(() => { if (app.mounted) { try { localStorage.setItem('ds-narrative', app.narrative); } catch { /* ignore */ } } });
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500;600&display=swap" />
</svelte:head>

<div class="page" style="--topH:{topH}px">
  <div class="paper-grain" aria-hidden="true"></div>

  <div class="topstack" bind:clientHeight={topH}>
    <header class="masthead">
      <a class="back" href="/projects" title="Back to the field studies">←&nbsp;<span class="lbl">Field studies</span></a>
      <a class="brand" href="/projects/data-spine">The Data Spine</a>
      <span class="tagline">DFE · ANNOUNCED FEB 2026 · NOT YET BUILT</span>
    </header>
  </div>

  <main class="content">
    <SectionNav />
    {@render children()}
  </main>

  <footer class="foot">
    <p class="foot-personal"><b>A personal project.</b> Built by John Kelly in a personal capacity and in his own time. It does not
      represent the Department for Education, any government or political party, or any official position, and takes no political stance.</p>
    <details class="sources-foot"><summary>Sources ({SOURCES.length}) — every factual claim is cited</summary>
      <ul>{#each SOURCES as s}<li><a href={s.url} target="_blank" rel="noopener">{s.org} ↗</a> — {s.what}</li>{/each}</ul>
    </details>
    <p class="foot-disc">The Data Spine · <code>/projects/data-spine</code> · a research interactive, <b>not an official description of any government system</b>.
      The spine has no published architecture; analysis of its design is marked as hypothesis. Companion studies:
      <a href="/projects/policy-engine/monitor">Policy Engine №4 — Monitoring</a> · <a href="/projects/dfe-data-strategy">Keystone — the data strategy</a>.
      Built autonomously with Claude Code in combination with other AI models.</p>
  </footer>

  {#if !askOpen}
    <button class="ask-fab" onclick={() => (askOpen = true)} title="Ask questions of this project's research and analysis">
      <span class="fab-mark">✦</span> Ask the project
    </button>
  {/if}
  {#if askOpen}
    <button class="ask-scrim" aria-label="Close" onclick={() => (askOpen = false)}></button>
    <aside class="ask-dock" role="dialog" aria-label="Ask the project">
      <header class="ask-dock-head">
        <span class="adh-title">✦ Ask the project</span>
        <span class="adh-sub">grounded in this project only</span>
        <button class="adh-close" onclick={() => (askOpen = false)} aria-label="Close">✕</button>
      </header>
      <div class="ask-dock-body"><AskModel /></div>
    </aside>
  {/if}
</div>

<style>
  :global(body) { margin: 0; }
  .page {
    --paper: var(--bg); --paper-deep: var(--surface-elevated); --ink: var(--text-primary); --ink-soft: var(--text-muted);
    position: relative; min-height: 100vh; background: radial-gradient(ellipse 90% 50% at 50% 0%, rgba(255,255,255,0.4), transparent 60%), var(--paper);
    color: var(--ink); font-family: 'DM Sans', system-ui, sans-serif; overflow-x: hidden; overflow-x: clip;
  }
  .paper-grain { position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0.5; mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.18  0 0 0 0 0.14  0 0 0 0 0.10  0 0 0 0.07 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>"); }

  .topstack { position: sticky; top: 0; z-index: 20; background: rgba(241,234,214,0.94); backdrop-filter: blur(8px); border-bottom: 1px solid rgba(28,22,17,0.12); }
  .masthead { display: flex; align-items: center; gap: 8px 14px; flex-wrap: wrap; padding: 9px 28px 8px; }
  .back { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft); text-decoration: none; }
  .back:hover { color: var(--ink); }
  .brand { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; color: var(--ink); text-decoration: none; letter-spacing: -0.01em; }
  .tagline { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(28,22,17,0.42); white-space: nowrap; }

  .content { position: relative; z-index: 1; min-width: 0; }

  /* shared route helpers — the Field Study standard */
  :global(.pe-route) { padding: 26px 32px 8px; max-width: 1180px; margin: 0 auto; }
  :global(.pe-route.wide) { max-width: 1440px; }
  :global(.pe-eyebrow) { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--ink-soft); display: block; margin-bottom: 7px; }
  :global(.pe-h1) { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(24px, 3.6vw, 36px); line-height: 1.0; letter-spacing: -0.02em; margin: 0 0 12px; color: var(--ink); }
  :global(.pe-h2) { font-family: 'Fraunces', serif; font-weight: 600; font-size: 20px; letter-spacing: -0.01em; margin: 30px 0 8px; color: var(--ink); }
  :global(.pe-lede) { font-size: 17px; line-height: 1.6; color: rgba(28,22,17,0.74); }
  :global(.pe-prose) { font-size: 15.5px; line-height: 1.62; color: rgba(28,22,17,0.74); }
  :global(.pe-prose.cols) { columns: 23em; column-gap: 44px; }
  :global(.pe-prose p) { margin: 0 0 12px; break-inside: avoid; }
  :global(.pe-prose b) { color: var(--ink); }
  :global(.pe-prose a) { color: var(--accent-ink); }
  :global(.pe-next) { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; color: var(--paper); background: var(--ink); padding: 8px 15px; border-radius: var(--radius-round); text-decoration: none; border: none; cursor: pointer; }
  :global(.pe-next:hover) { background: #000; }
  /* card grid used across sections */
  :global(.ds-grid) { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; margin: 14px 0; }
  :global(.ds-card) { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 14px 16px; min-width: 0; }
  :global(.ds-card h3) { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; margin: 0 0 6px; color: var(--ink); }
  :global(.ds-kicker) { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(28,22,17,0.5); }
  :global(.ds-body) { font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.74); margin: 6px 0 0; }
  :global(.ds-body b) { color: var(--ink); }

  .foot { position: relative; z-index: 1; padding: 18px 28px 26px; border-top: 1px solid rgba(28,22,17,0.08); color: rgba(28,22,17,0.5); margin-top: 24px; }
  .foot code { background: rgba(28,22,17,0.06); padding: 1px 5px; border-radius: var(--radius-sharp); color: var(--ink-soft); font-family: 'JetBrains Mono', monospace; }
  .foot-personal { margin: 0 0 10px; font-size: 12.5px; line-height: 1.5; color: var(--ink-soft); max-width: 96ch;
    padding: 8px 12px; border-left: 3px solid rgba(28,22,17,0.3); background: rgba(28,22,17,0.035); border-radius: 0 var(--radius-round) var(--radius-round) 0; }
  .foot-personal b { color: var(--ink); }
  .foot-disc { margin: 10px 0 0; font-size: 11px; line-height: 1.55; color: rgba(28,22,17,0.58); max-width: 96ch; }
  .foot-disc b { color: var(--ink-soft); } .foot-disc a { color: var(--accent-ink); }
  .sources-foot { font-size: 11.5px; }
  .sources-foot summary { cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-soft); padding: 4px 0; }
  .sources-foot ul { margin: 8px 0 4px; padding-left: 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 4px 18px; list-style: square; }
  .sources-foot li { font-size: 11px; line-height: 1.4; color: rgba(28,22,17,0.7); }
  .sources-foot a { color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; font-weight: 500; }

  @media (max-width: 760px) {
    .masthead { padding: 9px 14px 8px; gap: 6px 10px; }
    .foot { padding: 16px 14px 22px; }
    :global(.pe-route) { padding: 18px 14px 8px; }
    .tagline { display: none; }
  }

  /* ---- Ask the project: floating launcher + slide-in dock ---- */
  .ask-fab { position: fixed; z-index: 60; right: 20px; bottom: 20px; display: inline-flex; align-items: center; gap: 7px;
    font-family: 'DM Sans', sans-serif; font-size: 13.5px; font-weight: 600; color: var(--paper); background: var(--accent-ink);
    border: none; border-radius: var(--radius-pill); padding: 11px 18px; cursor: pointer; }
  .ask-fab:hover { background: var(--accent-ink-hover); }
  .fab-mark { font-size: 14px; }
  .ask-scrim { position: fixed; inset: 0; z-index: 70; background: rgba(28,22,17,0.28); border: none; cursor: pointer; }
  .ask-dock { position: fixed; z-index: 71; top: 0; right: 0; height: 100vh; width: min(460px, 94vw);
    background: var(--paper); border-left: 1px solid rgba(28,22,17,0.18);
    display: flex; flex-direction: column; }
  .ask-dock-head { display: flex; align-items: baseline; gap: 9px; padding: 13px 16px 10px; border-bottom: 1px solid rgba(28,22,17,0.12); }
  .adh-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; color: var(--ink); }
  .adh-sub { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.45); }
  .adh-close { margin-left: auto; background: none; border: none; font-size: 15px; color: rgba(28,22,17,0.5); cursor: pointer; }
  .adh-close:hover { color: var(--ink); }
  .ask-dock-body { flex: 1; min-height: 0; padding: 12px 16px 14px; display: flex; flex-direction: column; }
</style>
