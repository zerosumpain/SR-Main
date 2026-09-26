<script lang="ts">
  // The /home family's page frame: the site bar and footer from `HealthShell`
  // (the frame /research, /news, /decks and /blog wear), an ink lede in the
  // /research register, an optional in-page tab row, and the daydream CSS
  // vocabulary (`DsVocab`) underneath — so the household room and the voice
  // log, both born under /jkai, render here without a restyle.
  //
  // The sub-pages are ROUTES and the site bar's section strip is how you move
  // between them; `tabs` is only for a view inside one page (the voice log's
  // Overview / Log).
  import type { Snippet } from 'svelte';
  import HealthShell from '$lib/components/shell/HealthShell.svelte';
  import DsVocab from '$lib/components/jkai/daydream/hub/DsVocab.svelte';

  interface SummaryCell {
    label: string;
    value: string;
    sub?: string | null;
  }
  interface Tab {
    id: string;
    label: string;
    count?: number;
  }

  let {
    path,
    kicker,
    title,
    standfirst,
    summary = [],
    tabs = [],
    active = null,
    ontab,
    footer = [],
    navBack = true,
    children,
  }: {
    /** Rendered after `strangeramblings.com`, e.g. `/home/voice`. */
    path: string;
    kicker: string;
    /** Two lines; the second is set in outline, as on /research. */
    title: [string, string];
    standfirst: string;
    /** Up to four cells on the right of the lede. */
    summary?: SummaryCell[];
    tabs?: Tab[];
    active?: string | null;
    ontab?: (id: string) => void;
    footer?: string[];
    /**
     * Whether the site bar offers "one level up". False for a household
     * viewer on /home/people: its parent, /home, is owner-only and would
     * bounce them to the front page.
     */
    navBack?: boolean;
    children: Snippet;
  } = $props();
</script>

<HealthShell {path} unifiedNav {navBack} {footer}>
  <div class="home-page">
    <section class="home-lede">
      <div class="lede-inner" class:solo={summary.length === 0}>
        <div class="lede-copy">
          <p class="eyebrow">{kicker}</p>
          <h1>{title[0]}<br /><span>{title[1]}</span></h1>
          <p class="standfirst">{standfirst}</p>
        </div>
        {#if summary.length}
          <dl class="lede-summary" style="--cells: {Math.min(summary.length, 4)}">
            {#each summary as c (c.label)}
              <div>
                <dt>{c.label}</dt>
                <dd>{c.value}</dd>
                {#if c.sub}<small>{c.sub}</small>{/if}
              </div>
            {/each}
          </dl>
        {/if}
      </div>
    </section>

    {#if tabs.length}
      <nav class="home-tabs" aria-label="Views">
        <div class="tabs-inner">
          {#each tabs as t (t.id)}
            <button
              type="button"
              class="home-tab"
              class:on={active === t.id}
              aria-current={active === t.id ? 'page' : undefined}
              onclick={() => ontab?.(t.id)}
            >
              {t.label}
              {#if t.count}<span class="tab-n">{t.count}</span>{/if}
            </button>
          {/each}
        </div>
      </nav>
    {/if}

    <DsVocab>
      {@render children()}
    </DsVocab>
  </div>
</HealthShell>

<style>
  .home-page {
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  .home-lede {
    padding: clamp(28px, 3.5vw, 48px) clamp(20px, 3vw, 44px);
    background: var(--text-primary);
    color: var(--bg);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
  }
  .lede-inner {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(420px, 0.85fr);
    align-items: end;
    gap: clamp(32px, 5vw, 72px);
    width: min(1400px, 100%);
    margin: 0 auto;
  }
  .lede-inner.solo {
    grid-template-columns: minmax(0, 1fr);
  }
  .lede-copy {
    min-width: 0;
  }
  .eyebrow {
    margin: 0 0 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2.7rem, 4.8vw, 4.5rem);
    font-weight: 900;
    line-height: 0.88;
    letter-spacing: -0.04em;
    color: var(--bg);
    text-transform: uppercase;
    text-wrap: balance;
  }
  h1 span {
    color: transparent;
    white-space: nowrap;
    -webkit-text-stroke: 1.5px var(--bg);
  }
  .standfirst {
    max-width: 56ch;
    margin: 18px 0 0;
    font-size: var(--fs-body);
    line-height: 1.5;
    color: rgba(237, 228, 212, 0.7);
  }
  .lede-summary {
    display: grid;
    grid-template-columns: repeat(var(--cells), minmax(0, 1fr));
    margin: 0;
    border-top: 1px solid rgba(237, 228, 212, 0.16);
    border-left: 1px solid rgba(237, 228, 212, 0.16);
  }
  .lede-summary > div {
    min-width: 0;
    padding: 14px;
    border-right: 1px solid rgba(237, 228, 212, 0.16);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
    background: rgba(237, 228, 212, 0.04);
  }
  .lede-summary dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
  }
  .lede-summary dd {
    margin: 8px 0 5px;
    font-family: var(--font-display);
    font-size: clamp(1.65rem, 2.4vw, 2.4rem);
    font-weight: 900;
    line-height: 0.9;
    letter-spacing: -0.03em;
    color: var(--bg);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .lede-summary small {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.3;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }

  .home-tabs {
    background: var(--surface-rail);
    border-bottom: 2px solid var(--text-primary);
  }
  .tabs-inner {
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
    width: min(1400px, 100%);
    margin: 0 auto;
    padding: 0 clamp(20px, 3vw, 44px);
  }
  .home-tab {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    white-space: nowrap;
    padding: 15px 18px;
    color: var(--text-muted);
    background: none;
    border: 0;
    border-bottom: 3px solid transparent;
    border-radius: 0;
    cursor: pointer;
  }
  .home-tab:first-child {
    padding-left: 0;
  }
  .home-tab:hover {
    color: var(--accent);
  }
  .home-tab.on {
    color: var(--text-primary);
    font-weight: 700;
    border-bottom-color: var(--accent);
  }
  .home-tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -3px;
  }
  .tab-n {
    line-height: 1;
    padding: 3px 7px;
    border-radius: var(--radius-pill);
    border: 1px solid currentcolor;
  }

  /* ——— /home helpers ———
     What the family's pages share beyond the daydream vocabulary: a framed
     chart, a two-up table pair, the flush band that holds a window picker,
     and the lead cell of a table. Declared once here, under `.home-page`, so
     no page copies them. */
  :global(.home-page .band.flush-top) {
    padding-top: 18px;
    padding-bottom: 0;
    border-top: 0;
  }
  :global(.home-page .chart) {
    border: 1px solid var(--card-border);
    background: var(--surface-card);
    padding: 16px;
    margin-top: 18px;
  }
  :global(.home-page .pair) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    gap: 18px;
  }
  :global(.home-page .pair.top) {
    align-items: start;
  }
  :global(.home-page .stack) {
    margin-top: clamp(20px, 2.4vw, 32px);
  }
  :global(.home-page .tbl td.lead) {
    color: var(--text-primary);
  }
  :global(.home-page .note.in-tbl) {
    margin: 0;
    padding: 10px 12px;
    border-top: 1px solid var(--line-hair);
  }

  @media (max-width: 900px) {
    .lede-inner {
      grid-template-columns: 1fr;
      gap: 28px;
    }
  }
  @media (max-width: 720px) {
    .home-lede {
      padding: 24px 20px;
    }
    h1 {
      font-size: clamp(2.55rem, 12vw, 3.6rem);
    }
    h1 span {
      white-space: normal;
    }
    .lede-summary {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .lede-summary > div {
      padding: 10px;
    }
    .lede-summary small {
      display: none;
    }
  }
</style>
