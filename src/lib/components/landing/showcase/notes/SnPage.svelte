<svelte:options css="injected" />

<script lang="ts">
  // One page of the notebook: the kicker in the margin, the heading and its
  // lede at the top of the page, then the page's own readings, and the link
  // out at the foot. The head block is the rambler's floor for the page (and
  // carries its named spot, if it has one): static, unrotated, full width,
  // with the page's top padding clear above it.
  //
  // Each page carries its own ruling, anchored to its top, and keeps itself a
  // whole number of rules tall (snap), so the lines run on unbroken from one
  // page to the next. Everything written here sits on a line: the heading's
  // line box is one or two rules, the lede and the marginalia one rule a line.
  //
  // The page's readings typed up (SnFair) wait under the lede: shown in place
  // of the drawings when the hero's fair copy is on, and in print.
  import type { Snippet } from 'svelte';
  import type { FairRow } from '$lib/landing/showcase-notes';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import type { Spot } from '$lib/landing/ramblers/world';
  import SnFair from './SnFair.svelte';
  import { snap } from './snap';

  let {
    id,
    page,
    spot,
    fair,
    children,
  }: {
    id: string;
    page: { kicker: string; head: string; lede: string; href: string; more: string };
    spot?: Spot;
    fair: FairRow[];
    children: Snippet;
  } = $props();
</script>

<section class="sp" aria-labelledby="sn-{id}-h" use:snap>
  <div class="sp-in">
    <p class="sp-k" aria-hidden="true">{page.kicker}</p>
    <div class="sp-body">
      <header class="sp-top" use:scenery={{ spot, at: 0.2 }}>
        <h2 id="sn-{id}-h">{page.head}</h2>
        <p class="sp-lede">{page.lede}</p>
      </header>
      <SnFair rows={fair} label="{page.head}, typed up" />
      <div class="sp-draw">
        {@render children()}
      </div>
      <p class="sp-foot">
        <a class="sn-more" href={page.href}>{page.more} <span aria-hidden="true">→</span></a>
      </p>
    </div>
  </div>
</section>

<style>
  .sp {
    /* The exercise book's rules: a faint petrol line under every 32px, where the writing sits. */
    background-image: repeating-linear-gradient(
      to bottom,
      transparent 0 var(--rule-y),
      var(--rule) var(--rule-y) calc(var(--rule-y) + 1px),
      transparent calc(var(--rule-y) + 1px) 32px
    );
  }
  .sp-in {
    display: grid;
    grid-template-columns: var(--mg) minmax(0, 1fr);
    max-width: 1312px;
    margin: 0 auto;
    padding: 96px var(--gut) 0;
    box-sizing: border-box;
  }
  /* The kicker sits in the margin, on the heading's first line, right up against the red rule. */
  .sp-k {
    margin: 0;
    padding-right: 22px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 32px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-align: right;
    color: var(--accent-hover);
  }
  .sp-body {
    min-width: 0;
    padding-left: clamp(14px, 2vw, 32px);
  }
  .sp-top {
    max-width: 820px;
  }
  h2 {
    position: relative;
    top: -5px;
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 34px;
    line-height: 32px;
    letter-spacing: -0.035em;
    color: var(--text-primary);
    text-wrap: balance;
  }
  .sp-lede {
    max-width: 62ch;
    margin: 32px 0 0;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    line-height: 32px;
    color: var(--text-secondary);
  }
  .sp-foot {
    display: flex;
    align-items: flex-end;
    height: 64px;
    margin: 32px 0 0;
  }
  .sp-foot :global(.sn-more) {
    position: relative;
    top: 10px;
  }

  @media (min-width: 1000px) {
    .sp-k {
      padding-top: 16px;
    }
    h2 {
      top: -2px;
      font-size: clamp(54px, 4.4vw, 60px);
      line-height: 64px;
    }
    .sp-lede {
      margin-top: 0;
      font-size: var(--fs-body-lg);
    }
  }
  @media (max-width: 760px) {
    .sp-in {
      padding-top: 64px;
    }
    /* The kicker turns to run down the margin, as a phone's margin is narrow. */
    .sp-k {
      margin: 0;
      padding: 4px 0 0;
      line-height: 1.4;
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      justify-self: center;
      align-self: start;
      text-align: right;
    }
  }
  @media print {
    .sp {
      background: none;
      padding-bottom: 0 !important;
    }
    .sp-in {
      display: block;
      padding-top: 24px;
    }
    .sp-k,
    .sp-draw,
    .sp-foot {
      display: none;
    }
    .sp-body {
      padding: 0;
    }
    h2 {
      top: 0;
      font-size: 26px;
      line-height: 1.1;
      color: #1a1008;
    }
    .sp-lede {
      margin-top: 8px;
      font-size: 12pt;
      line-height: 1.45;
      color: #1a1008;
    }
  }
  :global(body:has(.hn[data-fair])) .sp-draw {
    display: none;
  }
</style>
