<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { replaceState } from '$app/navigation';
  import { app } from './lib/appState.svelte';
  import { policyLevers } from './lib/levers';
  import { encodeLevers, decodeLevers, tokenFromHash, loadSaved, persistSaved } from './lib/scenarios';
  import { REGION_OPTIONS } from './lib/regions';
  import { SOURCES } from './lib/sources';
  import ScenarioReadout from './components/ScenarioReadout.svelte';
  import CompareReadout from './components/CompareReadout.svelte';

  let { children } = $props();

  const STORAGE = 'whitehall-model-levers-v1';
  let lastHash = '';
  let copied = $state(false);

  const NAV = [
    { href: '/projects/policy-engine', label: 'Overview', hint: 'the story' },
    { href: '/projects/policy-engine/build', label: 'Build', hint: 'move the levers' },
    { href: '/projects/policy-engine/outcomes', label: 'Outcomes', hint: 'what happens' },
    { href: '/projects/policy-engine/population', label: 'Population', hint: 'real children' },
    { href: '/projects/policy-engine/regions', label: 'Regions', hint: 'where & to whom' },
    { href: '/projects/policy-engine/method', label: 'Method', hint: 'every calculation' },
  ];
  const pathname = $derived($page.url.pathname.replace(/\/$/, ''));

  onMount(() => {
    const token = tokenFromHash(location.hash);
    const fromLink = token ? decodeLevers(token) : null;
    if (fromLink) {
      app.levers = fromLink;
    } else {
      try {
        const raw = localStorage.getItem(STORAGE);
        if (raw) { const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object') app.levers = { ...policyLevers(), ...parsed }; }
      } catch { /* ignore */ }
    }
    app.saved = loadSaved();
    app.mounted = true;
  });

  function setUrl(url: string) {
    try { replaceState(url, {}); }
    catch { try { history.replaceState(history.state, '', url); } catch { /* ignore */ } }
  }

  $effect(() => {
    if (!app.mounted) return;
    pathname; // re-run on client-side navigation so the shareable hash follows you between pages
    try { localStorage.setItem(STORAGE, JSON.stringify(app.levers)); } catch { /* quota */ }
    const enc = app.eq(app.levers, policyLevers()) ? '' : encodeLevers(app.levers);
    const want = enc ? `#s=${enc}` : '';
    lastHash = enc;
    if (typeof location !== 'undefined' && location.hash !== want) {
      setUrl(enc ? `${location.pathname}${location.search}#s=${enc}` : location.pathname + location.search);
    }
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

  <header class="masthead">
    <a class="back" href="/projects">← Field studies</a>
    <a class="brand" href="/projects/policy-engine">Education Policy Modelling</a>
    <span class="study">FIELD STUDY №4</span>
    <nav class="subnav" aria-label="Sections">
      {#each NAV as n}
        <a class:active={pathname === n.href.replace(/\/$/, '')} href={n.href}>{n.label}</a>
      {/each}
    </nav>
  </header>

  <div class="ctrlbar">
    <div class="cg" role="group" aria-label="Horizon">
      <span class="cl">Horizon</span>
      <div class="seg">{#each [2030, 2035, 2040] as h}<button class:on={app.horizon === h} onclick={() => app.setHorizon(h)}>{h}</button>{/each}</div>
    </div>
    <div class="cg">
      <span class="cl">Region</span>
      <select class="csel" class:on={app.region !== 'all'} bind:value={app.region}>
        {#each REGION_OPTIONS as o}<option value={o.code}>{o.name}</option>{/each}
      </select>
    </div>
    <div class="cg">
      <span class="cl">View</span>
      <button class="cbtn" class:on={app.showBands} onclick={() => (app.showBands = !app.showBands)} title="Monte-Carlo P10–P90 uncertainty bands">Uncertainty {app.showBands ? 'on' : 'off'}</button>
    </div>
    <div class="cg">
      <span class="cl">Compare</span>
      {#if !app.compareB}
        <button class="cbtn" onclick={() => app.pinAsB()} title="Pin the current scenario as B, then change A to compare">Pin as B</button>
      {:else}
        <span class="cmp-badge"><i></i>B: {app.compareB.name}</span>
        <button class="cbtn" onclick={() => app.swapAB()} title="Swap A and B">⇄</button>
        <button class="cbtn danger" onclick={() => app.clearCompare()}>✕</button>
      {/if}
    </div>
    <div class="cspacer"></div>
    <span class="scn-chip"><b>{app.scenarioName}</b>{#if app.region !== 'all'} · {app.regionName}{/if}</span>
    <button class="cbtn share" class:ok={copied} onclick={copyLink}>{copied ? '✓ Copied' : '↗ Copy link'}</button>
    <button class="cbtn danger" onclick={() => app.resetAll()}>Reset</button>
  </div>

  {#if app.mounted}
    <div class="readout-shell">
      {#if app.compareB && app.viewSimB}
        <CompareReadout simA={app.viewSim} simB={app.viewSimB} nameA={app.scenarioName} nameB={app.compareB.name} horizon={app.horizon} />
      {:else}
        <ScenarioReadout sim={app.viewSim} baseSim={app.viewBase} horizon={app.horizon} scenarioName={app.scenarioName} />
      {/if}
    </div>
    {#if app.insolvencyYear}
      <div class="cliff" role="alert">
        ⚠ <b>SEND funding cliff:</b> the DSG statutory override ends March 2028. On this trajectory the high-needs deficit breaches
        the insolvency threshold by <b>{app.insolvencyYear}</b> (£{app.horizonDeficit.toFixed(0)}bn by {app.horizon}) — raise high-needs
        funding, or reform/inclusion to bend demand. <a href="/projects/policy-engine/outcomes">See the deficit ↗</a>
      </div>
    {/if}
  {/if}

  <main class="page-body">
    {@render children()}
  </main>

  <footer class="foot">
    <details class="sources-foot">
      <summary>Sources ({SOURCES.length}) — every input is research-backed</summary>
      <ul>{#each SOURCES as s}<li><a href={s.url} target="_blank" rel="noopener">{s.org} ↗</a> — {s.what}</li>{/each}</ul>
    </details>
    <p class="foot-disc">
      Education Policy Modelling · <code>/projects/policy-engine</code> · a decision-support tool, <b>not an official forecast</b>.
      Evidence-backed (see the {SOURCES.length} sources and the <a href="/projects/policy-engine/method">Method</a> page for every
      assumption and limitation), but figures are estimates. Built autonomously with Claude Code in combination with other AI models.
    </p>
  </footer>
</div>

<style>
  :global(body) { margin: 0; }
  .page {
    --paper: #f1ead6; --paper-deep: #e7decc; --ink: #1c1611; --ink-soft: rgba(28,22,17,0.62);
    position: relative; min-height: 100vh; background:
      radial-gradient(ellipse 90% 50% at 50% 0%, rgba(255,255,255,0.4), transparent 60%), var(--paper);
    color: var(--ink); font-family: 'DM Sans', system-ui, sans-serif; overflow-x: hidden; overflow-x: clip;
  }
  .paper-grain {
    position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0.5; mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.18  0 0 0 0 0.14  0 0 0 0 0.10  0 0 0 0.07 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  }

  /* sticky masthead + nav — the only sticky element, so scrolling stays single-region & intuitive */
  .masthead {
    position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 8px 14px; flex-wrap: wrap;
    padding: 9px 28px; background: rgba(241,234,214,0.92); backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(28,22,17,0.12);
  }
  .back { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft); text-decoration: none; }
  .back:hover { color: var(--ink); }
  .brand { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; color: var(--ink); text-decoration: none; letter-spacing: -0.01em; }
  .study { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.18em; color: var(--ink-soft); text-transform: uppercase; }
  .subnav { display: flex; gap: 2px; flex-wrap: wrap; margin-left: auto; }
  .subnav a {
    font-family: 'DM Sans', sans-serif; font-size: 12.5px; color: var(--ink-soft); text-decoration: none;
    padding: 5px 11px; border-radius: 7px; transition: background 0.12s, color 0.12s;
  }
  .subnav a:hover { background: rgba(28,22,17,0.06); color: var(--ink); }
  .subnav a.active { background: var(--ink); color: var(--paper); font-weight: 500; }

  .ctrlbar { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px 14px; flex-wrap: wrap;
    padding: 8px 28px; background: rgba(28,22,17,0.035); border-bottom: 1px solid rgba(28,22,17,0.08); }
  .cg { display: inline-flex; align-items: center; gap: 6px; }
  .cl { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.45); }
  .cspacer { flex: 1; }
  .seg { display: inline-flex; background: rgba(28,22,17,0.07); padding: 2px; border-radius: 6px; }
  .seg button { background: transparent; border: none; color: var(--ink); padding: 4px 10px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 11px; cursor: pointer; }
  .seg button.on { background: var(--ink); color: var(--paper); }
  .csel { background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.2); border-radius: 5px; padding: 4px 7px; color: var(--ink); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; cursor: pointer; max-width: 170px; }
  .csel.on { background: #4a7c7c; color: #fff; border-color: #4a7c7c; }
  .cbtn { background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.2); border-radius: 5px; padding: 4px 10px; color: var(--ink);
    font-family: 'JetBrains Mono', monospace; font-size: 10.5px; cursor: pointer; }
  .cbtn:hover { background: rgba(28,22,17,0.06); }
  .cbtn.on { background: #2f6f97; color: #fff; border-color: #2f6f97; }
  .cbtn.share { border-color: #2f6f97; color: #2f6f97; }
  .cbtn.share.ok { border-color: #2f7d4f; color: #2f7d4f; }
  .cbtn.danger { border-color: rgba(177,69,94,0.4); color: #b1455e; }
  .cmp-badge { display: inline-flex; align-items: center; gap: 5px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #3a5fa8; background: rgba(58,95,168,0.1); border: 1px solid rgba(58,95,168,0.3); border-radius: 5px; padding: 3px 7px; }
  .cmp-badge i { width: 8px; height: 3px; border-radius: 2px; background: #3a5fa8; }
  .scn-chip { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--ink-soft); }
  .scn-chip b { color: var(--ink); font-weight: 600; }

  .readout-shell { position: relative; z-index: 1; padding: 10px 28px 2px; }
  .cliff { position: relative; z-index: 1; margin: 8px 28px 0; padding: 8px 12px; font-size: 12px; line-height: 1.45; border-radius: 7px;
    background: rgba(177, 69, 94, 0.1); color: #8a2d3a; border: 1px solid rgba(177,69,94,0.25); }
  .cliff b { color: #6f2230; } .cliff a { color: #8a2d3a; }

  .page-body { position: relative; z-index: 1; }

  /* shared route helpers (used by every page) */
  :global(.pe-route) { padding: 24px 28px 8px; max-width: 1240px; margin: 0 auto; }
  :global(.pe-route.wide) { max-width: 1480px; }
  :global(.pe-eyebrow) { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-soft); display: block; margin-bottom: 6px; }
  :global(.pe-h1) { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(25px, 3.4vw, 36px); line-height: 1.02; letter-spacing: -0.02em; margin: 0 0 12px; color: var(--ink); }
  :global(.pe-h2) { font-family: 'Fraunces', serif; font-weight: 600; font-size: 21px; letter-spacing: -0.01em; margin: 30px 0 8px; color: var(--ink); }
  :global(.pe-lede) { font-size: 15px; line-height: 1.62; color: rgba(28,22,17,0.75); max-width: 68ch; }
  :global(.pe-prose) { font-size: 13.5px; line-height: 1.65; color: rgba(28,22,17,0.76); max-width: 70ch; }
  :global(.pe-prose p) { margin: 0 0 13px; }
  :global(.pe-prose b) { color: var(--ink); }
  :global(.pe-prose a) { color: #2f6f97; }
  :global(.pe-next) { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px;
    color: var(--paper); background: var(--ink); padding: 8px 15px; border-radius: 8px; text-decoration: none; }
  :global(.pe-next:hover) { background: #000; }
  @media (max-width: 760px) { :global(.pe-route) { padding: 18px 14px 8px; } }

  .foot { position: relative; z-index: 1; padding: 18px 28px 26px; border-top: 1px solid rgba(28,22,17,0.08); color: rgba(28,22,17,0.5); margin-top: 24px; }
  .foot code { background: rgba(28,22,17,0.06); padding: 1px 5px; border-radius: 3px; color: var(--ink-soft); font-family: 'JetBrains Mono', monospace; }
  .foot-disc { margin: 10px 0 0; font-size: 11px; line-height: 1.55; color: rgba(28,22,17,0.58); max-width: 96ch; }
  .foot-disc b { color: var(--ink-soft); } .foot-disc a { color: #2f6f97; }
  .sources-foot { font-size: 11.5px; }
  .sources-foot summary { cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-soft); padding: 4px 0; }
  .sources-foot ul { margin: 8px 0 4px; padding-left: 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 4px 18px; list-style: square; }
  .sources-foot li { font-size: 11px; line-height: 1.4; color: rgba(28,22,17,0.7); }
  .sources-foot a { color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; font-weight: 500; }

  @media (max-width: 760px) {
    .masthead { padding: 9px 14px; } .ctrlbar { padding: 8px 14px; } .readout-shell { padding: 10px 14px 2px; }
    .cliff { margin: 8px 14px 0; } .foot { padding: 16px 14px 22px; }
    .subnav { margin-left: 0; flex-basis: 100%; }
  }
</style>
