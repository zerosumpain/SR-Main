<script lang="ts">
  // Layout chrome for The Spine in Practice — the field-study shell, taken from
  // data-spine/+layout.svelte: fonts, masthead, SectionNav, .pe-* route helpers
  // and the sources footer. The sources come off study.ts rather than a second
  // lib/sources.ts, so the footer and the citations can never disagree.
  import { onMount } from 'svelte';
  import { app } from './lib/appState.svelte';
  import { study } from './study';
  import SectionNav from './components/SectionNav.svelte';
  import FieldStudyNav from '$lib/components/FieldStudyNav.svelte';

  let { children } = $props();
  let topH = $state(0);

  onMount(() => {
    try {
      const n = localStorage.getItem('sip-narrative');
      if (n === 'research' || n === 'eli5') app.narrative = n;
    } catch { /* ignore */ }
    app.mounted = true;
  });
  $effect(() => { if (app.mounted) { try { localStorage.setItem('sip-narrative', app.narrative); } catch { /* ignore */ } } });
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
      <a class="brand" href="/projects/spine-in-practice">{study.subject ?? study.title}</a>
      <span class="tagline">{study.statusStamp}</span>
    </header>
  </div>

  <main class="content">
    <SectionNav />
    {@render children()}
  </main>

  <footer class="foot">
    <p class="foot-personal"><b>A personal project.</b> Built independently, in a personal capacity and in personal time. It does not
      represent the Department for Education, any government or political party, or any official position, and takes no political stance.
      It is not affiliated with, endorsed by, or written on behalf of Open Education AI or Edequity AI.</p>
    <details class="sources-foot"><summary>Sources ({study.sources.length}) — every factual claim is cited</summary>
      <ul>{#each study.sources as s (s.n)}<li><a href={s.url} target="_blank" rel="noopener">{s.org} ↗</a> — {s.what}</li>{/each}</ul>
    </details>
    <p class="foot-disc">{study.subject} · <code>/projects/spine-in-practice</code> · a research interactive, <b>not an official description of any government or commercial system</b>.
      It reads two published artefacts against my own earlier study; where I have inferred rather than read something, the claim is marked as a hypothesis.
      Companion studies: <a href="/projects/data-spine">The Data Spine — anatomy of a promise</a> · <a href="/projects/dfe-data-strategy">Keystone — the data strategy</a>.
      Built autonomously with Claude Code in combination with other AI models.</p>
  </footer>
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
  :global(.pe-eyebrow) { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.22em; text-transform: uppercase; color: var(--ink-soft); display: block; margin-bottom: 7px; }
  :global(.pe-h2) { font-family: var(--fs-serif); font-weight: 600; font-size: 20px; letter-spacing: -0.01em; margin: 30px 0 8px; color: var(--ink); }
  :global(.pe-prose) { font-size: var(--fs-body-sm); line-height: 1.62; color: rgba(28,22,17,0.74); }

  .foot { position: relative; z-index: 1; padding: 18px 28px 26px; border-top: 1px solid rgba(28,22,17,0.08); color: rgba(28,22,17,0.5); margin-top: 24px; }
  .foot code { background: rgba(28,22,17,0.06); padding: 1px 5px; border-radius: var(--radius-sharp); color: var(--ink-soft); font-family: var(--font-mono); }
  .foot-personal { margin: 0 0 10px; font-size: var(--fs-label); line-height: 1.5; color: var(--ink-soft); max-width: 100%;
    padding: 8px 12px; border-left: 3px solid rgba(28,22,17,0.3); background: rgba(28,22,17,0.035); border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0; }
  .foot-personal b { color: var(--ink); }
  .foot-disc { margin: 10px 0 0; font-size: var(--fs-label-xs); line-height: 1.55; color: rgba(28,22,17,0.58); max-width: 100%; }
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
</style>
