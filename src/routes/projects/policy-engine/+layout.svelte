<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { replaceState } from '$app/navigation';
  import { app } from './lib/appState.svelte';
  import { policyLevers } from './lib/levers';
  import { encodeLevers, decodeLevers, tokenFromHash, loadSaved, persistSaved } from './lib/scenarios';
  import { REGION_OPTIONS } from './lib/regions';
  import { SOURCES } from './lib/sources';
  import LeverDrawer from './components/LeverDrawer.svelte';
  import PeekRail from './components/PeekRail.svelte';
  import ScenarioSelector from './components/ScenarioSelector.svelte';
  import SectionNav from './components/SectionNav.svelte';
  import Onboarding from './components/Onboarding.svelte';
  import AskModel from './components/AskModel.svelte';

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
    <header class="masthead">
      <a class="back" href="/projects">← Field studies</a>
      <a class="brand" href="/projects/policy-engine">Education Policy Modelling</a>
      <button class="levers-btn" class:on={app.drawerOpen} onclick={() => app.toggleDrawer()} title="Show or hide the policy levers beside the data">☰ Levers</button>
      <span class="tagline">ENGLAND SCHOOLS · 2025–2040</span>
      <button class="help-btn" onclick={() => (app.showHelp = true)} title="How to use this">? How to use</button>
    </header>

    {#if app.mounted && app.insolvencyYear}
      <div class="cliff" role="alert">⚠ <b>SEND funding cliff:</b> the DSG override ends March 2028; on this path the high-needs deficit breaches insolvency by <b>{app.insolvencyYear}</b> (£{app.horizonDeficit.toFixed(0)}bn by {app.horizon}). <a href="/projects/policy-engine/outcomes">See the deficit ↗</a></div>
    {/if}
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
        <summary class="ctrl-sum">⚙ Scenario controls</summary>
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
    <p class="foot-personal"><b>A personal project.</b> Built by John Kelly in a personal capacity and in his own time. It does not
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
      <div class="ask-dock-body"><AskModel compact /></div>
    </aside>
  {/if}
</div>

<style>
  :global(body) { margin: 0; }
  .page {
    --paper: #f1ead6; --paper-deep: #e7decc; --ink: #1c1611; --ink-soft: rgba(28,22,17,0.62);
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
  .levers-btn { font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 5px 11px; border-radius: 7px; border: 1px solid rgba(28,22,17,0.25);
    background: rgba(255,255,255,0.55); color: var(--ink); cursor: pointer; }
  .levers-btn:hover { background: rgba(255,255,255,0.85); }
  .levers-btn.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .subnav { display: flex; gap: 2px; flex-wrap: wrap; margin-left: auto; }
  .subnav a { font-family: 'DM Sans', sans-serif; font-size: 12.5px; color: var(--ink-soft); text-decoration: none; padding: 5px 11px; border-radius: 7px; transition: background 0.12s, color 0.12s; }
  .subnav a:hover { background: rgba(28,22,17,0.06); color: var(--ink); }
  .subnav a.active { background: var(--ink); color: var(--paper); font-weight: 500; }
  .tagline { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(28,22,17,0.42); white-space: nowrap; }
  .help-btn { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; padding: 5px 10px; border-radius: 7px; border: 1px solid rgba(47,125,79,0.4);
    background: rgba(47,125,79,0.08); color: #2f7d4f; cursor: pointer; }
  .help-btn:hover { background: rgba(47,125,79,0.16); }

  /* scenario controls now sit in-flow just beneath the section nav (off the sticky top line) */
  .scenebar { display: flex; align-items: center; gap: 10px 14px; flex-wrap: wrap; padding: 9px 32px; background: rgba(241,234,214,0.55); border-bottom: 1px solid rgba(28,22,17,0.1); }
  .scene-desc { flex: 1 1 320px; min-width: 240px; margin: 0; font-size: 12px; line-height: 1.4; color: rgba(28,22,17,0.66);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .controls { display: inline-flex; align-items: center; gap: 6px 8px; flex-wrap: wrap; margin-left: auto; }
  /* desktop: the disclosure is transparent; mobile (≤700px): controls collapse behind it */
  .ctrl-disc { display: contents; }
  .ctrl-sum { display: none; }
  @media (max-width: 700px) {
    .ctrl-disc { display: block; margin-left: auto; }
    .ctrl-sum { display: inline-block; list-style: none; cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 10px;
      padding: 4px 9px; border: 1px solid rgba(28,22,17,0.2); border-radius: 5px; background: rgba(255,255,255,0.5); color: var(--ink); }
    .ctrl-sum::-webkit-details-marker { display: none; }
    .ctrl-disc[open] .ctrl-sum { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    .ctrl-disc .controls { margin: 8px 0 2px; }
  }
  .seg { display: inline-flex; background: rgba(28,22,17,0.07); padding: 2px; border-radius: 6px; }
  .seg button { background: transparent; border: none; color: var(--ink); padding: 4px 9px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; cursor: pointer; }
  .seg button.on { background: var(--ink); color: var(--paper); }
  .csel { background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.2); border-radius: 5px; padding: 4px 7px; color: var(--ink); font-family: 'JetBrains Mono', monospace; font-size: 10px; cursor: pointer; max-width: 150px; }
  .csel.on { background: #4a7c7c; color: #fff; border-color: #4a7c7c; }
  .cbtn { background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.2); border-radius: 5px; padding: 4px 9px; color: var(--ink); font-family: 'JetBrains Mono', monospace; font-size: 10px; cursor: pointer; }
  .cbtn:hover { background: rgba(28,22,17,0.06); }
  .cbtn.on { background: #2f6f97; color: #fff; border-color: #2f6f97; }
  .cbtn.share { border-color: #2f6f97; color: #2f6f97; } .cbtn.share.ok { border-color: #2f7d4f; color: #2f7d4f; }
  .cbtn.danger { border-color: rgba(177,69,94,0.4); color: #b1455e; }
  .cmp-badge { display: inline-flex; align-items: center; gap: 5px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #3a5fa8; background: rgba(58,95,168,0.1); border: 1px solid rgba(58,95,168,0.3); border-radius: 5px; padding: 3px 7px; }
  .cmp-badge i { width: 8px; height: 3px; border-radius: 2px; background: #3a5fa8; }

  .cliff { margin: 4px 28px 8px; padding: 7px 12px; font-size: 12px; line-height: 1.45; border-radius: 7px; background: rgba(177,69,94,0.1); color: #8a2d3a; border: 1px solid rgba(177,69,94,0.25); }
  .cliff b { color: #6f2230; } .cliff a { color: #8a2d3a; }

  /* two-column app shell: the levers dock IN FLOW beside the data, so moving a slider visibly
     updates the adjacent charts. The sidebar is sticky (stays as the content scrolls); never overlays on desktop. */
  .shell { position: relative; z-index: 1; display: grid; grid-template-columns: 46px minmax(0, 1fr); transition: grid-template-columns 0.22s ease; }
  .shell.peek { grid-template-columns: 132px minmax(0, 1fr); }
  .shell.open { grid-template-columns: 348px minmax(0, 1fr); }
  .side { position: sticky; top: var(--topH, 0px); align-self: start; height: calc(100vh - var(--topH, 0px));
    border-right: 1px solid rgba(28,22,17,0.12); background: rgba(241,234,214,0.5); overflow: hidden; }
  .side-scrim { display: none; }
  .spine { width: 46px; height: 100%; background: rgba(63,125,110,0.06); border: none; border-right: 1px solid rgba(63,125,110,0.2); cursor: pointer; padding: 0;
    animation: spineGlow 2.6s ease-in-out infinite; }
  .spine:hover { background: rgba(63,125,110,0.14); animation: none; box-shadow: inset -2px 0 0 #3f7d6e; }
  @keyframes spineGlow {
    0%, 100% { box-shadow: inset -2px 0 0 rgba(63,125,110,0.15), 3px 0 10px -5px rgba(63,125,110,0); }
    50% { box-shadow: inset -2px 0 0 rgba(63,125,110,0.65), 3px 0 16px -3px rgba(63,125,110,0.4); }
  }
  @media (prefers-reduced-motion: reduce) { .spine { animation: none; box-shadow: inset -2px 0 0 rgba(63,125,110,0.5); } }
  .spine-txt { display: inline-block; writing-mode: vertical-rl; transform: rotate(180deg); margin-top: 14px; font-family: 'JetBrains Mono', monospace;
    font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #3a5f5f; font-weight: 600; white-space: nowrap; }
  .content { min-width: 0; }
  @media (max-width: 900px) {
    /* on narrow screens the sidebar overlays (there's no room to dock); peek = hidden */
    .shell, .shell.open, .shell.peek { grid-template-columns: 1fr; }
    .side { position: fixed; left: 0; top: 0; height: 100vh; width: 0; z-index: 100; transition: width 0.22s ease; box-shadow: 8px 0 30px -16px rgba(0,0,0,0.4); }
    .side.open { width: min(340px, 86vw); }
    .side.peek { display: none; }
    .shell.open .side-scrim { display: block; position: fixed; inset: 0; z-index: 95; background: rgba(28,22,17,0.3); border: none; }
    .spine { display: none; }
  }

  /* shared route helpers */
  /* type scale + measures aligned to the data-convergence "Field Study" standard */
  :global(.pe-route) { padding: 26px 32px 8px; max-width: 1180px; margin: 0 auto; }
  :global(.pe-route.wide) { max-width: 1440px; }
  :global(.pe-eyebrow) { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--ink-soft); display: block; margin-bottom: 7px; }
  :global(.pe-h1) { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(24px, 3.6vw, 36px); line-height: 1.0; letter-spacing: -0.02em; margin: 0 0 12px; color: var(--ink); }
  :global(.pe-h2) { font-family: 'Fraunces', serif; font-weight: 600; font-size: 20px; letter-spacing: -0.01em; margin: 30px 0 8px; color: var(--ink); }
  /* narrative spans the full content / chart-render width (per design direction) */
  :global(.pe-lede) { font-size: 17px; line-height: 1.6; color: rgba(28,22,17,0.74); }
  :global(.pe-prose) { font-size: 15.5px; line-height: 1.62; color: rgba(28,22,17,0.74); }
  :global(.pe-prose.cols) { columns: 23em; column-gap: 44px; }
  :global(.pe-prose p) { margin: 0 0 12px; break-inside: avoid; }
  :global(.pe-prose b) { color: var(--ink); }
  :global(.pe-prose a) { color: #2f6f97; }
  :global(.pe-next) { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; color: var(--paper); background: var(--ink); padding: 8px 15px; border-radius: 8px; text-decoration: none; border: none; cursor: pointer; }
  :global(.pe-next:hover) { background: #000; }

  .foot { position: relative; z-index: 1; padding: 18px 28px 26px; border-top: 1px solid rgba(28,22,17,0.08); color: rgba(28,22,17,0.5); margin-top: 24px; }
  .foot code { background: rgba(28,22,17,0.06); padding: 1px 5px; border-radius: 3px; color: var(--ink-soft); font-family: 'JetBrains Mono', monospace; }
  .foot-personal { margin: 0 0 10px; font-size: 12.5px; line-height: 1.5; color: var(--ink-soft); max-width: 96ch;
    padding: 8px 12px; border-left: 3px solid rgba(28,22,17,0.3); background: rgba(28,22,17,0.035); border-radius: 0 6px 6px 0; }
  .foot-personal b { color: var(--ink); }
  .foot-disc { margin: 10px 0 0; font-size: 11px; line-height: 1.55; color: rgba(28,22,17,0.58); max-width: 96ch; }
  .foot-disc b { color: var(--ink-soft); } .foot-disc a { color: #2f6f97; }
  .sources-foot { font-size: 11.5px; }
  .sources-foot summary { cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-soft); padding: 4px 0; }
  .sources-foot ul { margin: 8px 0 4px; padding-left: 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 4px 18px; list-style: square; }
  .sources-foot li { font-size: 11px; line-height: 1.4; color: rgba(28,22,17,0.7); }
  .sources-foot a { color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; font-weight: 500; }

  @media (max-width: 760px) {
    .masthead { padding: 9px 14px 8px; } .scenebar { padding: 9px 14px; }
    .cliff { margin: 4px 14px 8px; } .foot { padding: 16px 14px 22px; } .subnav { margin-left: 0; }
    :global(.pe-route) { padding: 18px 14px 8px; }
  }

  /* ---- Ask the model: floating launcher + slide-in dock ---- */
  .ask-fab { position: fixed; z-index: 60; right: 20px; bottom: 20px; display: inline-flex; align-items: center; gap: 7px;
    font-family: 'DM Sans', sans-serif; font-size: 13.5px; font-weight: 600; color: var(--paper, #f1ead6); background: #3f7d6e;
    border: none; border-radius: 24px; padding: 11px 18px; cursor: pointer; box-shadow: 0 6px 22px -8px rgba(63,125,110,0.7); }
  .ask-fab:hover { background: #356b5e; }
  .fab-mark { font-size: 14px; }
  .ask-scrim { position: fixed; inset: 0; z-index: 70; background: rgba(28,22,17,0.28); border: none; cursor: pointer; }
  .ask-dock { position: fixed; z-index: 71; top: 0; right: 0; height: 100vh; width: min(460px, 94vw);
    background: var(--paper, #f1ead6); border-left: 1px solid rgba(28,22,17,0.18); box-shadow: -10px 0 36px -18px rgba(0,0,0,0.45);
    display: flex; flex-direction: column; }
  .ask-dock-head { display: flex; align-items: baseline; gap: 9px; padding: 13px 16px 10px; border-bottom: 1px solid rgba(28,22,17,0.12); }
  .adh-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; color: var(--ink, #1c1611); }
  .adh-sub { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.45); }
  .adh-close { margin-left: auto; background: none; border: none; font-size: 15px; color: rgba(28,22,17,0.5); cursor: pointer; }
  .adh-close:hover { color: var(--ink, #1c1611); }
  .ask-dock-body { flex: 1; min-height: 0; padding: 12px 16px 14px; display: flex; flex-direction: column; }
</style>
