<svelte:options css="injected" />

<script lang="ts">
  // One chapter of the essay. A rule to open it (the rambler's floor), the
  // chapter's numeral and name in the margin, its headline in the main
  // column, then the headline figure set huge: it counts up the first time
  // it scrolls into view while a highlighter stroke sweeps once behind it,
  // and the margin's small chart draws itself in alongside. The server, a
  // browser without JavaScript, a reader who wants less motion, and a figure
  // already on screen when the page wakes up all get the final figure with
  // the stroke and the chart already drawn.
  //
  // Below the figure, two movements of prose (the second under a small mono
  // subhead, with clear air above it for the rambler to stand in), then the
  // way on. The margin carries live state in mono, as the hero's dateline
  // does, and one exact chart as marginalia; on a phone the live state folds
  // in above the headline and the chart follows the figure.
  //
  // The rambler: every floor here (the rule, a ledge just above the prose
  // that runs under the margin too, the second movement) spans the full
  // column with clear air above it, while the text
  // keeps a lane (--lane) clear at the column's right-hand end. His ropes
  // between floors hang in that lane, so they never run through the words.
  //
  // A chapter may carry a plate (Wildmind's map): a full-width row between
  // the first movement and the second, its caption in the margin and its
  // picture in the main column, so the reader is told what it is before being
  // shown it, and it parts the two movements as a break. It is not a floor;
  // the ledge above the first movement and the second movement's floor below
  // it stand either side. On a phone the order is headline, figure, first
  // movement, plate, chart, second movement; on a desktop the chart sits in
  // the margin beside the second movement, which is the paragraph it belongs
  // to, rather than a whole plate above it.
  import { onMount, untrack, type Snippet } from 'svelte';
  import type { Spot } from '$lib/landing/ramblers/world';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import { belowFold, countUp, firstView, prefersReducedMotion } from '$lib/landing/showcase-motion';
  import { countWord } from '$lib/landing/sentence';
  import { fig, figureEms, type ChapterCopy } from '$lib/landing/showcase-sentence';
  import Prose from './Prose.svelte';
  import Visual from './Visual.svelte';

  let {
    c,
    open,
    ontoggle,
    ruleSpot,
    p2Spot,
    plate,
  }: {
    c: ChapterCopy;
    open: string | null;
    ontoggle: (id: string) => void;
    /** A named rambler spot on the opening rule (think, desk). */
    ruleSpot?: Spot;
    /** A named rambler spot on the second movement (gym). */
    p2Spot?: Spot;
    /** A plate after the figure (a map with its caption in the margin). */
    plate?: Snippet;
  } = $props();

  let value = $derived(c.figure.value);
  let text = $derived(value == null ? '' : fig(value, c.figure.decimals));

  // Armed only in a browser that will actually play the flourish, and only
  // for a figure still below the fold: one already in view (or scrolled
  // past, on a restored scroll) keeps its final value and stroke rather than
  // dropping to zero in front of the reader.
  let armed = $state(false);
  let seen = $state(false);
  let figEl = $state<HTMLElement>();
  onMount(() => {
    armed = value != null && belowFold(figEl) && !prefersReducedMotion();
  });

  // The count, attached only once armed; it reads its figure once.
  const counter = (node: HTMLElement) => {
    const a = countUp(
      node,
      untrack(() => ({ to: value, decimals: c.figure.decimals })),
    );
    return () => a?.destroy?.();
  };
</script>

<section
  class="ss-ch"
  data-ground={c.ground}
  data-tone={c.tone}
  data-plate={plate ? '' : undefined}
  data-armed={armed && !seen ? '' : undefined}
  data-seen={armed && seen ? '' : undefined}
  aria-labelledby="ss-{c.id}-h"
>
  <div class="ss-rule" use:scenery={{ spot: ruleSpot, at: 0.18 }}></div>

  <p class="ss-kick">
    <span class="ss-num" aria-hidden="true">{c.numeral}</span><span class="ss-vh">Chapter {countWord(c.nth)}, </span><span
      class="ss-label">{c.label}</span
    >
  </p>

  {#if c.side.length}
    <ul class="ss-side">
      {#each c.side as s (s.text)}<li class:ss-live={s.live}>{s.text}</li>{/each}
    </ul>
  {/if}

  <h2 id="ss-{c.id}-h" class="ss-head">{c.head}</h2>

  {#if value != null}
    <div class="ss-fig" bind:this={figEl} use:firstView={() => (seen = true)}>
      <p class="ss-figp">
        <span class="ss-n" style:--em={figureEms(text)} data-lone={text.length === 1 ? '' : undefined}
          ><span class="ss-mark" aria-hidden="true"></span><span class="ss-nv" {@attach armed ? counter : null}>{text}</span></span
        >
        <span class="ss-unit">{c.figure.unit}</span>
      </p>
    </div>
  {:else}
    <!-- No figure: one quiet mono line, not a giant empty slot. -->
    <p class="ss-none"><span aria-hidden="true">— {c.figure.unit}</span><span class="ss-vh">{c.figure.unit}, {c.figure.spoken}</span></p>
  {/if}

  {#if plate}
    <div class="ss-plate-row">{@render plate()}</div>
  {/if}

  {#if c.margin}
    <figure class="ss-mv">
      <figcaption class="ss-mvl">{c.margin.label}</figcaption>
      <Visual visual={c.margin.visual} compact />
    </figure>
  {/if}

  <!-- A floor across the whole chapter, just above the prose. -->
  <div class="ss-ledge" aria-hidden="true" use:scenery></div>

  <div class="ss-body">
    <p class="ss-prose"><Prose segs={c.p1} {open} {ontoggle} /></p>
  </div>
  {#if c.p2}
    <!-- Runs under the margin too (its words keep to the main column), so it
         is a floor as wide as the rule above and the line below. -->
    <div class="ss-p2" use:scenery={{ spot: p2Spot, at: 0.3 }}>
      <p class="ss-sub">{c.p2.sub}</p>
      <p class="ss-prose"><Prose segs={c.p2.segs} {open} {ontoggle} /></p>
    </div>
  {/if}
  {#if c.link}<a class="ss-on" href={c.link.href}>{c.link.text} <span aria-hidden="true">→</span></a>{/if}
</section>

<style>
  .ss-ch {
    --margin: 0px;
    /* Kept clear of text at the column's right-hand end: the rambler's rope lane. */
    --lane: 40px;
    --prose: clamp(18px, 1.62vw, 24px);
    --prose-lh: 1.45;
    --t-accent: var(--accent-hover);
    --t-ink: var(--accent-ink);
    --fg: var(--text-primary);
    --fg2: var(--text-secondary);
    --fg3: var(--text-muted);
    --hair: var(--line-strong);
    /* The highlighter is the other tone: petrol under an orange figure,
       orange under a petrol one, as a marker pen over print. Multiplied
       into the paper, so it tints rather than covers. */
    --mark-accent: rgba(232, 134, 58, 0.45);
    --mark-ink: rgba(127, 184, 192, 0.45);
    --mark-blend: multiply;
    --tone: var(--t-accent);
    --mark: var(--mark-ink);
    max-width: 1312px;
    margin: 0 auto;
    padding: 0 var(--gut, 16px);
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'rule' 'kick' 'side' 'head' 'fig' 'mv' 'ledge' 'body' 'p2' 'on';
    justify-items: stretch;
    color: var(--fg);
  }
  .ss-ch[data-tone='ink'] {
    --tone: var(--t-ink);
    --mark: var(--mark-accent);
  }
  /* The app chapter is the one dark pull-out: measurement is dark. On ink
     the marker is screened, so it lifts the ground instead of muddying it. */
  .ss-ch[data-ground='ink'] {
    --t-accent: var(--accent-on-dark);
    --t-ink: var(--accent-ink-on-dark);
    --fg: var(--bg);
    --fg2: rgba(237, 228, 212, 0.84);
    --fg3: var(--on-ink-70);
    --hair: var(--on-ink-30);
    --mark-accent: rgba(232, 134, 58, 0.3);
    --mark-ink: rgba(127, 184, 192, 0.36);
    --mark-blend: screen;
  }
  .ss-vh {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  /* A printer's rule opens the chapter; the rambler walks along it. */
  .ss-rule {
    grid-area: rule;
    height: 2px;
    background: var(--fg);
  }
  .ss-ch[data-ground='ink'] .ss-rule {
    background: var(--hair);
  }

  .ss-kick {
    grid-area: kick;
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin: 18px 0 0;
  }
  .ss-num {
    font-family: var(--fs-serif);
    font-style: italic;
    font-weight: 400;
    font-size: clamp(30px, 2.6vw, 40px);
    line-height: 1;
    color: var(--tone);
  }
  .ss-label,
  .ss-side,
  .ss-sub,
  .ss-unit,
  .ss-none,
  .ss-mvl,
  .ss-on {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .ss-label {
    color: var(--fg);
  }
  .ss-side {
    grid-area: side;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 18px;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
    letter-spacing: 0.08em;
    line-height: 1.6;
    color: var(--fg3);
  }
  .ss-side li.ss-live {
    color: var(--fg);
  }
  .ss-side li.ss-live::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 8px;
    border-radius: 100px;
    background: var(--tone);
    vertical-align: 0.12em;
  }

  .ss-head {
    grid-area: head;
    margin: 14px var(--lane) 0 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(30px, 3.7vw, 56px);
    line-height: 0.96;
    letter-spacing: -0.035em;
    text-transform: uppercase;
    text-wrap: balance;
    max-width: 16em;
    color: var(--fg);
  }

  /* The headline figure: as big as the column (less the lane) allows. */
  .ss-fig {
    grid-area: fig;
    container-type: inline-size;
    margin: clamp(18px, 2.4vw, 34px) var(--lane) 0 0;
  }
  .ss-figp {
    margin: 0;
  }
  .ss-n {
    position: relative;
    display: inline-block;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: min(clamp(64px, 10.5vw, 168px), calc(100cqi / var(--em, 4)));
    line-height: 0.92;
    letter-spacing: -0.045em;
    font-variant-numeric: tabular-nums;
    color: var(--tone);
  }
  /* Painted after the stroke, so the digits sit on top of it. */
  .ss-nv {
    position: relative;
  }
  /* The highlighter: a slim, slightly tilted marker stroke along the foot of
     the digits, drawn once from the left. */
  .ss-mark {
    position: absolute;
    left: 0;
    right: -0.02em;
    bottom: 0.08em;
    height: 0.28em;
    border-radius: 2px;
    background: var(--mark);
    mix-blend-mode: var(--mark-blend);
    transform: rotate(var(--tilt));
    transform-origin: 0 50%;
    /* About a degree on a short figure, less on a long one, so the stroke
       never climbs more than a few pixels across the digits. */
    --tilt: calc(-1.9deg / var(--em, 2));
  }
  /* A lone digit: a little past it and thinner, so the mark stays a stroke
     (about four to one) rather than a block beside the figure. */
  .ss-n[data-lone] .ss-mark {
    right: -0.16em;
    height: 0.2em;
  }
  .ss-ch[data-armed] .ss-mark {
    transform: rotate(var(--tilt)) scaleX(0);
  }
  .ss-ch[data-seen] .ss-mark {
    animation: ss-sweep 900ms cubic-bezier(0.2, 0.7, 0.2, 1) 120ms both;
  }
  @keyframes ss-sweep {
    from {
      transform: rotate(var(--tilt)) scaleX(0);
    }
    to {
      transform: rotate(var(--tilt)) scaleX(1);
    }
  }
  .ss-unit {
    display: block;
    margin-top: 12px;
    color: var(--fg2);
  }
  .ss-none {
    grid-area: fig;
    margin: clamp(14px, 1.8vw, 24px) var(--lane) 0 0;
    color: var(--fg2);
  }

  /* The margin's chart: small, exact, always in view. */
  .ss-mv {
    grid-area: mv;
    min-width: 0;
    margin: 0;
  }
  .ss-mvl {
    margin-bottom: 8px;
    letter-spacing: 0.08em;
    line-height: 1.5;
    color: var(--fg2);
  }
  /* Drawn in with the figure: columns grow, marks and numerals fade up. */
  .ss-ch[data-armed] .ss-mv :global(.ss-g) {
    opacity: 0;
  }
  .ss-ch[data-armed] .ss-mv :global(.ss-gy) {
    transform: scaleY(0);
  }
  .ss-ch[data-seen] .ss-mv :global(.ss-g) {
    animation: ss-in 420ms ease-out calc(260ms + var(--i, 0) * 28ms) both;
  }
  .ss-ch[data-seen] .ss-mv :global(.ss-gy) {
    transform-box: fill-box;
    transform-origin: 50% 100%;
    animation-name: ss-grow;
    animation-duration: 560ms;
  }
  @keyframes ss-in {
    from {
      opacity: 0;
    }
  }
  @keyframes ss-grow {
    from {
      opacity: 0;
      transform: scaleY(0);
    }
  }

  /* The plate: a row of its own, wide as the chapter (it keeps the columns itself). */
  .ss-plate-row {
    grid-area: plate;
    min-width: 0;
  }
  .ss-ch[data-plate] {
    grid-template-areas: 'rule' 'kick' 'side' 'head' 'fig' 'ledge' 'body' 'plate' 'mv' 'p2' 'on';
  }

  /* Halfway down the chapter, a floor with clear air above it. */
  .ss-ledge {
    grid-area: ledge;
    height: 0;
    margin-top: 68px;
  }
  .ss-body {
    grid-area: body;
  }
  .ss-prose {
    max-width: min(36em, 100% - var(--lane));
    margin: 0;
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    font-weight: 400;
    font-size: var(--prose);
    line-height: var(--prose-lh);
    letter-spacing: -0.008em;
    color: var(--fg);
    text-wrap: pretty;
  }
  /* The second movement: clear air above for the rambler, then a subhead. */
  .ss-p2 {
    grid-area: p2;
    margin-top: 68px;
  }
  .ss-sub {
    margin: 0 0 10px;
    color: var(--tone);
  }
  .ss-on {
    grid-area: on;
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    margin-top: 18px;
    color: var(--fg);
    text-decoration: none;
    border-bottom: 1px solid var(--hair);
  }
  .ss-on:hover {
    color: var(--tone);
    border-bottom-color: var(--tone);
  }
  .ss-on:focus-visible {
    outline: 2px solid var(--tone);
    outline-offset: 4px;
  }

  /* Phone and tablet: one column, so everything keeps the lane, and the
     chart follows the figure. */
  @media (max-width: 899.98px) {
    .ss-kick,
    .ss-side {
      margin-right: var(--lane);
    }
    .ss-mv {
      margin-top: clamp(26px, 4vw, 36px);
      padding-right: var(--lane);
    }
    .ss-mv :global(.ss-vis) {
      max-width: 420px;
    }
  }

  /* Desktop: the margin column holds the numeral, the live state and the
     chart beside the headline, figure and prose, as the hero's margin holds
     its dateline. */
  @media (min-width: 900px) {
    .ss-ch {
      --margin: clamp(176px, 15vw, 224px);
      grid-template-columns: var(--margin) minmax(0, 1fr);
      grid-template-areas: 'rule rule' 'kick head' 'side fig' 'ledge ledge' 'mv body' 'p2 p2' '. on';
      column-gap: 32px;
    }
    .ss-kick {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
      margin-top: 20px;
    }
    .ss-head {
      margin-top: 22px;
    }
    /* With a plate the chart waits for the paragraph it belongs to: it sits
       in the margin beside the second movement (overlaying that floor's
       empty margin end), not a plate away from it beside the first. */
    .ss-ch[data-plate] {
      grid-template-areas: 'rule rule' 'kick head' 'side fig' 'ledge ledge' '. body' 'plate plate' 'p2 p2' '. on';
    }
    .ss-ch[data-plate] .ss-mv {
      grid-row: p2;
      grid-column: 1;
      /* Level with the subhead, below the floor's clear air, and over the
         floor's box (which comes later), so it can still be selected. */
      position: relative;
      z-index: 1;
      margin-top: 68px;
      padding-top: 0;
    }
    .ss-ch[data-plate] .ss-plate-row {
      margin-top: clamp(40px, 4vw, 60px);
    }
    .ss-p2 {
      padding-left: calc(var(--margin) + 32px);
    }
    .ss-side {
      flex-direction: column;
      align-self: start;
      margin-top: clamp(26px, 2.8vw, 42px);
    }
    .ss-mv {
      align-self: start;
      padding-top: 6px;
    }
  }
  @media (max-width: 760px) {
    .ss-ch {
      --prose-lh: 1.5;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ss-ch[data-armed] .ss-mark,
    .ss-ch[data-seen] .ss-mark {
      transform: rotate(var(--tilt));
      animation: none;
    }
    .ss-ch[data-seen] .ss-mv :global(.ss-g) {
      animation: none;
    }
  }

  @media print {
    .ss-ch,
    .ss-ch[data-ground='ink'],
    .ss-ch[data-tone] {
      --t-accent: #1a1008;
      --t-ink: #1a1008;
      --tone: #1a1008;
      --fg: #1a1008;
      --fg2: #1a1008;
      --fg3: #1a1008;
      --hair: #1a1008;
      color: #1a1008;
      break-inside: avoid-page;
    }
    .ss-rule {
      background: none;
      border-top: 2px solid #1a1008;
    }
    .ss-mark {
      display: none;
    }
    /* Paper gets every chart whole, drawn in or not. */
    .ss-ch .ss-mv :global(.ss-g) {
      opacity: 1 !important;
      transform: none !important;
      animation: none !important;
    }
    .ss-p2 {
      margin-top: 16px;
    }
    .ss-ledge {
      margin-top: 24px;
    }
    .ss-side li.ss-live::before {
      display: none;
    }
  }
</style>
