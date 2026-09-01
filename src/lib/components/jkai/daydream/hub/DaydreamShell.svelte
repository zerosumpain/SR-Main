<script lang="ts">
  // The chrome the daydream hub wears: a dark masthead band, a sticky tab
  // rail, and a mono footer strip.
  //
  // Modelled on the /health owner pages (`HealthShell` + `SegmentTotals`), with
  // two deliberate differences:
  //
  //  * NO sticky site header. /health mounts one because it is a route with no
  //    chrome above it; /jkai already has `HubHeader` sitting outside the
  //    scroll container, and a second one would be two black strips arguing.
  //    What is sticky here is the TAB RAIL, which is the only thing on this
  //    page a reader needs at every scroll position.
  //  * NO grain layer. `body::after` already paints it site-wide at z-100;
  //    /health adds its own only because it needs it UNDER a header of its own.
  //
  // The masthead is the cover of the magazine: kicker, an Archivo Black
  // headline, one standfirst, the live control, and a deck of tiles that says
  // what state the engine is in before a single tab is opened.
  import type { Snippet } from 'svelte';
  import type { ShellTab } from './types';

  interface Props {
    /** Rendered after `strangeramblings.com` — `/jkai/daydreams`. */
    path: string;
    kicker: string;
    /** One entry per rendered line; the fold is a typographic decision. */
    title: string[];
    standfirst: string;
    /** Mono lines on the right of the masthead — last run, coverage, span. */
    readout?: { label: string; value: string }[];
    /** The engine's on/off, as a control rather than a banner. */
    live?: boolean;
    liveBusy?: boolean;
    ontoggleLive?: () => void;
    tabs: ShellTab[];
    active: string;
    ontab: (id: string) => void;
    /** The tile deck under the headline. Named `masthead`, not `deck`, because
     *  a snippet's name shadows the page's own bindings and the daydream page
     *  already has a `deck` — the triage cards. */
    masthead?: Snippet;
    /** The mono strip at the bottom. */
    footer?: string[];
    children: Snippet;
  }

  let {
    path,
    kicker,
    title,
    standfirst,
    readout = [],
    live = true,
    liveBusy = false,
    ontoggleLive = undefined,
    tabs,
    active,
    ontab,
    masthead = undefined,
    footer = [],
    children,
  }: Props = $props();
</script>

<div class="ds">
  <!-- ——— the cover ——————————————————————————————————————————————— -->
  <section class="ds-cover">
    <div class="ds-inner">
      <div class="ds-cover-top">
        <div class="ds-cover-left">
          <p class="ds-mark">
            <span class="ds-caret">&gt;</span> strangeramblings.com<span class="ds-path">{path}</span>
          </p>
          <p class="ds-kicker">{kicker}</p>
          <h1 class="ds-title">
            {#each title as line, i (i)}{#if i > 0}<br />{/if}{line}{/each}
          </h1>
          <p class="ds-standfirst">{standfirst}</p>
        </div>

        <div class="ds-cover-right">
          {#if ontoggleLive}
            <button
              type="button"
              class="ds-power"
              class:off={!live}
              disabled={liveBusy}
              aria-pressed={live}
              title={live
                ? 'Daydreaming is on — pause everything'
                : 'Daydreaming is paused — resume it'}
              onclick={ontoggleLive}
            >
              <span class="ds-dot"></span>
              {liveBusy ? 'saving…' : live ? 'live' : 'paused'}
            </button>
          {/if}
          {#each readout as r (r.label)}
            <p class="ds-readout"><span class="ds-readout-k">{r.label}</span>{r.value}</p>
          {/each}
        </div>
      </div>

      {#if masthead}
        <div class="ds-deck">{@render masthead()}</div>
      {/if}
    </div>
  </section>

  <!-- ——— the rail ————————————————————————————————————————————————
       Sticky at the top of the jkai scroll container. Horizontally scrollable
       on a phone rather than wrapping to three rows: ten tabs wrapped is a
       block of chrome taller than the first card under it. -->
  <nav class="ds-rail" aria-label="Daydream sections">
    <div class="ds-inner ds-rail-inner">
      {#each tabs as t (t.id)}
        <button
          type="button"
          class="ds-tab"
          class:on={active === t.id}
          aria-current={active === t.id ? 'page' : undefined}
          onclick={() => ontab(t.id)}
        >
          {t.label}
          {#if t.count}<span class="ds-tab-n tone-{t.tone ?? 'quiet'}">{t.count}</span>{/if}
        </button>
      {/each}
    </div>
  </nav>

  <main class="ds-main">
    {@render children()}
  </main>

  {#if footer.length}
    <footer class="ds-foot">
      <div class="ds-inner ds-foot-strip">
        {#each footer as line, i (i)}<p>{line}</p>{/each}
      </div>
    </footer>
  {/if}
</div>

<style>
  .ds {
    width: 100%;
    background: var(--bg);
    color: var(--text-primary);
    overflow-x: hidden;
  }
  .ds-inner {
    max-width: 1500px;
    margin: 0 auto;
  }

  /* ——— cover ——— */
  .ds-cover {
    background: var(--text-primary);
    color: var(--bg);
    padding: clamp(28px, 3.4vw, 52px) clamp(18px, 3vw, 44px) clamp(26px, 3vw, 44px);
  }
  .ds-cover-top {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 32px;
    flex-wrap: wrap;
  }
  .ds-cover-left {
    min-width: 0;
    flex: 1 1 460px;
  }

  .ds-mark {
    font-family: var(--font-brand);
    font-size: var(--fs-label);
    font-weight: 500;
    letter-spacing: -0.01em;
    text-transform: lowercase;
    color: rgba(237, 228, 212, 0.55);
    margin: 0 0 18px;
  }
  .ds-caret {
    color: var(--accent-on-dark);
  }
  .ds-path {
    color: rgba(237, 228, 212, 0.4);
  }

  .ds-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
    margin: 0 0 14px;
  }
  .ds-title {
    font-family: var(--font-display);
    font-size: clamp(34px, 5.4vw, 76px);
    line-height: 0.88;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    margin: 0 0 18px;
  }
  .ds-standfirst {
    font-size: var(--fs-body);
    line-height: 1.55;
    color: rgba(237, 228, 212, 0.75);
    max-width: 62ch;
    text-wrap: pretty;
    margin: 0;
  }

  .ds-cover-right {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .ds-power {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    padding: 9px 16px;
    color: var(--bg);
    background: transparent;
    border: 1px solid rgba(237, 228, 212, 0.3);
    border-radius: 0;
    cursor: pointer;
    transition:
      background-color var(--t-fast) var(--ease-out),
      border-color var(--t-fast) var(--ease-out),
      color var(--t-fast) var(--ease-out);
  }
  .ds-power:hover:not(:disabled) {
    background: var(--accent-on-dark);
    border-color: var(--accent-on-dark);
    color: var(--text-primary);
  }
  .ds-power:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .ds-power:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 2px;
  }
  .ds-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--accent-on-dark);
    /* A glow, not elevation — the one sanctioned shadow in this system. */
    box-shadow: 0 0 6px rgba(232, 134, 58, 0.55);
    animation: ds-pulse 1.6s ease-in-out infinite;
  }
  .ds-power.off .ds-dot {
    background: rgba(237, 228, 212, 0.35);
    box-shadow: none;
    animation: none;
  }
  @keyframes ds-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ds-dot {
      animation: none;
    }
  }

  .ds-readout {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.7);
    margin: 0;
  }
  .ds-readout-k {
    color: rgba(237, 228, 212, 0.4);
    margin-right: 8px;
  }

  .ds-deck {
    margin-top: clamp(24px, 2.6vw, 36px);
  }

  /* ——— rail ——— */
  .ds-rail {
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--surface-rail);
    border-bottom: 2px solid var(--text-primary);
  }
  .ds-rail-inner {
    display: flex;
    align-items: stretch;
    gap: 0;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 0 clamp(18px, 3vw, 44px);
  }
  .ds-rail-inner::-webkit-scrollbar {
    display: none;
  }

  .ds-tab {
    position: relative;
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
    transition:
      color var(--t-fast) var(--ease-out),
      border-color var(--t-fast) var(--ease-out);
  }
  .ds-tab:first-child {
    padding-left: 0;
  }
  .ds-tab:hover {
    color: var(--accent);
  }
  .ds-tab.on {
    color: var(--text-primary);
    font-weight: 700;
    border-bottom-color: var(--accent);
  }
  .ds-tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -3px;
  }

  .ds-tab-n {
    font-size: var(--fs-label-xs);
    line-height: 1;
    padding: 3px 7px;
    border-radius: var(--radius-pill);
    border: 1px solid currentcolor;
  }
  .ds-tab-n.tone-action {
    color: var(--accent);
    background: var(--accent-tint-14);
  }
  .ds-tab-n.tone-watch {
    color: var(--warn);
  }
  .ds-tab-n.tone-quiet {
    color: var(--text-muted);
  }

  /* ——— foot ——— */
  .ds-foot {
    background: var(--text-primary);
    color: rgba(237, 228, 212, 0.55);
    padding: 30px clamp(18px, 3vw, 44px) 46px;
  }
  .ds-foot-strip {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .ds-foot-strip p {
    margin: 0;
  }
</style>
