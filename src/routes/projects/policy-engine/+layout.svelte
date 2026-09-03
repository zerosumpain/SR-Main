<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { replaceState } from '$app/navigation';
  import { app } from './lib/appState.svelte';
  import { policyLevers } from '$lib/policy-engine/levers';
  import { encodeLevers, decodeLevers, tokenFromHash, loadSaved, persistSaved } from './lib/scenarios';
  import { REGION_OPTIONS } from './lib/regions';
  import { SOURCES } from './lib/sources';
  import LeverDrawer from './components/LeverDrawer.svelte';
  import PeekRail from './components/PeekRail.svelte';
  import ScenarioSelector from './components/ScenarioSelector.svelte';
  import SectionNav from './components/SectionNav.svelte';
  import Onboarding from './components/Onboarding.svelte';
  import AskModel from './components/AskModel.svelte';
  import FieldStudyNav from '$lib/components/FieldStudyNav.svelte';

  let { children } = $props();
  const STORAGE = 'whitehall-model-levers-v1';
  let copied = $state(false);
  let askOpen = $state(false); // the project-scoped "Ask the model" dock
  let topH = $state(0); // measured sticky-header height, so the levers sidebar docks right beneath it

  const pathname = $derived($page.url.pathname.replace(/\/$/, ''));
  // /neet is a field study, not a scenario page — the drawer must not auto-open there
  const isDataRoute = $derived(/\/(outcomes|population|regions)$/.test(pathname));

  onMount(() => {
    const token = tokenFromHash(location.hash);
    const fromLink = token ? decodeLevers(token) : null;
    if (fromLink) app.levers = fromLink;
    else {
      try {
        const raw = localStorage.getItem(STORAGE);
        if (raw) {
          const p = JSON.parse(raw);
          if (p && typeof p === 'object') {
            // new shape: { levers, basePreset } — legacy shape: a bare lever map
            const lv = p.levers && typeof p.levers === 'object' ? p.levers : p;
            app.levers = { ...policyLevers(), ...lv };
            if (typeof p.basePreset === 'string') app.basePreset = p.basePreset;
          }
        }
      } catch { /* ignore */ }
    }
    app.saved = loadSaved();
    try {
      const n = localStorage.getItem('epm-narrative');
      if (n === 'research' || n === 'eli5') app.narrative = n;
      const dm = localStorage.getItem('epm-drawer-mode');
      if (dm === 'closed' || dm === 'peek' || dm === 'full') { app.drawerMode = dm; app.drawerUserSet = true; }
      // show ONCE for new users; an explicit dismissal persists for good (reopen via "? How to use").
      // Back-compat: any legacy epm-onboarded-at timestamp counts as having seen it.
      const seen = localStorage.getItem('epm-onboarded') === '1' || Number(localStorage.getItem('epm-onboarded-at') || 0) > 0;
      if (!seen) app.showHelp = true;
    } catch { /* ignore */ }
    app.mounted = true;
  });
  $effect(() => { if (app.mounted) { try { localStorage.setItem('epm-narrative', app.narrative); } catch { /* ignore */ } } });
  // default the levers to a slim peek beside the data on the data pages (until the user decides otherwise)
  $effect(() => { if (app.mounted && !app.drawerUserSet) app.drawerMode = isDataRoute ? 'peek' : 'closed'; });
  $effect(() => { if (app.mounted && app.drawerUserSet) { try { localStorage.setItem('epm-drawer-mode', app.drawerMode); } catch { /* ignore */ } } });
  function setUrl(url: string) { try { replaceState(url, {}); } catch { try { history.replaceState(history.state, '', url); } catch { /* ignore */ } } }
  $effect(() => {
    if (!app.mounted) return;
    pathname;
    try { localStorage.setItem(STORAGE, JSON.stringify({ levers: app.levers, basePreset: app.basePreset })); } catch { /* quota */ }
    const enc = app.eq(app.levers, policyLevers()) ? '' : encodeLevers(app.levers);
    const want = enc ? `#s=${enc}` : '';
    if (typeof location !== 'undefined' && location.hash !== want) setUrl(enc ? `${location.pathname}${location.search}#s=${enc}` : location.pathname + location.search);
  });
  $effect(() => { if (app.mounted) persistSaved(app.saved); });

  function copyLink() {
    const url = `${location.origin}${location.pathname}#s=${encodeLevers(app.levers)}`;
    const done = () => { copied = true; setTimeout(() => (copied = false), 1700); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done).catch(() => prompt('Copy this scenario link:', url));
    else prompt('Copy this scenario link:', url);
  }
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500;600&display=swap" />
</svelte:head>

<div class="page">
  <div class="paper-grain" aria-hidden="true"></div>
  <Onboarding />

  <div class="topstack" bind:clientHeight={topH}>
    <FieldStudyNav />
    <header class="masthead">
      <a class="brand" href="/projects/policy-engine">Education Policy Modelling</a>
      <button class="levers-btn" class:on={app.drawerOpen} onclick={() => app.toggleDrawer()} title="Show or hide the policy levers beside the data">☰<span class="lbl">&nbsp;Levers</span></button>
      <span class="tagline">ENGLAND SCHOOLS · 2025–2040</span>
      <button class="help-btn" onclick={() => (app.showHelp = true)} title="How to use this">?<span class="lbl">&nbsp;How to use</span></button>
    </header>

  </div>

  <div class="shell" class:open={app.drawerOpen} class:peek={app.drawerMode === 'peek'} style="--topH:{topH}px">
    {#if app.drawerOpen}
      <button class="side-scrim" aria-label="Close levers" onclick={() => app.closeDrawer()}></button>
    {/if}
    <aside class="side" class:open={app.drawerOpen} class:peek={app.drawerMode === 'peek'}>
      {#if app.drawerOpen}
        <LeverDrawer />
      {:else if app.drawerMode === 'peek'}
        <PeekRail />
      {:else}
        <button class="spine" onclick={() => app.peekDrawer()} title="Show the policy levers"><span class="spine-txt">☰ &nbsp; Policy levers</span></button>
      {/if}
    </aside>
    <main class="content">
      <SectionNav />
      <div class="scenebar">
        <ScenarioSelector />
        <p class="scene-desc">{app.scenarioDescription}</p>
        <details class="ctrl-disc">
        <summary class="ctrl-sum">⚙ Controls</summary>
        <div class="controls">
          <div class="seg" role="group" aria-label="Horizon">{#each [2030, 2035, 2040] as h}<button class:on={app.horizon === h} onclick={() => app.setHorizon(h)}>{h}</button>{/each}</div>
          <select class="csel" class:on={app.region !== 'all'} bind:value={app.region} title="Re-base onto a region or the coastal cross-cut">{#each REGION_OPTIONS as o}<option value={o.code}>{o.name}</option>{/each}</select>
          <button class="cbtn" class:on={app.showBands} onclick={() => (app.showBands = !app.showBands)} title="110-draw Monte Carlo across every effect-size band plus a shared structural multiplier; the shaded fan on charts is P10–P90.">Uncertainty {app.showBands ? 'on' : 'off'}</button>
          {#if !app.compareB}
            <button class="cbtn" onclick={() => app.pinAsB()} title="Pin this scenario as B, then change A to compare">⇆ Compare</button>
          {:else}
            <span class="cmp-badge"><i></i>B: {app.compareB.name}</span>
            <button class="cbtn" onclick={() => app.swapAB()} title="Swap A and B">⇄</button>
            <button class="cbtn danger" onclick={() => app.clearCompare()}>✕</button>
          {/if}
          <button class="cbtn share" class:ok={copied} onclick={copyLink}>{copied ? '✓ Copied' : '↗ Copy link'}</button>
        </div>
        </details>
      </div>
      {@render children()}
    </main>
  </div>

  <footer class="foot">
    <p class="foot-personal"><b>A personal project.</b> Built independently, in a personal capacity and in personal time. It does not
      represent the Department for Education, any government or political party, or any official position, and takes no political stance.</p>
    <details class="sources-foot"><summary>Sources ({SOURCES.length}) — every input is research-backed</summary>
      <ul>{#each SOURCES as s}<li><a href={s.url} target="_blank" rel="noopener">{s.org} ↗</a> — {s.what}</li>{/each}</ul>
    </details>
    <p class="foot-disc">Education Policy Modelling · <code>/projects/policy-engine</code> · a decision-support tool, <b>not an official forecast</b>. Evidence-backed (see the {SOURCES.length} sources and the <a href="/projects/policy-engine/method">Method</a> page), but figures are estimates. Built autonomously with Claude Code in combination with other AI models.</p>
  </footer>

  <!-- Project-scoped "Ask the model" dock — present on every route, bound only to this project -->
  {#if !askOpen}
    <button class="ask-fab" onclick={() => (askOpen = true)} title="Ask questions of this project's data, evidence and model">
      <span class="fab-mark">✦</span> Ask the model
    </button>
  {/if}
  {#if askOpen}
    <button class="ask-scrim" aria-label="Close" onclick={() => (askOpen = false)}></button>
    <aside class="ask-dock" role="dialog" aria-label="Ask the model">
      <header class="ask-dock-head">
        <span class="adh-title">✦ Ask the model</span>
        <span class="adh-sub">grounded in this project only</span>
        <button class="adh-close" onclick={() => (askOpen = false)} aria-label="Close">✕</button>
      </header>
      <div class="ask-dock-body"><AskModel compact onClose={() => (askOpen = false)} /></div>
    </aside>
  {/if}
</div>

<style>
  :global(body) { margin: 0; }
  .page {
    --paper: var(--bg); --paper-deep: var(--surface-elevated); --ink: var(--text-primary); --ink-soft: var(--text-muted);
    position: relative; min-height: 100vh; background: radial-gradient(ellipse 90% 50% at 50% 0%, rgba(255,255,255,0.4), transparent 60%), var(--paper);
    color: var(--ink); font-family: var(--font-body); overflow-x: hidden; overflow-x: clip;
  }
  .paper-grain { position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0.5; mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.18  0 0 0 0 0.14  0 0 0 0 0.10  0 0 0 0.07 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>"); }

  .topstack { position: sticky; top: 0; z-index: 20; background: rgba(241,234,214,0.94); backdrop-filter: blur(8px); border-bottom: 1px solid rgba(28,22,17,0.12); }

  .masthead { display: flex; align-items: center; gap: 8px 14px; flex-wrap: wrap; padding: 9px 28px 8px; }
  .brand { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body); color: var(--ink); text-decoration: none; letter-spacing: -0.01em; }
  .levers-btn { font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 5px 11px; border-radius: var(--radius-sharp); border: 1px solid rgba(28,22,17,0.25);
    background: rgba(255,255,255,0.55); color: var(--ink); cursor: pointer; }
  .levers-btn:hover { background: rgba(255,255,255,0.85); }
  .levers-btn.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .subnav { display: flex; gap: 2px; flex-wrap: wrap; margin-left: auto; }
  .subnav a { font-family: var(--font-body); font-size: var(--fs-label); color: var(--ink-soft); text-decoration: none; padding: 5px 11px; border-radius: var(--radius-sharp); transition: background 0.12s, color 0.12s; }
  .subnav a:hover { background: rgba(28,22,17,0.06); color: var(--ink); }
  .subnav a.active { background: var(--ink); color: var(--paper); font-weight: 500; }
  .tagline { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.16em; text-transform: uppercase; color: rgba(28,22,17,0.42); white-space: nowrap; }
  .help-btn { margin-left: auto; font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 5px 10px; border-radius: var(--radius-sharp); border: 1px solid var(--success-border);
    background: var(--success-bg); color: var(--success); cursor: pointer; }
  .help-btn:hover { border-color: var(--success); }

  /* scenario controls now sit in-flow just beneath the section nav (off the sticky top line) */
  .scenebar { display: flex; align-items: center; gap: 10px 14px; flex-wrap: wrap; padding: 9px 32px; background: rgba(241,234,214,0.55); border-bottom: 1px solid rgba(28,22,17,0.1); }
  .scene-desc { flex: 1 1 320px; min-width: 240px; margin: 0; font-size: var(--fs-label-xs); line-height: 1.4; color: rgba(28,22,17,0.66);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .controls { display: inline-flex; align-items: center; gap: 6px 8px; flex-wrap: wrap; margin-left: auto; }
  /* desktop: the disclosure is transparent; mobile (≤700px): controls collapse behind it */
  .ctrl-disc { display: contents; }
  .ctrl-sum { display: none; }
  @media (max-width: 700px) {
    .ctrl-disc { display: block; margin-left: auto; }
    .ctrl-sum { display: inline-block; list-style: none; cursor: pointer; font-family: var(--font-mono); font-size: var(--fs-label-xs);
      padding: 4px 9px; border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.5); color: var(--ink); }
    .ctrl-sum::-webkit-details-marker { display: none; }
    .ctrl-disc[open] .ctrl-sum { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    .ctrl-disc .controls { margin: 8px 0 2px; }
    /* description drops to one line on its own row; selector + controls share the top row */
    .scene-desc { order: 2; flex: 1 1 100%; min-width: 0; -webkit-line-clamp: 1; margin-top: 1px; }
  }
  .seg { display: inline-flex; background: rgba(28,22,17,0.07); padding: 2px; border-radius: var(--radius-sharp); }
  .seg button { background: transparent; border: none; color: var(--ink); padding: 4px 9px; border-radius: var(--radius-sharp); font-family: var(--font-mono); font-size: var(--fs-label-xs); cursor: pointer; }
  .seg button.on { background: var(--ink); color: var(--paper); }
  .csel { background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-sharp); padding: 4px 7px; color: var(--ink); font-family: var(--font-mono); font-size: var(--fs-label-xs); cursor: pointer; max-width: 150px; }
  .csel.on { background: var(--accent-ink); color: #fff; border-color: var(--accent-ink); }
  .cbtn { background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-sharp); padding: 4px 9px; color: var(--ink); font-family: var(--font-mono); font-size: var(--fs-label-xs); cursor: pointer; }
  .cbtn:hover { background: rgba(28,22,17,0.06); }
  .cbtn.on { background: var(--accent-ink); color: #fff; border-color: var(--accent-ink); }
  .cbtn.share { border-color: var(--accent-ink); color: var(--accent-ink); } .cbtn.share.ok { border-color: var(--success); color: var(--success); }
  .cbtn.danger { border-color: var(--error-border); color: var(--error); }
  .cmp-badge { display: inline-flex; align-items: center; gap: 5px; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); background: var(--accent-ink-tint-12); border: 1px solid var(--accent-ink-tint-35); border-radius: var(--radius-sharp); padding: 3px 7px; }
  .cmp-badge i { width: 8px; height: 3px; border-radius: var(--radius-sharp); background: var(--accent-ink); }


  /* two-column app shell: the levers dock IN FLOW beside the data, so moving a slider visibly
     updates the adjacent charts. The sidebar is sticky (stays as the content scrolls); never overlays on desktop. */
  .shell { position: relative; z-index: 1; display: grid; grid-template-columns: 46px minmax(0, 1fr); transition: grid-template-columns 0.2s var(--ease-out); }
  .shell.peek { grid-template-columns: 132px minmax(0, 1fr); }
  .shell.open { grid-template-columns: 348px minmax(0, 1fr); }
  .side { position: sticky; top: var(--topH, 0px); align-self: start; height: calc(100vh - var(--topH, 0px));
    border-right: 1px solid rgba(28,22,17,0.12); background: rgba(241,234,214,0.5); overflow: hidden; }
  .side-scrim { display: none; }
  .spine { width: 46px; height: 100%; background: var(--accent-ink-tint-06); border: none; border-right: 1px solid var(--accent-ink-tint-22); cursor: pointer; padding: 0;
    animation: spineGlow 2.6s ease-in-out infinite; }
  .spine:hover { background: var(--accent-ink-tint-12); animation: none; border-right-color: var(--accent-ink); }
  @keyframes spineGlow {
    0%, 100% { border-right-color: var(--accent-ink-tint-22); }
    50% { border-right-color: var(--accent-ink); }
  }
  @media (prefers-reduced-motion: reduce) { .spine { animation: none; border-right-color: var(--accent-ink); } }
  .spine-txt { display: inline-block; writing-mode: vertical-rl; transform: rotate(180deg); margin-top: 14px; font-family: var(--font-mono);
    font-size: var(--fs-label-xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-ink); font-weight: 600; white-space: nowrap; }
  .content { min-width: 0; }
  @media (max-width: 900px) {
    /* on narrow screens the sidebar overlays (there's no room to dock); peek = hidden */
    .shell, .shell.open, .shell.peek { grid-template-columns: 1fr; }
    .side { position: fixed; left: 0; top: 0; height: 100vh; width: 0; z-index: 100; transition: width 0.2s var(--ease-out); }
    .side.open { width: min(340px, 86vw); }
    .side.peek { display: none; }
    .shell.open .side-scrim { display: block; position: fixed; inset: 0; z-index: 95; background: rgba(28,22,17,0.3); border: none; }
    .spine { display: none; }
  }

  /* shared route helpers */
  /* type scale + measures aligned to the data-convergence "Field Study" standard */
  :global(.pe-route) { padding: 26px 32px 8px; max-width: 1180px; margin: 0 auto; }
  :global(.pe-route.wide) { max-width: 1440px; }
  :global(.pe-eyebrow) { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.22em; text-transform: uppercase; color: var(--ink-soft); display: block; margin-bottom: 7px; }
  :global(.pe-h1) { font-family: var(--fs-serif); font-weight: 600; font-size: clamp(24px, 3.6vw, 36px); line-height: 1.0; letter-spacing: -0.02em; margin: 0 0 12px; color: var(--ink); }
  :global(.pe-h2) { font-family: var(--fs-serif); font-weight: 600; font-size: 20px; letter-spacing: -0.01em; margin: 30px 0 8px; color: var(--ink); }
  /* narrative spans the full content / chart-render width (per design direction) */
  :global(.pe-lede) { font-size: 17px; line-height: 1.6; color: rgba(28,22,17,0.74); }
  :global(.pe-prose) { font-size: var(--fs-body-sm); line-height: 1.62; color: rgba(28,22,17,0.74); }
  :global(.pe-prose.cols) { columns: 23em; column-gap: 44px; }
  :global(.pe-prose p) { margin: 0 0 12px; break-inside: avoid; }
  :global(.pe-prose b) { color: var(--ink); }
  :global(.pe-prose a) { color: var(--accent-ink); }
  :global(.pe-next) { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; font-family: var(--font-body); font-size: var(--fs-label); color: var(--paper); background: var(--ink); padding: 8px 15px; border-radius: var(--radius-sharp); text-decoration: none; border: none; cursor: pointer; }
  :global(.pe-next:hover) { background: #000; }

  .foot { position: relative; z-index: 1; padding: 18px 28px 26px; border-top: 1px solid rgba(28,22,17,0.08); color: rgba(28,22,17,0.5); margin-top: 24px; }
  .foot code { background: rgba(28,22,17,0.06); padding: 1px 5px; border-radius: var(--radius-sharp); color: var(--ink-soft); font-family: var(--font-mono); }
  .foot-personal { margin: 0 0 10px; font-size: var(--fs-label); line-height: 1.5; color: var(--ink-soft); max-width: 96ch;
    padding: 8px 12px; border-left: 3px solid rgba(28,22,17,0.3); background: rgba(28,22,17,0.035); border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0; }
  .foot-personal b { color: var(--ink); }
  .foot-disc { margin: 10px 0 0; font-size: var(--fs-label-xs); line-height: 1.55; color: rgba(28,22,17,0.58); max-width: 96ch; }
  .foot-disc b { color: var(--ink-soft); } .foot-disc a { color: var(--accent-ink); }
  .sources-foot { font-size: var(--fs-label-xs); }
  .sources-foot summary { cursor: pointer; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-soft); padding: 4px 0; }
  .sources-foot ul { margin: 8px 0 4px; padding-left: 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 4px 18px; list-style: square; }
  .sources-foot li { font-size: var(--fs-label-xs); line-height: 1.4; color: rgba(28,22,17,0.7); }
  .sources-foot a { color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; font-weight: 500; }

  @media (max-width: 760px) {
    .masthead { padding: 9px 14px 8px; gap: 6px 10px; } .scenebar { padding: 9px 14px; }
    .foot { padding: 16px 14px 22px; } .subnav { margin-left: 0; }
    :global(.pe-route) { padding: 18px 14px 8px; }
    .tagline { display: none; }
  }
  @media (max-width: 600px) {
    /* collapse the chrome buttons to icons so the masthead fits ~1 row */
    .levers-btn .lbl, .help-btn .lbl { display: none; }
    .brand { font-size: var(--fs-nav); }
    .help-btn, .levers-btn { padding: 5px 9px; }
  }

  /* ---- Ask the model: floating launcher + slide-in dock ---- */
  .ask-fab { position: fixed; z-index: 60; right: 20px; bottom: 20px; display: inline-flex; align-items: center; gap: 7px;
    font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--paper); background: var(--accent-ink);
    border: none; border-radius: var(--radius-pill); padding: 11px 18px; cursor: pointer; }
  .ask-fab:hover { background: var(--accent-ink-hover); }
  .fab-mark { font-size: var(--fs-nav); }
  .ask-scrim { position: fixed; inset: 0; z-index: 70; background: rgba(28,22,17,0.28); border: none; cursor: pointer; }
  .ask-dock { position: fixed; z-index: 71; top: 0; right: 0; height: 100vh; width: min(460px, 94vw);
    background: var(--paper); border-left: 1px solid rgba(28,22,17,0.18);
    display: flex; flex-direction: column; }
  .ask-dock-head { display: flex; align-items: baseline; gap: 9px; padding: 13px 16px 10px; border-bottom: 1px solid rgba(28,22,17,0.12); }
  .adh-title { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body); color: var(--ink); }
  .adh-sub { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.45); }
  .adh-close { margin-left: auto; background: none; border: none; font-size: var(--fs-body-sm); color: rgba(28,22,17,0.5); cursor: pointer; }
  .adh-close:hover { color: var(--ink); }
  .ask-dock-body { flex: 1; min-height: 0; padding: 12px 16px 14px; display: flex; flex-direction: column; }
</style>
