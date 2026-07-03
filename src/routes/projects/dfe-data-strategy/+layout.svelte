<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { replaceState } from '$app/navigation';
  import { app } from './lib/appState.svelte';
  import { author } from './lib/author/authorState.svelte';
  import { defaultState } from './lib/engine';
  import { encodeState, decodeState, tokenFromHash, loadSaved, persistSaved, mergeState } from './lib/scenarios';
  import { SOURCES } from './lib/sources';
  import SectionNav from './components/SectionNav.svelte';
  import LeverDrawer from './components/LeverDrawer.svelte';
  import PeekRail from './components/PeekRail.svelte';
  import ScenarioSelector from './components/ScenarioSelector.svelte';
  import AskModel from './components/AskModel.svelte';
  import PolicySuggester from './components/PolicySuggester.svelte';

  let { children, data } = $props();
  const STORAGE = 'keystone-state-v1';
  let copied = $state(false);
  let askOpen = $state(false);
  let topH = $state(0);

  const pathname = $derived($page.url.pathname.replace(/\/$/, ''));
  // the levers shell shows on the old /workbench routes AND on the workspace's Diagnose tab
  const isDiagnose = $derived(pathname.endsWith('/author') && author.tab === 'diagnose' && !!data?.authed);
  const isWorkbench = $derived(/\/workbench(\/|$)/.test(pathname + '/') || isDiagnose);
  const defJson = JSON.stringify(defaultState());

  onMount(() => {
    const token = tokenFromHash(location.hash);
    const fromLink = token ? decodeState(token) : null;
    if (fromLink) {
      app.state = fromLink;
      app.basePreset = null;
    } else {
      try {
        const raw = localStorage.getItem(STORAGE);
        if (raw) {
          const p = JSON.parse(raw);
          if (p && p.state) {
            app.state = mergeState(p.state);
            if (typeof p.basePreset === 'string' || p.basePreset === null) app.basePreset = p.basePreset;
          }
        }
      } catch { /* ignore */ }
    }
    app.saved = loadSaved();
    try {
      const raw = localStorage.getItem('keystone-policies-v1');
      if (raw) app.policies = JSON.parse(raw);
    } catch { /* ignore */ }
    try {
      const n = localStorage.getItem('keystone-narrative');
      if (n === 'research' || n === 'eli5') app.narrative = n;
      const dm = localStorage.getItem('keystone-drawer');
      if (dm === 'closed' || dm === 'peek' || dm === 'full') { app.drawerMode = dm; app.drawerUserSet = true; }
    } catch { /* ignore */ }
    app.mounted = true;
  });

  $effect(() => { if (app.mounted) { try { localStorage.setItem('keystone-narrative', app.narrative); } catch { /* ignore */ } } });
  // default the levers to a slim peek on the workbench until the user decides otherwise
  $effect(() => { if (app.mounted && !app.drawerUserSet) app.drawerMode = isWorkbench ? 'peek' : 'closed'; });
  $effect(() => { if (app.mounted && app.drawerUserSet) { try { localStorage.setItem('keystone-drawer', app.drawerMode); } catch { /* ignore */ } } });
  $effect(() => { if (app.mounted) persistSaved(app.saved); });
  $effect(() => { if (app.mounted) { try { localStorage.setItem('keystone-policies-v1', JSON.stringify(app.policies)); } catch { /* quota */ } } });

  function setUrl(url: string) { try { replaceState(url, {}); } catch { try { history.replaceState(history.state, '', url); } catch { /* ignore */ } } }
  $effect(() => {
    if (!app.mounted) return;
    pathname;
    try { localStorage.setItem(STORAGE, JSON.stringify({ state: app.state, basePreset: app.basePreset })); } catch { /* quota */ }
    if (typeof location === 'undefined') return;
    const isDefault = JSON.stringify(app.state) === defJson;
    const want = isWorkbench && !isDefault ? `#s=${encodeState(app.state)}` : '';
    if (location.hash !== want) setUrl(want ? `${location.pathname}${location.search}${want}` : location.pathname + location.search);
  });

  function copyLink() {
    const url = `${location.origin}/projects/dfe-data-strategy/author?tab=diagnose#s=${encodeState(app.state)}`;
    const done = () => { copied = true; setTimeout(() => (copied = false), 1700); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done).catch(() => prompt('Copy this strategy link:', url));
    else prompt('Copy this strategy link:', url);
  }
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500;600&display=swap" />
</svelte:head>

<div class="page">
  <div class="paper-grain" aria-hidden="true"></div>

  <div class="topstack" bind:clientHeight={topH}>
    <header class="masthead">
      <a class="back" href="/projects" title="Back to the field studies">←&nbsp;<span class="lbl">Field studies</span></a>
      <a class="brand" href="/projects/dfe-data-strategy">Keystone</a>
      {#if isWorkbench}
        <button class="levers-btn" class:on={app.drawerOpen} onclick={() => app.toggleDrawer()} title="Show or hide the strategy levers">☰<span class="lbl">&nbsp;Levers</span></button>
      {/if}
      <span class="tagline">A DfE DATA-STRATEGY WORKBENCH</span>
    </header>
    <SectionNav authed={data?.authed} />
  </div>

  {#if isWorkbench}
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
          <button class="spine" onclick={() => app.peekDrawer()} title="Show the strategy levers"><span class="spine-txt">☰ &nbsp; Strategy levers</span></button>
        {/if}
      </aside>
      <main class="content">
        <div class="scenebar">
          <ScenarioSelector />
          <p class="scene-desc">{app.scenarioDescription}</p>
          <div class="controls">
            {#if !app.compareB}
              <button class="cbtn" onclick={() => app.pinAsB()} title="Pin this strategy as B, then change A to compare">⇆ Compare</button>
            {:else}
              <span class="cmp-badge"><i></i>B: {app.compareB.name}</span>
              <button class="cbtn" onclick={() => app.swapAB()} title="Swap A and B">⇄</button>
              <button class="cbtn danger" onclick={() => app.clearCompare()}>✕</button>
            {/if}
            <button class="cbtn share" class:ok={copied} onclick={copyLink}>{copied ? '✓ Copied' : '↗ Copy link'}</button>
          </div>
        </div>
        {@render children()}
      </main>
    </div>
  {:else}
    <main class="content plain">{@render children()}</main>
  {/if}

  <footer class="foot">
    <div class="foot-inner">
      <p class="foot-personal"><b>A personal project.</b> Built by John Kelly in a personal capacity and in his own time. It does not
        represent the Department for Education, any government or political party, or any official position, and takes no political stance.</p>
      <p class="foot-disc">Keystone · <code>/projects/dfe-data-strategy</code> · a decision-support tool, <b>not an official strategy</b>. Grounded in published UK-government and industry sources — <a href="/projects/dfe-data-strategy/method#sources">all {SOURCES.length} sources</a> and the method are on <a href="/projects/dfe-data-strategy/method">How it works</a>. Companion to the <a href="/projects/policy-engine">Policy Engine</a> and <a href="/projects/dfe-data-estate">The Data Estate</a>.</p>
    </div>
  </footer>

  {#if !askOpen}
    <button class="ask-fab" onclick={() => (askOpen = true)} title="Ask questions of the data-strategy landscape, the pressures and the frameworks">
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

  <PolicySuggester />
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
  .brand { font-family: 'Fraunces', serif; font-weight: 600; font-size: 17px; color: var(--ink); text-decoration: none; letter-spacing: -0.01em; }
  .levers-btn { font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 5px 11px; border-radius: var(--radius-round); border: 1px solid rgba(28,22,17,0.25);
    background: rgba(255,255,255,0.55); color: var(--ink); cursor: pointer; }
  .levers-btn:hover { background: rgba(255,255,255,0.85); }
  .levers-btn.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .tagline { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(28,22,17,0.42); white-space: nowrap; margin-left: auto; }

  .scenebar { display: flex; align-items: center; gap: 10px 14px; flex-wrap: wrap; padding: 9px 32px; background: rgba(241,234,214,0.55); border-bottom: 1px solid rgba(28,22,17,0.1); position: sticky; top: var(--topH, 0px); z-index: 11; }
  .scene-desc { flex: 1 1 320px; min-width: 240px; margin: 0; font-size: 12px; line-height: 1.4; color: rgba(28,22,17,0.66);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .controls { display: inline-flex; align-items: center; gap: 6px 8px; flex-wrap: wrap; margin-left: auto; }
  .cbtn { background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-round); padding: 4px 9px; color: var(--ink); font-family: 'JetBrains Mono', monospace; font-size: 10px; cursor: pointer; }
  .cbtn:hover { background: rgba(28,22,17,0.06); }
  .cbtn.share { border-color: var(--accent-ink); color: var(--accent-ink); } .cbtn.share.ok { border-color: var(--success); color: var(--success); }
  .cbtn.danger { border-color: var(--error-border); color: var(--error); }
  .cmp-badge { display: inline-flex; align-items: center; gap: 5px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent-ink); background: var(--accent-ink-tint-12); border: 1px solid var(--accent-ink-tint-35); border-radius: var(--radius-round); padding: 3px 7px; }
  .cmp-badge i { width: 8px; height: 3px; border-radius: var(--radius-sharp); background: var(--accent-ink); }

  .shell { position: relative; z-index: 1; display: grid; grid-template-columns: 46px minmax(0, 1fr); transition: grid-template-columns 0.2s var(--ease-out); }
  .shell.peek { grid-template-columns: 138px minmax(0, 1fr); }
  .shell.open { grid-template-columns: 360px minmax(0, 1fr); }
  .side { position: sticky; top: var(--topH, 0px); align-self: start; height: calc(100vh - var(--topH, 0px));
    border-right: 1px solid rgba(28,22,17,0.12); background: rgba(241,234,214,0.5); overflow: hidden; }
  .side-scrim { display: none; }
  .spine { width: 46px; height: 100%; background: var(--accent-ink-tint-06); border: none; border-right: 1px solid var(--accent-ink-tint-22); cursor: pointer; padding: 0; }
  .spine:hover { background: var(--accent-ink-tint-12); border-right-color: var(--accent-ink); }
  .spine-txt { display: inline-block; writing-mode: vertical-rl; transform: rotate(180deg); margin-top: 14px; font-family: 'JetBrains Mono', monospace;
    font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-ink); font-weight: 600; white-space: nowrap; }
  .content { min-width: 0; }
  @media (max-width: 900px) {
    .shell, .shell.open, .shell.peek { grid-template-columns: 1fr; }
    .side { position: fixed; left: 0; top: 0; height: 100vh; width: 0; z-index: 100; transition: width 0.2s var(--ease-out); }
    .side.open { width: min(360px, 90vw); }
    .side.peek { display: none; }
    .shell.open .side-scrim { display: block; position: fixed; inset: 0; z-index: 95; background: rgba(28,22,17,0.3); border: none; }
    .spine { display: none; }
  }

  /* shared route helpers (warm-brutalist scale) */
  :global(.pe-route) { padding: 26px 32px 8px; max-width: 1180px; margin: 0 auto; }
  :global(.pe-route.wide) { max-width: 1440px; }
  :global(.pe-eyebrow) { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--ink-soft); display: block; margin-bottom: 7px; }
  :global(.pe-h1) { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(24px, 3.6vw, 36px); line-height: 1.0; letter-spacing: -0.02em; margin: 0 0 12px; color: var(--ink); }
  :global(.pe-h2) { font-family: 'Fraunces', serif; font-weight: 600; font-size: 20px; letter-spacing: -0.01em; margin: 30px 0 8px; color: var(--ink); }
  :global(.pe-lede) { font-size: 17px; line-height: 1.6; color: rgba(28,22,17,0.74); }
  :global(.pe-prose) { font-size: 15.5px; line-height: 1.62; color: rgba(28,22,17,0.74); }
  :global(.pe-prose p) { margin: 0 0 12px; }
  :global(.pe-prose b) { color: var(--ink); }
  :global(.pe-prose a) { color: var(--accent-ink); }
  :global(.pe-next) { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; color: var(--paper); background: var(--ink); padding: 9px 16px; border-radius: var(--radius-round); text-decoration: none; border: none; cursor: pointer; }
  :global(.pe-next:hover) { background: #000; }
  :global(.pe-card) { border: 1px solid rgba(28,22,17,0.12); background: rgba(255,255,255,0.45); border-radius: var(--radius-round); padding: 16px 18px; }
  /* one grid geometry for every card wall in the project — equal tracks, equal gaps */
  :global(.pe-grid) { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }

  /* footer content sits in the same centered container as the page content */
  .foot { position: relative; z-index: 1; padding: 18px 32px 26px; border-top: 1px solid rgba(28,22,17,0.08); color: rgba(28,22,17,0.5); margin-top: 24px; }
  .foot-inner { max-width: 1180px; margin: 0 auto; }
  .foot code { background: rgba(28,22,17,0.06); padding: 1px 5px; border-radius: var(--radius-sharp); color: var(--ink-soft); font-family: 'JetBrains Mono', monospace; }
  .foot-personal { margin: 0 0 10px; font-size: 12.5px; line-height: 1.5; color: var(--ink-soft);
    padding: 8px 12px; border-left: 3px solid rgba(28,22,17,0.3); background: rgba(28,22,17,0.035); border-radius: 0 var(--radius-round) var(--radius-round) 0; }
  .foot-personal b { color: var(--ink); }
  .foot-disc { margin: 10px 0 0; font-size: 11px; line-height: 1.55; color: rgba(28,22,17,0.58); }
  .foot-disc b { color: var(--ink-soft); } .foot-disc a { color: var(--accent-ink); }

  @media (max-width: 760px) {
    .masthead { padding: 9px 14px 8px; gap: 6px 10px; } .scenebar { padding: 9px 14px; }
    .foot { padding: 16px 14px 22px; }
    :global(.pe-route) { padding: 18px 14px 8px; }
    .tagline { display: none; }
  }

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
