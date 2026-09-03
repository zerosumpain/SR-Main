<script lang="ts">
  // Shell for the bathroom planner. A slim SR bar, a cell-strip of sections,
  // and the shared store hydrated once for every route beneath it.
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { hydrate, persist, s } from './lib/state.svelte';
  import FieldStudyNav from '$lib/components/FieldStudyNav.svelte';

  let { children } = $props();

  const SECTIONS = [
    { n: '01', href: '', label: 'Start here' },
    { n: '02', href: '/ideas', label: 'Ideas' },
    { n: '03', href: '/planner', label: 'Planner' },
    { n: '04', href: '/money', label: 'Money' },
    { n: '05', href: '/trades', label: 'Who does what' },
    { n: '06', href: '/programme', label: 'Order of play' },
    { n: '07', href: '/signoff', label: 'Signing off' },
    { n: '08', href: '/brief', label: 'Your brief' },
  ];
  const BASE = '/projects/bathroom';

  if (browser) hydrate();

  const current = $derived($page.url.pathname.replace(/\/$/, ''));

  // Deep-read the store so any change schedules a write. persist() only ever
  // writes to localStorage, so there is no read-own-write cycle here.
  $effect(() => {
    JSON.stringify(s);
    persist();
  });
</script>

<svelte:head>
  <meta name="theme-color" content="#c4570a" />
</svelte:head>

<div class="bth-shell">
  <!-- The wordmark used to BE the way out (href=/projects, "Back to projects"), which
       made one element mean both "you are here" and "go up". The nav row owns the way
       out now, so the brand goes where a brand goes: this planner's own front page. -->
  <div class="bth-topnav"><FieldStudyNav /></div>

  <header class="bth-bar">
    <a class="bth-brand" href={BASE}>
      <span class="bth-monogram">sr.</span>
      <span class="bth-wordmark">Bathroom&nbsp;Planner</span>
    </a>
    <span class="bth-strap">Plan a refit in a period terrace</span>
  </header>

  <nav class="bth-nav" aria-label="Sections">
    {#each SECTIONS as sec (sec.href)}
      {@const href = BASE + sec.href}
      <a class="bth-tab" class:active={current === href} {href}>
        <span class="bth-tab-n">{sec.n}</span>{sec.label}
      </a>
    {/each}
  </nav>

  <main class="bth-main">
    {@render children?.()}
  </main>
</div>

<style>
  .bth-shell {
    min-height: 100dvh;
    background: var(--bg);
    color: var(--text-primary);
  }
  /* Matches the bar beneath it, so the two read as one header block rather than
     a strip floating on the page ground. */
  .bth-topnav {
    background: var(--surface-rail);
  }
  /* FieldStudyNav ships the paper studies' fixed 28px gutter, because their
     mastheads use one. This planner's rail is a clamp, so the home icon landed
     12px left of the "sr." wordmark directly beneath it. Re-gutter the cells
     onto the same left edge rather than change the shared component, which
     would then be wrong on the five studies that do use 28px. */
  .bth-topnav :global(.fsn) {
    padding-left: clamp(1rem, 4vw, 2.5rem);
    padding-right: clamp(1rem, 4vw, 2.5rem);
  }
  .bth-bar {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.85rem clamp(1rem, 4vw, 2.5rem);
    background: var(--surface-rail);
    border-bottom: 1px solid var(--line-strong);
  }
  .bth-brand {
    display: inline-flex;
    align-items: baseline;
    gap: 0.55rem;
    text-decoration: none;
    color: var(--text-primary);
  }
  .bth-monogram {
    font-family: var(--font-brand);
    font-weight: 500;
    color: var(--accent);
    font-size: var(--fs-body);
  }
  .bth-wordmark {
    font-family: var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    font-size: var(--fs-label);
  }
  .bth-strap {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  /* Cell strip, the site nav pattern: per-item right borders, no gaps. */
  .bth-nav {
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
    background: var(--surface-shell);
    border-bottom: 1px solid var(--line-strong);
    position: sticky;
    top: 0;
    z-index: 20;
  }
  .bth-nav::-webkit-scrollbar {
    display: none;
  }
  .bth-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.7rem 0.95rem;
    border-right: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: var(--text-muted);
    text-decoration: none;
    white-space: nowrap;
    transition: color var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out);
  }
  .bth-tab:hover {
    color: var(--text-primary);
    background: var(--accent-tint-04);
  }
  .bth-tab-n {
    color: var(--text-ghost);
  }
  .bth-tab.active {
    color: var(--text-primary);
    background: var(--bg);
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .bth-tab.active .bth-tab-n {
    color: var(--accent);
  }
  .bth-main {
    padding: clamp(1.5rem, 4vw, 3rem) clamp(1rem, 4vw, 2.5rem) 6rem;
  }

  /* ——— Content primitives, shared by every section below this layout.
     :global because the markup lives in the child routes; Svelte prunes
     scoped selectors it cannot see used in this file. ——— */
  .bth-shell :global(.bth-wrap) {
    max-width: 1180px;
    margin: 0 auto;
  }
  .bth-shell :global(.bth-stack) {
    display: flex;
    flex-direction: column;
  }
  .bth-shell :global(.g8) { gap: 0.5rem; }
  .bth-shell :global(.g12) { gap: 0.75rem; }
  .bth-shell :global(.g16) { gap: 1rem; }
  .bth-shell :global(.g24) { gap: 1.5rem; }
  .bth-shell :global(.g40) { gap: 2.5rem; }
  .bth-shell :global(.g56) { gap: 3.5rem; }

  .bth-shell :global(.bth-eyebrow) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
  }
  .bth-shell :global(.bth-h1) {
    font-family: var(--font-display);
    font-size: var(--fs-display-sm);
    line-height: 1.05;
    text-transform: uppercase;
    letter-spacing: 0.01em;
    text-wrap: balance;
    margin: 0.35rem 0 0;
  }
  .bth-shell :global(.bth-h2) {
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    line-height: 1.15;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    text-wrap: balance;
    margin: 0;
  }
  .bth-shell :global(.bth-h3) {
    font-family: var(--font-body);
    font-weight: 600;
    font-size: var(--fs-body-lg);
    line-height: 1.25;
    text-wrap: balance;
    margin: 0;
  }
  .bth-shell :global(.bth-rule) {
    height: 1px;
    background: var(--line);
    border: 0;
    margin: 0;
  }
  .bth-shell :global(.bth-prose) {
    max-width: 68ch;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .bth-shell :global(.bth-prose p),
  .bth-shell :global(.bth-body) {
    margin: 0;
    font-size: var(--fs-body);
    line-height: 1.65;
    color: var(--text-secondary);
  }
  .bth-shell :global(.bth-lead) {
    margin: 0;
    font-size: var(--fs-body-lg);
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 62ch;
  }
  .bth-shell :global(.bth-small) {
    font-size: var(--fs-nav);
    line-height: 1.55;
    color: var(--text-secondary);
  }
  .bth-shell :global(.bth-muted) { color: var(--text-muted); }
  .bth-shell :global(.bth-num) {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .bth-shell :global(.bth-card) {
    background: var(--surface-card);
    border: 1px solid var(--line);
    border-radius: var(--radius-sharp);
    padding: 1.15rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .bth-shell :global(.bth-card.accent) { border-color: var(--accent-tint-35); }
  .bth-shell :global(.bth-grid) { display: grid; gap: 1rem; }
  .bth-shell :global(.bth-grid.two) {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  }
  .bth-shell :global(.bth-grid.three) {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr));
  }

  .bth-shell :global(.bth-note) {
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    background: var(--surface-card);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    padding: 0.9rem 1.05rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .bth-shell :global(.bth-note.warn) { border-left-color: var(--warn); }
  .bth-shell :global(.bth-note.crit) { border-left-color: var(--error); }
  .bth-shell :global(.bth-note.good) { border-left-color: var(--success); }

  .bth-shell :global(.bth-ticks) {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .bth-shell :global(.bth-ticks li) {
    position: relative;
    padding-left: 1.15rem;
    font-size: var(--fs-nav);
    line-height: 1.6;
    color: var(--text-secondary);
  }
  .bth-shell :global(.bth-ticks li::before) {
    content: '';
    position: absolute;
    left: 0;
    top: 0.55em;
    width: 6px;
    height: 6px;
    background: var(--accent);
    transform: rotate(45deg);
  }
  .bth-shell :global(.bth-ol) {
    margin: 0;
    padding-left: 1.3em;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    font-size: var(--fs-nav);
    line-height: 1.6;
    color: var(--text-secondary);
  }
  .bth-shell :global(.bth-ol li::marker) {
    font-family: var(--font-mono);
    color: var(--accent);
  }

  .bth-shell :global(.bth-defs) {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .bth-shell :global(.bth-defs dt) {
    font-family: var(--font-body);
    font-weight: 600;
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
  }
  .bth-shell :global(.bth-defs dd) {
    margin: 0.15rem 0 0;
    font-size: var(--fs-nav);
    line-height: 1.6;
    color: var(--text-secondary);
  }

  .bth-shell :global(.bth-tablewrap) {
    overflow-x: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius-sharp);
    background: var(--surface-card);
  }
  .bth-shell :global(.bth-tablewrap table) {
    border-collapse: collapse;
    width: 100%;
    min-width: 520px;
    font-size: var(--fs-nav);
  }
  .bth-shell :global(.bth-tablewrap th) {
    text-align: left;
    padding: 0.55rem 0.8rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
    border-bottom: 1px solid var(--line-strong);
    white-space: nowrap;
  }
  .bth-shell :global(.bth-tablewrap td) {
    padding: 0.55rem 0.8rem;
    border-bottom: 1px solid var(--line-hair);
    vertical-align: top;
    line-height: 1.55;
    color: var(--text-secondary);
  }
  .bth-shell :global(.bth-tablewrap tr:last-child td) { border-bottom: 0; }
  .bth-shell :global(.bth-tablewrap td.n) {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--text-primary);
  }

  .bth-shell :global(.bth-pill) {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    padding: 0.1rem 0.5rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .bth-shell :global(.bth-pill.accent) {
    background: var(--accent-tint-08);
    border-color: transparent;
    color: var(--accent);
  }
  .bth-shell :global(.bth-pill.good) {
    background: var(--success-bg);
    border-color: transparent;
    color: var(--success);
  }
  .bth-shell :global(.bth-pill.warn) {
    background: var(--warn-bg);
    border-color: transparent;
    color: var(--warn);
  }
  .bth-shell :global(.bth-pill.crit) {
    background: var(--error-bg);
    border-color: transparent;
    color: var(--error);
  }
  /* A pill is a direct child of the column-flex card in several places; without
     this it stretches to the full card width and reads as a bar. */
  .bth-shell :global(.bth-card > .bth-pill) { align-self: flex-start; }

  .bth-shell :global(.bth-tiles) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
    border-top: 1px solid var(--line-strong);
    border-left: 1px solid var(--line-strong);
    background: var(--surface-card);
  }
  .bth-shell :global(.bth-tiles > div) {
    border-right: 1px solid var(--line-strong);
    border-bottom: 1px solid var(--line-strong);
    padding: 0.7rem 0.9rem;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .bth-shell :global(.bth-tiles .k) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
  }
  .bth-shell :global(.bth-tiles .v) {
    font-family: var(--font-mono);
    font-size: var(--fs-num-md);
    font-variant-numeric: tabular-nums;
    line-height: 1.15;
    color: var(--text-primary);
  }
  .bth-shell :global(.bth-tiles .s) {
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    line-height: 1.4;
  }

  .bth-shell :global(.bth-btn) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    background: var(--surface-card);
    color: var(--text-primary);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    padding: 0.4rem 0.7rem;
    cursor: pointer;
    white-space: nowrap;
    transition: border-color var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out);
  }
  .bth-shell :global(.bth-btn:hover) {
    border-color: var(--accent);
    background: var(--accent-tint-08);
  }
  .bth-shell :global(.bth-btn.primary) {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .bth-shell :global(.bth-btn.primary:hover) { background: var(--accent-hover); }
  .bth-shell :global(.bth-btn[aria-pressed='true']) {
    background: var(--accent-tint-14);
    border-color: var(--accent);
    color: var(--accent);
  }
  .bth-shell :global(.bth-btn:disabled) { opacity: 0.45; cursor: not-allowed; }
  .bth-shell :global(.bth-row) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .bth-shell :global(.bth-field) {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .bth-shell :global(.bth-field > label) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
  }
  .bth-shell :global(.bth-input) {
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    padding: 0.35rem 0.5rem;
    width: 100%;
    font-variant-numeric: tabular-nums;
  }
  .bth-shell :global(textarea.bth-input) {
    font-size: var(--fs-nav);
    line-height: 1.5;
    resize: vertical;
  }
  .bth-shell :global(.bth-check) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--fs-nav);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .bth-shell :global(input[type='checkbox']) { accent-color: var(--accent); width: 16px; height: 16px; }
  .bth-shell :global(input[type='range']) { accent-color: var(--accent); width: 100%; }
</style>
