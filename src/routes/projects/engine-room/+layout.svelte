<script lang="ts">
  // Layout chrome for The Engine Room — field-study shell, adapted from data-spine:
  // fonts, masthead, SectionNav, .pe-* route helpers, references footer, Ask dock.
  //
  // The Ask dock is deliberately the same machinery this study describes: retrieval over a
  // local corpus, streamed, with its sources shown. The /memory section points at it.
  import { onMount } from 'svelte';
  import { app } from './lib/appState.svelte';
  import { REFERENCES } from './lib/references';
  import SectionNav from './components/SectionNav.svelte';
  import AskModel from './components/AskModel.svelte';
  import FieldStudyNav from '$lib/components/FieldStudyNav.svelte';

  let { children } = $props();
  let askOpen = $state(false);
  let topH = $state(0);

  // Key is versioned: v1 auto-saved the old 'research' default for everyone who ever
  // visited, so honouring it would silently keep the old default for returning readers.
  onMount(() => {
    try {
      const n = localStorage.getItem('er-narrative-2');
      if (n === 'research' || n === 'eli5') app.narrative = n;
    } catch { /* ignore */ }
    app.mounted = true;
  });
  $effect(() => { if (app.mounted) { try { localStorage.setItem('er-narrative-2', app.narrative); } catch { /* ignore */ } } });
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500;600&display=swap" />
</svelte:head>

<div class="page" style="--topH:{topH}px">
  <div class="paper-grain" aria-hidden="true"></div>

  <div class="topstack" bind:clientHeight={topH}>
    <FieldStudyNav />
    <header class="masthead">
      <a class="brand" href="/projects/engine-room">The Engine Room</a>
      <span class="tagline">A SYSTEM DESCRIBING ITSELF</span>
    </header>
  </div>

  <main class="content">
    <SectionNav />
    {@render children()}
  </main>

  <footer class="foot">
    <p class="foot-personal"><b>A personal project.</b> This is one person's site, built in personal time. It is described here
      because the engineering is worth showing, not because it is a product — there is nothing to buy and nothing to sign up for.</p>
    <details class="sources-foot"><summary>Technologies and specifications referenced ({REFERENCES.length})</summary>
      <ul>{#each REFERENCES as r}<li><a href={r.url} target="_blank" rel="noopener">{r.name} ↗</a> — {r.what}</li>{/each}</ul>
    </details>
    <p class="foot-disc">The Engine Room · <code>/projects/engine-room</code> · a walkthrough of the architecture behind this site.
      <b>Deliberately incomplete:</b> credentials, keys, personal data, addresses and anything else that would be unsafe to publish are
      omitted by design. What is here is the <i>how</i> and the <i>why</i> — the mechanisms, the trade-offs, and the reasoning that put each one where it is.
      Every figure was counted from the source — most on 5 August 2026, the newest pages on 17 August 2026. Companion studies:
      <a href="/projects/data-spine">The Data Spine</a> · <a href="/projects/policy-engine">The Policy Engine</a> · <a href="/projects/dfe-data-strategy">Keystone</a>.
      Built with Claude Code.</p>
  </footer>

  {#if !askOpen}
    <button class="ask-fab" onclick={() => (askOpen = true)} title="Ask questions about how this system works">
      <span class="fab-mark">✦</span> Ask the system
    </button>
  {/if}
  {#if askOpen}
    <button class="ask-scrim" aria-label="Close" onclick={() => (askOpen = false)}></button>
    <aside class="ask-dock" role="dialog" aria-label="Ask the system">
      <header class="ask-dock-head">
        <span class="adh-title">✦ Ask the system</span>
        <span class="adh-sub">retrieval, streamed — the thing it describes</span>
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
    color: var(--ink); font-family: var(--font-body); overflow-x: hidden; overflow-x: clip;
  }
  .paper-grain { position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0.5; mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.18  0 0 0 0 0.14  0 0 0 0 0.10  0 0 0 0.07 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>"); }

  .topstack { position: sticky; top: 0; z-index: 20; background: rgba(241,234,214,0.94); backdrop-filter: blur(8px); border-bottom: 1px solid rgba(28,22,17,0.12); }
  .masthead { display: flex; align-items: center; gap: 8px 14px; flex-wrap: wrap; padding: 9px 28px 8px; }
  .brand { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body); color: var(--ink); text-decoration: none; letter-spacing: -0.01em; }
  .tagline { margin-left: auto; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.16em; text-transform: uppercase; color: rgba(28,22,17,0.42); white-space: nowrap; }

  .content { position: relative; z-index: 1; min-width: 0; }

  /* shared route helpers — the Field Study standard */
  :global(.pe-route) { padding: 26px 32px 8px; max-width: 1180px; margin: 0 auto; }
  :global(.pe-route.wide) { max-width: 1440px; }
  :global(.pe-eyebrow) { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.22em; text-transform: uppercase; color: var(--ink-soft); display: block; margin-bottom: 7px; }
  :global(.pe-h1) { font-family: var(--fs-serif); font-weight: 600; font-size: clamp(24px, 3.6vw, 36px); line-height: 1.0; letter-spacing: -0.02em; margin: 0 0 12px; color: var(--ink); }
  :global(.pe-h2) { font-family: var(--fs-serif); font-weight: 600; font-size: 20px; letter-spacing: -0.01em; margin: 30px 0 8px; color: var(--ink); }
  :global(.pe-lede) { font-size: 17px; line-height: 1.6; color: rgba(28,22,17,0.74); }
  :global(.pe-prose) { font-size: var(--fs-body-sm); line-height: 1.62; color: rgba(28,22,17,0.74); }
  :global(.pe-prose.cols) { columns: 23em; column-gap: 44px; }
  :global(.pe-prose p) { margin: 0 0 12px; break-inside: avoid; }
  :global(.pe-prose b) { color: var(--ink); }
  :global(.pe-prose a) { color: var(--accent-ink); }
  :global(.pe-prose code) { font-family: var(--font-mono); font-size: max(0.86em, var(--fs-label-xs)); background: rgba(28,22,17,0.06); padding: 1px 5px; border-radius: var(--radius-sharp); color: var(--ink); }

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
    .masthead { padding: 9px 14px 8px; gap: 6px 10px; }
    .foot { padding: 16px 14px 22px; }
    :global(.pe-route) { padding: 18px 14px 8px; }
    .tagline { display: none; }
  }

  /* ---- Ask the system: floating launcher + slide-in dock ---- */
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
