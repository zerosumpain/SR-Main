<svelte:options css="injected" />

<script lang="ts" module>
  export type { Pin, NarrowPin, PinnedTag } from './PlaceTags.svelte';
</script>

<script lang="ts">
  // One chapter of the place's walk through the city, told the way the hero tells the
  // day: a hand-drawn scene (the `art` snippet, an aria-hidden SVG in a
  // 1000-wide box) with every reading pinned to its part on a leader line as
  // real text, and one plate that explains whichever label is open. Pointing
  // at a label, focusing it or tapping it lights its part and dims the rest.
  //
  // Widths: on a desktop the chapter's heading and plate stand in the scene's
  // own sky (left or right, `side`) and the picture runs the whole measure.
  // Narrower, the heading goes above and the plate below, and the picture
  // crops to the part with the story in it (`zone`), so the labels keep their
  // size; on a phone the labels come off the picture into a list underneath.
  //
  // Motion: one trigger starts both the headline count and the scene's own
  // flourish (`data-play`), so the stars, windows or path keep pace with the
  // figure: it fires as the figure comes up past the lower third of the
  // screen. `data-arm` holds the first frame until then (the figure and
  // the flourish both unseen; set only once JavaScript runs, so the server's
  // HTML is always the finished picture with its final figure).
  // `data-away` pauses anything that keeps moving (a twinkle, the beat) off
  // screen or in a hidden tab; a one-off flourish always runs to its end;
  // `data-beat` is set only while a fresh pulse is beating. Under reduced
  // motion nothing is armed and nothing plays.
  import { onMount, type Snippet } from 'svelte';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import type { Spot } from '$lib/landing/ramblers/world';
  import { belowFold, COUNT_MS, formatFigure, onScreen, prefersReducedMotion, tweenValue } from '$lib/landing/showcase-motion';
  import { tagLine } from '$lib/landing/showcase-place-words';
  import PlaceTags, { type PinnedTag } from './PlaceTags.svelte';

  let {
    id,
    side,
    h,
    zone,
    ground,
    tone,
    head,
    spot,
    tags,
    key,
    rules,
    more,
    art,
    beat = null,
    beatCaption = '',
    beatStill = '',
    loosePlate = false,
    land = 'var(--place-night)',
    last = false,
  }: {
    /** Prefix for every id in the chapter ('sp-…'). */
    id: string;
    /** Which side the heading and plate stand on, on a desktop. */
    side: 'l' | 'r';
    /** The scene's height in its own units (it is 1000 wide). */
    h: number;
    /** The part of the scene with the story in it, [from, to] across, kept when cropped. */
    zone: [number, number];
    /** Where the ground is, down the scene: the rambler's floor. */
    ground: number;
    tone: 'accent' | 'ink';
    head: { kicker: string; title: string; unit: string; aside?: string; figure: number | null; decimals?: number };
    /** The rambler's named spot, on the heading. */
    spot?: Spot;
    tags: PinnedTag[];
    /** What the picture shows, in a sentence: the plate's words until a label is open. */
    key: string;
    /** A standing line under the plate (the rules of the thing), or nothing. */
    rules?: string;
    more: { href: string; cta: string };
    art: Snippet;
    /** `--beat` for a fresh pulse, or null: nothing beats without one. */
    beat?: string | null;
    /** What the beating part is doing, said beside "hold still". */
    beatCaption?: string;
    /** The same said when nothing moves (held still, or reduced motion). */
    beatStill?: string;
    /** The colour of the ground under the scene, carried on to the chapter's end. */
    land?: string;
    /** The last scene: its ground ends in a hard rule, the night's floor. */
    last?: boolean;
    /** The plate keeps out of the picture's sky even on a desktop. */
    loosePlate?: boolean;
  } = $props();

  let root: HTMLElement;
  let armed = $state(false);
  let play = $state(false);
  let away = $state(false);
  let reduced = $state(false);
  let held = $state(false);

  let peek = $state<string | null>(null);
  let pinned = $state<string | null>(null);
  let hover = $state<string | null>(null);
  let shown = $derived(peek ?? pinned ?? hover);
  let shownTag = $derived(shown ? (tags.find((t) => t.id === shown) ?? null) : null);
  let beating = $derived(beat != null && !held && !away && !reduced);

  // A scene whose figure is already in view (or scrolled past) when the page
  // hydrates keeps the finished picture and the final figure the server
  // rendered: arming it would drop both to their first frame in front of the
  // reader. Only a scene still below the fold is armed, counted and played.
  let still = false;
  let figWrap: HTMLElement;
  onMount(() => {
    reduced = prefersReducedMotion();
    still = reduced || !belowFold(figWrap);
    if (!still && !play) armed = true;
    return () => cancelAnimationFrame(frame);
  });

  // The headline count: the figure's text while it counts, null for the final
  // figure (what the server rendered). Started by the same trigger as the picture.
  let counting = $state<string | null>(null);
  let figEl = $state<HTMLElement | null>(null);
  let frame = 0;
  function start() {
    if (still) return;
    play = true;
    const to = head.figure;
    if (reduced || prefersReducedMotion() || to == null || !Number.isFinite(to) || to === 0 || !figEl) return;
    const dec = head.decimals ?? 0;
    // Keep the final figure's width while it counts, so nothing beside it moves.
    figEl.style.minWidth = `${figEl.getBoundingClientRect().width}px`;
    const t0 = performance.now();
    const step = (t: number) => {
      const e = t - t0;
      if (e >= COUNT_MS) {
        counting = null;
        if (figEl) figEl.style.minWidth = '';
        return;
      }
      counting = formatFigure(tweenValue(to, e, COUNT_MS, dec), dec);
      frame = requestAnimationFrame(step);
    };
    counting = formatFigure(0, dec);
    frame = requestAnimationFrame(step);
  }

  // The part a label answers to lights up; the rest falls back.
  $effect(() => {
    const on = shown;
    for (const el of root?.querySelectorAll<Element>('[data-part]') ?? []) {
      if (on && el.getAttribute('data-part') !== on) el.setAttribute('data-dim', '');
      else el.removeAttribute('data-dim');
    }
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !(pinned ?? peek)) return;
    const was = pinned ?? peek;
    pinned = null;
    peek = null;
    root.querySelector<HTMLButtonElement>(`.sp-tag[data-part="${was}"] button`)?.focus();
  }


  // The one trigger: the headline figure has come up past the lower third
  // of the screen, where most of the picture beside or under it is in view
  // too. A figure already above the screen (a jump, a restored scroll) counts
  // as seen at once, so nothing is left held.
  function seen(node: Element, cb: () => void) {
    if (typeof IntersectionObserver !== 'function') {
      cb();
      return {};
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const above = e.boundingClientRect.bottom < (e.rootBounds?.top ?? 0);
          if (e.isIntersecting || above) {
            io.disconnect();
            cb();
            return;
          }
        }
      },
      { rootMargin: '0px 0px -35% 0px', threshold: [0] },
    );
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }
</script>

<!-- Escape closes the open label from anywhere in the chapter. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="sp-scene"
  bind:this={root}
  aria-labelledby="{id}-h"
  data-side={side}
  data-tone={tone}
  data-focus={shown ?? undefined}
  data-arm={armed && !play ? '' : undefined}
  data-play={play && !reduced ? '' : undefined}
  data-away={away ? '' : undefined}
  data-beat={beating ? '' : undefined}
  data-loose-plate={loosePlate ? '' : undefined}
  style:--h={h}
  style:--z0={zone[0]}
  style:--zw={zone[1] - zone[0]}
  style:--ground={ground}
  style:--land={land}
  data-last={last ? '' : undefined}
  style:--beat={beat ?? undefined}
  use:onScreen={(on) => (away = !on)}
  {onkeydown}
>
  <div class="sp-in">
    <div class="sp-frame">
      <!-- The heading: a floor for the rambler, and his named spot if the chapter has one. -->
      <div class="sp-head" use:scenery={{ spot, at: 0.3 }}>
        <p class="sp-k">{head.kicker}</p>
        <h2 id="{id}-h">{head.title}</h2>
        <p class="sp-fig" bind:this={figWrap} use:seen={start}>
          {#if head.figure != null}
            <span class="sp-n" bind:this={figEl} aria-hidden="true">{counting ?? formatFigure(head.figure, head.decimals ?? 0)}</span
            ><span class="vh">{formatFigure(head.figure, head.decimals ?? 0)}</span>
            <span class="sp-u">{head.unit}</span>
          {:else}
            <span class="sp-n sp-dash" aria-hidden="true">—</span>
            <span class="sp-u">{head.unit}<span class="vh">, </span><span class="sp-why">not answering just now</span></span>
          {/if}
        </p>
      </div>

      <div class="sp-stage">
        <div class="sp-pic">
          <!-- The ground runs the width of the screen and on down to the chapter's
               end, where the next scene's sky begins behind it. -->
          <span class="sp-land" aria-hidden="true"></span>
          <div class="sp-art" aria-hidden="true">
            {@render art()}
          </div>
          <!-- The ground is a floor the width of the measure. -->
          <span class="sp-floor" use:scenery></span>
        </div>

        <!-- The readings: real buttons pinned to their parts (a list under the picture on a phone). -->
        <PlaceTags {id} {tone} {tags} {shown} bind:pinned bind:peek bind:hover />
      </div>

      <!-- The one plate: what the picture is, or the open label explained. -->
      <div class="sp-plate" use:scenery>
        {#if head.aside}<p class="sp-aside">{head.aside}</p>{/if}
        <div class="sp-say" id="{id}-say">
          <!-- Every text the plate can show, laid in the same place unseen, so it is
               always as tall as its longest and opening a label never moves the page. -->
          <p class="sp-sizer sp-key" aria-hidden="true">{key}</p>
          {#each tags as t (t.id)}<p class="sp-sizer" aria-hidden="true">{t.note}</p>{/each}
          <p class="sp-live" class:sp-key={!shownTag} aria-live="polite">{shownTag ? shownTag.note : key}</p>
        </div>
        {#if rules}<p class="sp-rules">{rules}</p>{/if}
        {#if beat != null}
          <p class="sp-cap">
            <span>{reduced || held ? beatStill || beatCaption : beatCaption}</span>
            <button type="button" class="sp-hold" aria-pressed={held} onclick={() => (held = !held)}>
              <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
                {#if held}<path d="M2 1 L9 5 L2 9 Z" />{:else}<path d="M1.5 1h2.5v8H1.5zM6 1h2.5v8H6z" />{/if}
              </svg>
              hold still
            </button>
          </p>
        {/if}
        <a class="sp-more" href={more.href}>{more.cta} <span aria-hidden="true">→</span></a>
      </div>
    </div>

    <!-- Print: the picture does not survive the trip, so every reading prints as text. -->
    <dl class="sp-print">
      <dt>{head.figure == null ? '—' : formatFigure(head.figure, head.decimals ?? 0)} {head.unit}</dt>
      <dd>{key}</dd>
      {#each tags as t (t.id)}
        <dt>{tagLine(t)}</dt>
        <dd>{t.note}</dd>
      {/each}
    </dl>
  </div>
</section>

<style>
  .sp-scene {
    /* Desktop: the whole scene shows, 1000 units across. */
    --x0: 0;
    --vw: 1000;
    --col: 33%;
    --cream: #ede4d4;
    --tone: var(--accent-on-dark);
    position: relative;
    overflow: clip;
    padding-top: clamp(76px, 8vw, 120px);
    color: var(--cream);
  }
  .sp-scene[data-tone='ink'] {
    --tone: var(--accent-ink-on-dark);
  }
  .vh {
    position: absolute !important;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  .sp-in {
    max-width: 1312px;
    margin: 0 auto;
    padding: 0 var(--gut, clamp(16px, 4vw, 64px));
    box-sizing: border-box;
  }

  /* ------------------------------------------------------------ the frame */

  /* A desktop: the picture fills the measure; the heading and the plate
     stand in its sky on one side, the heading at the top, the plate low. */
  .sp-frame {
    position: relative;
    display: grid;
    grid-template-columns: var(--col) minmax(0, 1fr);
    grid-template-rows: auto minmax(24px, 1fr) auto;
  }
  .sp-scene[data-side='r'] .sp-frame {
    grid-template-columns: minmax(0, 1fr) var(--col);
  }
  .sp-stage {
    grid-column: 1 / -1;
    grid-row: 1 / -1;
    position: relative;
  }
  .sp-head,
  .sp-plate {
    position: relative;
    z-index: 3;
    grid-column: 1;
    min-width: 0;
  }
  .sp-scene[data-side='r'] :is(.sp-head, .sp-plate) {
    grid-column: 2;
  }
  .sp-head {
    grid-row: 1;
    padding-top: 6px;
  }
  .sp-plate {
    grid-row: 3;
    align-self: end;
    /* Stand on the ground line: a margin's percentage is of the frame's
       width, which on a desktop is the picture's, 1000 units of it. */
    margin-bottom: calc((var(--h) - var(--ground)) / 1000 * 100% + 28px);
  }

  .sp-k {
    margin: 0 0 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--tone);
  }
  h2 {
    margin: 0;
    max-width: 14em;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(30px, 3vw, 44px);
    line-height: 1.02;
    letter-spacing: -0.025em;
    color: var(--cream);
    text-wrap: balance;
  }
  .sp-fig {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: clamp(18px, 2vw, 28px) 0 0;
  }
  .sp-n {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(50px, 5.4vw, 84px);
    line-height: 0.92;
    letter-spacing: -0.035em;
    font-variant-numeric: tabular-nums;
    color: var(--tone);
  }
  /* No figure: a small quiet dash, not a grey bar the size of the headline,
     with the reason said in the line under it. */
  .sp-dash {
    font-size: 40px;
    line-height: 1;
    color: rgba(237, 228, 212, 0.86);
    font-weight: 400;
    font-family: var(--font-body);
  }
  .sp-why {
    display: block;
    margin-top: 4px;
    letter-spacing: 0.06em;
    text-transform: none;
    color: rgba(237, 228, 212, 0.86);
  }
  /* Held unseen until the trigger, then it counts up as the picture plays. */
  .sp-scene[data-arm] .sp-n:not(.sp-dash) {
    opacity: 0;
  }
  .sp-scene[data-play] .sp-n:not(.sp-dash) {
    animation: sp-fig-in 180ms ease-out both;
  }
  @keyframes sp-fig-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .sp-u {
    max-width: 22em;
    text-wrap: balance;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.86);
  }

  /* ---------------------------------------------------------- the picture */

  /* The picture box keeps the aspect of the part of the scene it shows; the
     scene's svg is laid across it so that part, and only that, is in view. */
  .sp-pic {
    position: relative;
    aspect-ratio: var(--vw) / var(--h);
  }
  .sp-art {
    position: absolute;
    top: 0;
    left: calc(var(--x0) / var(--vw) * -100%);
    width: calc(1000 / var(--vw) * 100%);
    height: 100%;
  }
  .sp-art :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .sp-floor {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(var(--ground) / var(--h) * 100%);
    height: 1px;
  }
  /* The ground, full bleed, from the scene's ground line down to the chapter's
     end (the section clips it): the horizon the next scene's sky rises
     behind. Only the last scene ends on a hard rule. */
  .sp-land {
    position: absolute;
    z-index: 0;
    left: 50%;
    top: calc(var(--ground) / var(--h) * 100%);
    bottom: -4000px;
    width: 100vw;
    margin-left: -50vw;
    background: var(--land);
  }
  .sp-scene[data-last] .sp-land {
    border-top: 1px solid rgba(237, 228, 212, 0.16);
  }
  /* Cropped above and below only: sideways, the land runs on into the
     gutters (and past the measure on a wide screen); the section clips it at
     the screen's edge. */
  .sp-art {
    clip-path: inset(0 -100vw);
  }

  /* The part a label answers to lights; the rest falls back (PlaceScene sets data-dim). */
  .sp-art :global([data-part]) {
    transition: opacity 0.25s ease;
  }
  .sp-art :global([data-dim]) {
    opacity: 0.28;
  }
  /* Everything in the picture that no label answers to falls back too. */
  .sp-art :global(svg > :not([data-part]):not(defs)) {
    transition: opacity 0.25s ease;
  }
  .sp-scene[data-focus] .sp-art :global(svg > :not([data-part]):not(defs)) {
    opacity: 0.3;
  }

  /* ------------------------------------------------------------- the plate */

  .sp-plate {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 400px;
    padding: 2px 0 0 16px;
    border-left: 1px solid rgba(237, 228, 212, 0.24);
  }
  .sp-aside {
    margin: 0;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 17px;
    line-height: 1.4;
    color: rgba(237, 228, 212, 0.86);
  }
  .sp-say {
    display: grid;
  }
  .sp-say > p {
    grid-area: 1 / 1;
    margin: 0;
    font-size: 15px;
    line-height: 1.45;
    color: rgba(237, 228, 212, 0.86);
    text-wrap: pretty;
  }
  .sp-sizer {
    visibility: hidden;
  }
  .sp-rules,
  .sp-cap {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    letter-spacing: 0.04em;
    color: rgba(237, 228, 212, 0.86);
  }
  .sp-cap {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 14px;
  }
  .sp-hold {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    letter-spacing: inherit;
    color: rgba(237, 228, 212, 0.86);
    cursor: pointer;
  }
  .sp-hold:hover,
  .sp-hold[aria-pressed='true'] {
    color: var(--tone);
  }
  .sp-hold:focus-visible {
    outline: 2px solid var(--tone);
    outline-offset: 4px;
  }
  .sp-hold svg {
    width: 9px;
    height: 9px;
    fill: currentColor;
  }
  .sp-more {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 0.5em;
    min-height: 44px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--tone);
    text-decoration: none;
  }
  .sp-more:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .sp-more:focus-visible {
    outline: 2px solid var(--tone);
    outline-offset: 4px;
  }

  .sp-print {
    display: none;
  }

  /* ------------------------------------------------------------- narrower */

  @media (max-width: 1299px) {
    .sp-scene {
      --col: 35%;
    }
    .sp-say > p {
      font-size: 14px;
    }
  }
  /* A tablet: the heading above, the plate below, and the picture cropped to
     the part with the story in it, so labels and drawing keep their size. */
  @media (max-width: 1099px) {
    .sp-scene {
      --x0: var(--z0);
      --vw: var(--zw);
    }
    .sp-frame {
      display: flex;
      flex-direction: column;
    }
    .sp-head {
      margin-bottom: 32px;
    }
    .sp-plate {
      align-self: stretch;
      margin: 28px 0 0;
      max-width: 560px;
    }
    h2 {
      max-width: 18em;
    }
    .sp-fig {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 6px 16px;
    }
    .sp-u {
      max-width: 18em;
    }
  }
  /* A phone: the labels come off the picture into a list under it (PlaceTags). */
  @media (max-width: 759px) {
    .sp-plate {
      margin-top: 26px;
    }
    .sp-say > p {
      font-size: 14px;
    }
    .sp-aside {
      font-size: 16px;
    }
    .sp-fig {
      flex-direction: column;
      gap: 6px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sp-hold {
      display: none;
    }
    .sp-art :global([data-part]),
    .sp-art :global(svg > *) {
      transition: none;
    }
  }

  /* Print: ink on paper. The picture does not survive, so the heading and a
     list of every reading print instead. */
  @media print {
    .sp-scene {
      padding-top: 24px;
      color: #1a1008;
      break-inside: avoid;
    }
    /* The headline prints once, in the list below, not as the big figure too. */
    .sp-stage,
    .sp-plate,
    .sp-fig {
      display: none;
    }
    .sp-k,
    h2 {
      color: #1a1008;
    }
    .sp-frame {
      display: block;
    }
    .sp-print {
      display: block;
      margin: 8px 0 0;
      color: #1a1008;
      font-size: 11pt;
      line-height: 1.4;
    }
    .sp-print dt {
      margin-top: 6px;
      font-weight: 700;
    }
    .sp-print dd {
      margin: 0;
    }
  }
</style>
