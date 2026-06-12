<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { app } from './lib/appState.svelte';
  import { PRESETS, DEFAULT_PRESET } from './lib/presets';
  import Onboarding from './components/Onboarding.svelte';
  import StandardDetail from './components/StandardDetail.svelte';

  let { children } = $props();
  const STORAGE = 'dsd-state-v1';
  let presetOpen = $state(false);
  let helpOpen = $state(false);

  // The journey: four numbered steps. "Review" covers interoperability + impact.
  const PRIMARY = [
    { href: 'brief', label: 'Brief' },
    { href: 'schema', label: 'Schema' },
    { href: 'interoperability', label: 'Review' },
    { href: 'publish', label: 'Publish' },
  ];
  // Supporting surfaces — references & tools, deliberately lighter.
  const SECONDARY = [
    { href: 'legal', label: 'Legal basis' },
    { href: 'validate', label: 'Test data' },
    { href: 'portal', label: 'Registry' },
    { href: 'method', label: 'Method' },
  ];
  const base = '/projects/data-standard-designer';
  const pathname = $derived($page.url.pathname.replace(/\/$/, ''));
  const activeHref = $derived(pathname === base ? '' : pathname.slice(base.length + 1).split('/')[0]);
  // Review groups two routes under one step.
  const isActive = (href: string) =>
    activeHref === href || (href === 'interoperability' && activeHref === 'impact');

  function loadPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (p) app.loadDesign(p.build());
    presetOpen = false;
  }

  onMount(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.brief) app.loadDesign({ brief: s.brief, fields: s.fields || [], version: s.version });
        if (s.mode === 'analyst' || s.mode === 'architect') app.mode = s.mode;
      } else {
        // First run: load a worked example so the tool demonstrates itself.
        loadPreset(DEFAULT_PRESET);
      }
    } catch {
      loadPreset(DEFAULT_PRESET);
    }
    app.mounted = true;
    try { if (!localStorage.getItem('dsd-onboarded')) helpOpen = true; } catch { /* ignore */ }
  });

  $effect(() => {
    if (!app.mounted) return;
    // touch the reactive bits we persist
    const snapshot = { brief: app.brief, fields: app.fields, version: app.version, mode: app.mode };
    try {
      localStorage.setItem(STORAGE, JSON.stringify(snapshot));
    } catch {
      /* quota */
    }
  });

  function bandColor(v: number): string {
    if (v >= 80) return 'var(--success)';
    if (v >= 60) return '#6a8f2d';
    if (v >= 40) return 'var(--warn)';
    return 'var(--error)';
  }
</script>

<div class="dsd-page">
  <header class="dsd-top">
    <div class="dsd-top-row">
      <a class="dsd-back" href="/projects">← Projects</a>
      <a class="dsd-brand" href={base}>
        <span class="mark">⌗</span> Data Standard Designer
      </a>

      <div class="dsd-mode" role="group" aria-label="Audience mode">
        <button class:on={app.mode === 'analyst'} onclick={() => app.setMode('analyst')} title="Plain-language view for business analysts">Analyst</button>
        <button class:on={app.mode === 'architect'} onclick={() => app.setMode('architect')} title="Field-level detail for data architects">Architect</button>
      </div>

      {#if app.mounted && app.fields.length}
        <a class="dsd-score-chip" href={`${base}/interoperability`} title="Overall design quality — interoperability, assurance and adoption">
          <span class="num" style="color:{bandColor(app.overall)}">{app.overall}</span>
          <span class="lbl">design<br />score</span>
        </a>
      {/if}

      <button class="dsd-help" onclick={() => (helpOpen = true)} title="How to use this">?</button>

      <div class="dsd-preset">
        <button class="dsd-preset-btn" onclick={() => (presetOpen = !presetOpen)} aria-expanded={presetOpen}>Examples ▾</button>
        {#if presetOpen}
          <div class="dsd-preset-menu">
            {#each PRESETS as p}
              <button onclick={() => loadPreset(p.id)}>
                <b>{p.label}</b>
                <span>{p.domainLabel}</span>
              </button>
            {/each}
            <button class="reset" onclick={() => { app.reset(); presetOpen = false; }}>＋ Start blank</button>
          </div>
        {/if}
      </div>
    </div>

    <nav class="dsd-nav">
      <div class="nav-primary">
        {#each PRIMARY as s, i}
          <a href={`${base}/${s.href}`} class="dsd-tab" class:active={isActive(s.href)} data-i={String(i + 1).padStart(2, '0')}>{s.label}</a>
        {/each}
      </div>
      <span class="nav-div" aria-hidden="true">tools</span>
      <div class="nav-secondary">
        {#each SECONDARY as s}
          <a href={`${base}/${s.href}`} class="dsd-tab ref" class:active={isActive(s.href)}>{s.label}</a>
        {/each}
      </div>
    </nav>
  </header>

  <Onboarding open={helpOpen} onClose={() => (helpOpen = false)} />
  <StandardDetail />

  <main class="dsd-main">
    {@render children()}
  </main>

  <footer class="dsd-foot">
    <p class="big">A working tool, not an official standard.</p>
    <p>
      The <b>Data Standard Designer</b> proposes a dataset standard grounded in published UK and international
      government data standards. Its recommendations are decision-support, not a substitute for your own
      legal, information-governance and Open Standards Board processes. Built by John Kelly in a personal
      capacity; it does not represent the Department for Education or any government position.
    </p>
    <p class="path"><code>/projects/data-standard-designer</code> · grounded in DfE, NHS, ONS, local-gov, W3C and international standards · see the <a href={`${base}/method`}>Method &amp; sources</a>.</p>
  </footer>
</div>

<style>
  /* ----- canonical SR design tokens are global (src/app.css). Local helpers below. ----- */
  .dsd-page { min-height: 100vh; background: var(--bg); color: var(--text-primary); }

  .dsd-top { position: sticky; top: 0; z-index: 30; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(10px) saturate(1.1); border-bottom: 2px solid var(--text-primary); }
  .dsd-top-row { display: flex; align-items: center; gap: 10px 16px; flex-wrap: wrap; padding: 10px 24px; }
  .dsd-back { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
  .dsd-back:hover { color: var(--accent); }
  .dsd-brand { font-family: var(--font-brand); font-weight: 500; font-size: 16px; color: var(--text-primary); display: inline-flex; align-items: center; gap: 8px; letter-spacing: -0.01em; }
  .dsd-brand .mark { color: var(--accent); font-size: 18px; }
  .dsd-brand:hover { color: var(--accent); }

  .dsd-mode { margin-left: auto; display: inline-flex; border: 1.5px solid var(--card-border); border-radius: var(--radius-pill); overflow: hidden; }
  .dsd-mode button { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; padding: 6px 14px; background: transparent; border: none; cursor: pointer; color: var(--text-muted); }
  .dsd-mode button.on { background: var(--accent); color: #fff; }

  .dsd-score-chip { display: inline-flex; align-items: center; gap: 7px; border: 1.5px solid var(--card-border); padding: 4px 12px 4px 10px; border-radius: var(--radius-round); }
  .dsd-score-chip .num { font-family: var(--font-display); font-size: 24px; line-height: 1; }
  .dsd-score-chip .lbl { font-family: var(--font-mono); font-size: 8px; line-height: 1.1; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
  .dsd-score-chip:hover { border-color: var(--accent); }

  .dsd-help { width: 28px; height: 28px; border-radius: 50%; border: 1.5px solid var(--card-border); background: transparent; color: var(--text-muted); font-family: var(--font-mono); font-size: 13px; cursor: pointer; }
  .dsd-help:hover { border-color: var(--accent); color: var(--accent); }

  .dsd-preset { position: relative; }
  .dsd-preset-btn { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; padding: 7px 12px; background: var(--text-primary); color: var(--bg); border: none; border-radius: var(--radius-round); cursor: pointer; }
  .dsd-preset-menu { position: absolute; right: 0; top: calc(100% + 6px); width: 260px; background: var(--surface-elevated); border: 2px solid var(--text-primary); box-shadow: var(--shadow-md); z-index: 40; display: flex; flex-direction: column; }
  .dsd-preset-menu button { text-align: left; padding: 10px 12px; background: transparent; border: none; border-bottom: 1px solid var(--divider); cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
  .dsd-preset-menu button:hover { background: var(--accent-tint-08); }
  .dsd-preset-menu button b { font-size: 13px; color: var(--text-primary); }
  .dsd-preset-menu button span { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
  .dsd-preset-menu button.reset { color: var(--accent); font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; }

  .dsd-nav { display: flex; gap: 4px 6px; flex-wrap: wrap; align-items: center; padding: 0 18px; }
  .nav-primary { display: flex; gap: 2px; flex-wrap: wrap; }
  .nav-secondary { display: flex; gap: 2px; flex-wrap: wrap; }
  .nav-div { font-family: var(--font-mono); font-size: 8px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-ghost); padding: 0 10px; border-left: 1px solid var(--divider); align-self: center; height: 16px; line-height: 16px; }
  .dsd-tab { font-family: var(--font-mono); font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); padding: 9px 13px 10px; position: relative; display: inline-flex; gap: 6px; align-items: baseline; }
  .dsd-tab::before { content: attr(data-i); font-size: 8px; color: var(--text-ghost); }
  .dsd-tab:hover { color: var(--text-primary); }
  .dsd-tab.active { color: var(--text-primary); }
  .dsd-tab.active::after { content: ''; position: absolute; left: 13px; right: 13px; bottom: 0; height: 3px; background: var(--accent); }
  /* reference tabs read lighter than the numbered journey steps */
  .dsd-tab.ref { font-size: 10.5px; color: var(--text-ghost); padding: 9px 10px 10px; }
  .dsd-tab.ref:hover { color: var(--text-secondary); }
  .dsd-tab.ref.active { color: var(--text-primary); }
  .dsd-tab.ref.active::after { left: 10px; right: 10px; height: 2px; }
  @media (max-width: 640px) { .nav-div { display: none; } }

  .dsd-main { min-height: 60vh; }

  .dsd-foot { padding: 28px 24px 44px; border-top: 1px solid var(--divider); margin-top: 40px; color: var(--text-muted); max-width: 1180px; }
  .dsd-foot .big { font-family: var(--font-display); text-transform: uppercase; font-size: 15px; letter-spacing: -0.01em; color: var(--text-primary); margin: 0 0 8px; }
  .dsd-foot p { font-size: 12.5px; line-height: 1.55; max-width: 90ch; margin: 0 0 8px; }
  .dsd-foot b { color: var(--text-secondary); }
  .dsd-foot .path { font-size: 11px; color: var(--text-ghost); }
  .dsd-foot code { font-family: var(--font-mono); background: var(--card-bg); padding: 1px 5px; border-radius: 3px; }
  .dsd-foot a { color: var(--accent); border-bottom: 1px dashed currentColor; }

  @media (max-width: 720px) {
    .dsd-top-row { padding: 9px 14px; }
    .dsd-mode { margin-left: 0; }
  }

  /* ============================================================
     Shared route helpers (global so the sub-pages stay lean)
     ============================================================ */
  :global(.dsd-route) { max-width: 1180px; margin: 0 auto; padding: 28px 24px 8px; }
  :global(.dsd-route.narrow) { max-width: 880px; }
  :global(.dsd-eyebrow) { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--accent); display: block; margin-bottom: 10px; }
  :global(.dsd-h1) { font-family: var(--font-display); font-weight: 900; text-transform: uppercase; letter-spacing: -0.02em; line-height: 0.95; font-size: clamp(30px, 5vw, 52px); margin: 0 0 14px; color: var(--text-primary); }
  :global(.dsd-h2) { font-family: var(--font-body); font-weight: 700; font-size: 20px; letter-spacing: -0.01em; margin: 34px 0 12px; color: var(--text-primary); }
  :global(.dsd-h3) { font-family: var(--font-body); font-weight: 700; font-size: 15px; margin: 22px 0 8px; color: var(--text-primary); }
  :global(.dsd-lede) { font-size: 18px; line-height: 1.55; color: var(--text-secondary); max-width: 70ch; }
  :global(.dsd-prose) { font-size: 15px; line-height: 1.62; color: var(--text-secondary); max-width: 72ch; }
  :global(.dsd-prose p) { margin: 0 0 12px; }
  :global(.dsd-prose b) { color: var(--text-primary); }
  :global(.dsd-prose a) { color: var(--accent); border-bottom: 1px dashed currentColor; }

  :global(.dsd-label) { font-family: var(--font-mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); display: block; margin-bottom: 6px; }
  :global(.dsd-input), :global(.dsd-select), :global(.dsd-textarea) {
    width: 100%; box-sizing: border-box; font-family: var(--font-body); font-size: 14px; color: var(--text-primary);
    background: var(--surface-elevated); border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 9px 11px;
  }
  :global(.dsd-textarea) { resize: vertical; min-height: 70px; line-height: 1.5; }
  :global(.dsd-input:focus), :global(.dsd-select:focus), :global(.dsd-textarea:focus) { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint-14); }

  :global(.dsd-btn) { font-family: var(--font-mono); font-size: 11.5px; letter-spacing: 0.04em; text-transform: uppercase; padding: 9px 16px; background: var(--surface-elevated); color: var(--text-primary); border: 1.5px solid var(--card-border); border-radius: var(--radius-round); cursor: pointer; display: inline-flex; align-items: center; gap: 7px; transition: all 0.15s; text-decoration: none; }
  :global(.dsd-btn:hover) { border-color: var(--accent); color: var(--accent); }
  :global(.dsd-btn.primary) { background: var(--accent); color: #fff; border-color: var(--accent); }
  :global(.dsd-btn.primary:hover) { background: var(--accent-hover); color: #fff; }
  :global(.dsd-btn.dark) { background: var(--text-primary); color: var(--bg); border-color: var(--text-primary); }
  :global(.dsd-btn.dark:hover) { background: #000; color: var(--bg); }
  :global(.dsd-btn.sm) { padding: 6px 11px; font-size: 10.5px; }

  :global(.dsd-card) { background: var(--card-bg); border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 18px; }
  :global(.dsd-card.tight) { padding: 12px 14px; }

  :global(.dsd-chip) { font-family: var(--font-mono); font-size: 11px; padding: 5px 11px; border-radius: var(--radius-pill); border: 1.5px solid var(--card-border); background: transparent; color: var(--text-secondary); cursor: pointer; }
  :global(.dsd-chip.on) { background: var(--accent); color: #fff; border-color: var(--accent); }

  :global(.dsd-pill) { font-family: var(--font-mono); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; padding: 2px 7px; border-radius: var(--radius-sharp); background: var(--accent-tint-14); color: var(--accent); display: inline-block; }
  :global(.dsd-pill.warn) { background: var(--warn-bg); color: var(--warn); }
  :global(.dsd-pill.ok) { background: var(--success-bg); color: var(--success); }
  :global(.dsd-pill.muted) { background: var(--card-bg); color: var(--text-muted); }

  :global(.dsd-grid) { display: grid; gap: 18px; }
  :global(.dsd-cta-row) { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 20px 0 6px; }

  /* analyst/architect explainer note */
  :global(.dsd-note) { border-left: 3px solid var(--accent); background: var(--accent-tint-04); padding: 10px 14px; border-radius: 0 var(--radius-round) var(--radius-round) 0; font-size: 13px; line-height: 1.5; color: var(--text-secondary); margin: 12px 0; }
  :global(.dsd-note .tag) { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); display: block; margin-bottom: 3px; }
</style>
