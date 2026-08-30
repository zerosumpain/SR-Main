<script lang="ts">
  // The chrome the four redesigned owner pages share.
  //
  // A COMPONENT, not a `+layout.svelte`, and deliberately: a layout at
  // /health would re-skin the ANONYMOUS landing page too, which is out of
  // scope and is the one page on this route that must not change (spec
  // decision 5, 2026-08-30).
  //
  // Three things live here and nowhere else:
  //
  //  * the sticky header — z-index 80, above the grain, with the wordmark, an
  //    optional back link, optional nav, and a pulsing dot marking live sync;
  //  * the grain — fixed, inert, z-index 70, so it sits UNDER the header. It is
  //    an inline feTurbulence data URI, no file, and it is brand-defining:
  //    every page in this set wears it;
  //  * the footer — the mono strip, plus an optional accent note above it.
  //
  // Radii are 0 throughout. The only exceptions are the live dot and any pill,
  // at 100px; the system deliberately skips the 8/12/16 middle. There are no
  // shadows either, except the live dot's glow — which is a glow, not
  // elevation.
  import type { Snippet } from 'svelte';

  interface NavLink {
    href: string;
    label: string;
    /** Muted rather than accent — a destination that is not this page's sibling. */
    muted?: boolean;
  }

  interface Props {
    /** Rendered after `strangeramblings.com` in the wordmark, e.g. `/health`. */
    path: string;
    /** Small mono label beside the wordmark. */
    kicker?: string | null;
    /** `← ALL 387 SEGMENTS` — sits with the wordmark, not with the nav. */
    back?: NavLink | null;
    nav?: NavLink[];
    /** Label beside the pulsing dot. Omit and no dot renders. */
    live?: string | null;
    /** Muted mono items on the right of the header. */
    meta?: string[];
    /** Content max-width; the designs run 1300–1500. */
    maxWidth?: number;
    /** The accent paragraph above the footer strip. */
    note?: string | null;
    /** The mono footer strip — the designs carry three items. */
    footer?: string[];
    /**
     * Interactive chrome on the right of the header, after the nav — the
     * activity page's `···` corrections menu. A snippet rather than another
     * link shape because what goes here opens a panel; and it renders INSIDE
     * the sticky header's stacking context, so a popover it opens sits above
     * the grain rather than under it.
     */
    actions?: Snippet;
    children: Snippet;
  }

  let {
    path,
    kicker = null,
    back = null,
    nav = [],
    live = null,
    meta = [],
    maxWidth = 1400,
    note = null,
    footer = [],
    actions = undefined,
    children,
  }: Props = $props();
</script>

<div class="hs" style="--hs-max: {maxWidth}px">
  <!-- Inert, fixed, and under the header. Nothing in it is interactive. -->
  <div class="hs-grain" aria-hidden="true"></div>

  <header class="hs-head">
    <div class="hs-head-left">
      <span class="hs-mark"><span class="hs-caret">&gt;</span> strangeramblings.com<span class="hs-path">{path}</span></span>
      {#if back}
        <a class="hs-back" href={back.href}>{back.label}</a>
      {/if}
      {#if kicker}
        <span class="hs-kicker">{kicker}</span>
      {/if}
    </div>

    <div class="hs-head-right">
      {#each nav as link (link.href + link.label)}
        <a class="hs-nav" class:muted={link.muted} href={link.href}>{link.label}</a>
      {/each}
      {#if live}
        <span class="hs-live"><span class="hs-dot"></span>{live}</span>
      {/if}
      {#each meta as item, i (i)}
        <span class="hs-meta">{item}</span>
      {/each}
      {#if actions}{@render actions()}{/if}
    </div>
  </header>

  <main class="hs-main">
    {@render children()}
  </main>

  {#if note || footer.length}
    <footer class="hs-foot">
      <div class="hs-foot-inner">
        {#if note}<p class="hs-note">{note}</p>{/if}
        {#if footer.length}
          <div class="hs-foot-strip" class:with-note={!!note}>
            {#each footer as line, i (i)}<p>{line}</p>{/each}
          </div>
        {/if}
      </div>
    </footer>
  {/if}
</div>

<style>
  .hs {
    width: 100%;
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-body);
    overflow-x: hidden;
  }

  /* Fixed, inert, and z-70 so the sticky header at z-80 stays above it. */
  .hs-grain {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 70;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
  }

  .hs-head {
    position: sticky;
    top: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
    padding: 12px clamp(20px, 3vw, 44px);
    background: var(--text-primary);
    color: var(--bg);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
    border-radius: 0;
  }
  .hs-head-left,
  .hs-head-right {
    display: flex;
    align-items: baseline;
    gap: 14px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .hs-head-right {
    align-items: center;
    gap: 18px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .hs-mark {
    font-family: var(--font-brand);
    font-weight: 500;
    font-size: 14px;
    letter-spacing: -0.01em;
    text-transform: lowercase;
  }
  .hs-caret {
    color: var(--accent-on-dark);
  }
  .hs-path {
    color: rgba(237, 228, 212, 0.55);
  }

  .hs-kicker,
  .hs-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
  }

  .hs-back {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
    text-decoration: none;
    transition: color 0.2s ease-out;
  }
  .hs-back:hover {
    color: var(--bg);
  }

  .hs-nav {
    color: var(--accent-on-dark);
    text-decoration: none;
    transition: color 0.2s ease-out;
  }
  .hs-nav.muted {
    color: rgba(237, 228, 212, 0.55);
  }
  .hs-nav:hover {
    color: var(--bg);
  }

  .hs-live {
    display: flex;
    align-items: center;
    gap: 7px;
    color: rgba(237, 228, 212, 0.8);
  }
  .hs-dot {
    width: 5px;
    height: 5px;
    /* Pills only — the one radius in this system that is not 0. */
    border-radius: 100px;
    background: var(--accent-on-dark);
    /* The single sanctioned box-shadow on these pages: a glow, not elevation. */
    box-shadow: 0 0 6px rgba(232, 134, 58, 0.55);
    animation: hs-pulse 1.6s ease-in-out infinite;
  }

  @keyframes hs-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hs-dot {
      animation: none;
    }
  }

  .hs-main {
    min-width: 0;
  }

  .hs-foot {
    background: var(--text-primary);
    color: rgba(237, 228, 212, 0.55);
    padding: 30px clamp(20px, 3vw, 44px) 46px;
  }
  .hs-foot-inner {
    max-width: var(--hs-max);
    margin: 0 auto;
  }
  .hs-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.7;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
    max-width: 100ch;
    margin: 0 0 18px;
  }
  .hs-foot-strip {
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
  .hs-foot-strip.with-note {
    padding-top: 18px;
    border-top: 1px solid rgba(237, 228, 212, 0.16);
  }
  .hs-foot-strip p {
    margin: 0;
  }
</style>
