<svelte:options css="injected" />

<script lang="ts" module>
  import type { Tag } from '$lib/landing/showcase-place-words';

  /** Where a label pins to its scene, in the scene's own units (1000 wide, `h` high). */
  export interface Pin {
    x: number;
    y: number;
    /** Leader length in px: up from the point, down from it, or across ('side'). */
    lead: number;
    dir?: 'up' | 'down' | 'side';
    /** Which way the text hangs off its leader. */
    hang: 'l' | 'r';
    tone?: 'accent' | 'ink' | 'good';
  }
  /**
   * Where a label pins on a tablet (the cropped picture, about 1.07px a unit
   * rather than 1.2), where the words take more of the scene: any of the
   * point and the lead, and `wrap`, the second line's measure in em.
   */
  export interface NarrowPin {
    x?: number;
    y?: number;
    lead?: number;
    wrap?: number;
  }
  export type PinnedTag = Tag & Pin & { spark?: Array<number | null> | null; narrow?: NarrowPin };
</script>

<script lang="ts">
  // The place scene's readings: real buttons pinned to their parts of the
  // picture on leader lines (a list under the picture on a phone). Which
  // label is open, peeked at or pointed at is the scene's (PlaceScene) to
  // keep, since the plate and the picture answer to it too; this draws them.
  let {
    id,
    tone,
    tags,
    shown,
    pinned = $bindable(null),
    peek = $bindable(null),
    hover = $bindable(null),
  }: {
    /** The chapter's id prefix ('sp-…'): the plate the buttons control is `{id}-say`. */
    id: string;
    tone: 'accent' | 'ink';
    tags: PinnedTag[];
    /** The label open now (pinned, peeked or pointed at), or null. */
    shown: string | null;
    pinned?: string | null;
    peek?: string | null;
    hover?: string | null;
  } = $props();

  const pos = (n: number) => String(Math.round(n * 10) / 10);
</script>

<div class="sp-tags">
  {#each tags as t (t.id)}
    <div
      class="sp-tag"
      data-part={t.id}
      data-dir={t.dir ?? 'up'}
      data-hang={t.hang}
      data-tone={t.tone ?? tone}
      data-dash={t.spoken ? '' : undefined}
      data-on={shown === t.id ? '' : undefined}
      style:--x-w={pos(t.x)}
      style:--y-w={pos(t.y)}
      style:--lead-w="{t.lead}px"
      style:--x-n={t.narrow?.x != null ? pos(t.narrow.x) : undefined}
      style:--y-n={t.narrow?.y != null ? pos(t.narrow.y) : undefined}
      style:--lead-n={t.narrow?.lead != null ? `${t.narrow.lead}px` : undefined}
      style:--wrap-n={t.narrow?.wrap != null ? `${t.narrow.wrap}em` : undefined}
    >
      <i class="sp-lead" aria-hidden="true"></i>
      <button
        type="button"
        aria-expanded={pinned === t.id}
        aria-controls="{id}-say"
        onclick={() => (pinned = pinned === t.id ? null : t.id)}
        onfocus={(e) => {
          if ((e.currentTarget as HTMLElement).matches(':focus-visible')) peek = t.id;
        }}
        onblur={() => (peek = null)}
        onpointerenter={(e) => {
          if (e.pointerType === 'mouse') hover = t.id;
        }}
        onpointerleave={() => (hover = null)}
      >
        <span class="k">{t.kicker}</span>
        <span class="vu"
          >{#if t.spoken}<span class="v" aria-hidden="true">{t.value}</span><span class="vh">{t.spoken}</span
            >{:else}<span class="v">{t.value}</span>{/if}{#if t.unit && !t.spoken}{' '}<span class="u">{t.unit}</span>{/if}</span
        >
        {#if t.spark}
          <svg class="spark" viewBox="0 0 96 18" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            {#each t.spark as v, i (i)}
              {@const peak = Math.max(1, ...t.spark.map((x) => x ?? 0))}
              {#if v == null}
                <rect class="sk-rest" x={i * 4 + 0.6} y="16" width="2.8" height="1" />
              {:else}
                <rect x={i * 4 + 0.6} y={17 - Math.max(1, (v / peak) * 16)} width="2.8" height={Math.max(1, (v / peak) * 16)} />
              {/if}
            {/each}
          </svg>
        {/if}
        {#if t.sub}<span class="s"><span class="vh">, </span>{t.sub}</span>{/if}
      </button>
    </div>
  {/each}
</div>

<style>
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

  /* ------------------------------------------------------------ the labels */

  .sp-tags {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
  }
  /* A label stands on its anchor, a zero-size box at the point it names. */
  .sp-tag {
    --x: var(--x-w);
    --y: var(--y-w);
    --lead: var(--lead-w);
    position: absolute;
    left: calc((var(--x) - var(--x0)) / var(--vw) * 100%);
    top: calc(var(--y) / var(--h) * 100%);
    width: 0;
    height: 0;
    --line: rgba(237, 228, 212, 0.42);
    --tone: var(--accent-on-dark);
  }
  .sp-tag[data-tone='ink'] {
    --tone: var(--accent-ink-on-dark);
  }
  .sp-tag[data-tone='good'] {
    --tone: var(--good-on-dark);
  }
  .sp-lead {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 1px;
    height: var(--lead);
    background: var(--line);
    transition: opacity 0.25s ease;
  }
  .sp-tag[data-dir='down'] .sp-lead {
    top: 0;
    bottom: auto;
  }
  .sp-tag[data-dir='side'] .sp-lead {
    top: 0;
    bottom: auto;
    width: var(--lead);
    height: 1px;
  }
  .sp-tag[data-dir='side'][data-hang='l'] .sp-lead {
    left: auto;
    right: 0;
  }
  .sp-lead::after {
    content: '';
    position: absolute;
    left: -2px;
    bottom: -2px;
    width: 5px;
    height: 5px;
    border-radius: 100px;
    background: var(--cream);
  }
  .sp-tag[data-dir='down'] .sp-lead::after {
    top: -2px;
    bottom: auto;
  }
  .sp-tag[data-dir='side'] .sp-lead::after {
    top: -2px;
    bottom: auto;
  }
  .sp-tag[data-dir='side'][data-hang='l'] .sp-lead::after {
    left: auto;
    right: -2px;
  }
  .sp-tag button {
    position: absolute;
    left: -1px;
    bottom: var(--lead);
    display: block;
    min-width: 44px;
    min-height: 44px;
    margin: 0;
    padding: 0 0 2px 9px;
    border: 0;
    border-left: 1px solid var(--line);
    background: none;
    font: inherit;
    text-align: left;
    white-space: nowrap;
    color: var(--cream);
    cursor: pointer;
    pointer-events: auto;
    -webkit-tap-highlight-color: transparent;
  }
  .sp-tag[data-hang='l'] button {
    left: auto;
    right: -1px;
    padding: 0 9px 2px 0;
    border-left: 0;
    border-right: 1px solid var(--line);
    text-align: right;
  }
  .sp-tag[data-dir='down'] button {
    bottom: auto;
    top: var(--lead);
  }
  .sp-tag[data-dir='side'] button {
    bottom: auto;
    top: 0;
    left: calc(var(--lead) + 4px);
    transform: translateY(-50%);
    border: 0;
    padding: 0 0 0 4px;
  }
  .sp-tag[data-dir='side'][data-hang='l'] button {
    left: auto;
    right: calc(var(--lead) + 4px);
    padding: 0 4px 0 0;
  }
  .sp-tag button:focus-visible {
    outline: 2px solid var(--tone);
    outline-offset: 4px;
  }
  .k {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--tone);
  }
  .vu {
    display: block;
    line-height: 1.15;
  }
  .v {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 24px;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    color: var(--cream);
  }
  .u {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.86);
  }
  .s {
    display: block;
    /* A label's box is shrink-to-fit on a zero-size anchor: give the second
       line its own measure, or it breaks after every word. */
    width: max-content;
    max-width: 16em;
    margin-top: 2px;
    font-size: 13px;
    line-height: 1.3;
    white-space: normal;
    color: rgba(237, 228, 212, 0.86);
  }
  .sp-tag[data-hang='l'] .s {
    margin-left: auto;
  }
  /* A reading that is not in: a light dash, never a bar the weight of a figure. */
  .sp-tag[data-dash] .v {
    font-family: var(--font-body);
    font-weight: 400;
    color: rgba(237, 228, 212, 0.86);
  }
  .spark {
    display: block;
    width: 96px;
    height: 18px;
    margin-top: 4px;
    fill: var(--tone);
  }
  .sp-tag[data-hang='l'] .spark {
    margin-left: auto;
  }
  .spark .sk-rest {
    fill: rgba(237, 228, 212, 0.3);
  }
  .sp-tag button:hover .k,
  .sp-tag[data-on] .k {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  :global(.sp-scene[data-focus]) .sp-tag:not([data-on]) .sp-lead {
    opacity: 0.4;
  }
  :global(.sp-scene[data-focus]) .sp-tag:not([data-on]) button {
    opacity: 0.45;
  }
  .sp-tag button {
    transition: opacity 0.25s ease;
  }
  /* A dark halo round every label's words, so a crest or a pole drawn behind
     never runs through them. */
  .sp-tag button {
    text-shadow:
      0 0 2px #0b0806,
      0 0 6px #0b0806,
      0 0 12px rgba(11, 8, 6, 0.8);
  }

  /* A tablet: the scene's own narrow pins, where it sets them. */
  @media (max-width: 1099px) {
    .sp-tag {
      --x: var(--x-n, var(--x-w));
      --y: var(--y-n, var(--y-w));
      --lead: var(--lead-n, var(--lead-w));
    }
    .sp-tag .s {
      max-width: var(--wrap-n, 16em);
    }
  }
  /* A phone: the labels come off the picture into a list under it. */
  @media (max-width: 759px) {
    /* Above the ground, which runs on down under the list. */
    .sp-tags {
      position: relative;
      z-index: 2;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 18px 16px;
      margin-top: 22px;
      pointer-events: auto;
    }
    .sp-tag {
      position: static;
      width: auto;
      height: auto;
    }
    .sp-lead {
      display: none;
    }
    .sp-tags .sp-tag[data-dir][data-hang] button {
      position: static;
      transform: none;
      width: 100%;
      padding: 0 0 2px 9px;
      border: 0;
      border-left: 1px solid var(--line);
      text-align: left;
      white-space: normal;
    }
    .sp-tag[data-hang] .s {
      width: auto;
      margin-left: 0;
    }
    .sp-tag[data-hang] .spark {
      margin-left: 0;
    }
    .v {
      font-size: 20px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sp-tag button,
    .sp-lead {
      transition: none;
    }
  }
</style>
