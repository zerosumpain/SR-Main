<svelte:options css="injected" />

<script lang="ts">
  // The Wildmind page: a small world where JKai and Wren have Claude for
  // minds. The map of what they have seen is drawn into the book (the sheet,
  // SnWildmindSheet) and kept live while it is on screen; under it, the same
  // devices as the pages before it: the things they have invented ringed, the
  // ideas the referee turned down struck out in pencil, the places found, and
  // the family tree written on the lines in roman numerals.
  //
  // Everything comes from the poll's latest answer (WildmindPoll, which starts
  // from what the server rendered), so the readings, the caption and the fair
  // copy move with the map. The map comes pencilled and its words placed by
  // the server (notes-sheet.server.ts, ?view=notes), so none of that code is
  // in this chunk. Names only (the people, the places, the things invented);
  // nothing any mind wrote ever reaches this page.
  import type { WildmindShowcase } from '$lib/landing/wildmind';
  import { WildmindPoll } from '../wildmind/wildmind-poll.svelte';
  import { LAYOUT_KEYS } from '$lib/landing/notes-map-pencil';
  import {
    TREE_ABSENT,
    familyLines,
    habitModels,
    latestParts,
    placesCount,
    placesLine,
    refusedLine,
    wildmindFair,
    wmPage,
  } from '$lib/landing/showcase-notes-wildmind';
  import { fig, plural, scribbles } from '$lib/landing/showcase-notes';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import SnPage from './SnPage.svelte';
  import SnFigure from './SnFigure.svelte';
  import SnNum from './SnNum.svelte';
  import SnWildmindSheet from './SnWildmindSheet.svelte';
  import { reveal } from './reveal';
  import { snap } from './snap';

  let { w: initial }: { w: WildmindShowcase } = $props();

  // svelte-ignore state_referenced_locally
  const poll = new WildmindPoll(initial, { view: 'notes' });
  let w = $derived(poll.data ?? initial);

  // Pencilled and laid out on the server; a map drawn for another view (just after a switch) waits for the poll.
  let sheet = $derived(w.map?.pencil && w.notes ? w.notes : null);
  let map = $derived(sheet ? w.map : null);
  let words = $derived(sheet?.words ?? null);
  // "Some are written on the map" only when some are, whichever layout the reader has.
  let written = $derived(!!words && LAYOUT_KEYS.every((k) => words!.places.some((l) => l.at[k] !== 0)));

  let page = $derived(wmPage(w));
  let fair = $derived(wildmindFair(w));
  let latest = $derived(latestParts(w));
  let found = $derived(placesCount(w));
  let habit = $derived(habitModels(w));
  let refused = $derived(refusedLine(w.refused));
  let places = $derived(placesLine(found, written));
  let marks = $derived(scribbles(w.refused, 5, 651));
  let tree = $derived(familyLines(w));
</script>

<SnPage id="wm" {page} {fair}>
  <SnWildmindSheet {w} {map} {sheet} people={poll.people} held={poll.held} onhold={() => poll.hold()} watch={poll.watch} />

  <div class="wm-read" use:scenery use:snap>
    <div class="wm-hl">
      <SnFigure
        f={fig(w.invented)}
        unit={plural(w.invented, 'thing invented in this valley', 'things invented in this valley')}
        mark="ring"
        tone="accent"
        size="xl"
        seed={641}
      />
      {#if latest}<p class="sn-a">{#each latest as part, i (i)}{#if part.name}<span class="wm-name">{part.t}</span>{:else}{part.t}{/if}{/each}</p>{/if}
      {#if habit}<p class="sn-a" class:wm-gap={!!latest}>{habit}</p>{/if}
    </div>

    <div class="wm-md">
      <div class="wm-small">
        {#if marks.lines.length}
          <svg class="wm-scrib" viewBox="0 0 176 {marks.lines.length * 18 + 4}" aria-hidden="true" focusable="false" use:reveal>
            {#each marks.lines as l, i (i)}<path class="line" d={l} /><path class="strike" d={marks.strikes[i]} pathLength="1" style:--i={i} />{/each}
          </svg>
        {:else}
          <span class="wm-blank" aria-hidden="true"></span>
        {/if}
        <p class="sn-f">
          {#if w.refused}<span class="wm-x" aria-hidden="true">×</span>{/if}<SnNum f={fig(w.refused)} />
          <span class="sn-u">{plural(w.refused, 'idea turned down', 'ideas turned down')}</span>
        </p>
        {#if refused}<p class="sn-a">{refused}</p>{/if}
      </div>

      <div class="wm-small">
        <p class="sn-f">
          <SnNum f={fig(found)} />
          <span class="sn-u">{plural(found, 'place found', 'places found')}</span>
        </p>
        {#if places}<p class="sn-a">{places}</p>{/if}
      </div>
    </div>

    <div class="wm-tr">
      <p class="sn-l">The family tree</p>
      {#if tree}
        <ol class="wm-tree" style:counter-reset="wm-life {tree.start - 1}">
          {#each tree.items as it, i (i)}
            <li
              data-kind={it.kind}
              data-unnumbered={it.n === null ? '' : undefined}
              style:counter-set={it.n != null ? `wm-life ${it.n}` : undefined}>{it.text}{#if it.kind === 'living'}<span class="wm-dot" aria-hidden="true"></span>{/if}</li>
          {/each}
        </ol>
        <p class="sn-a wm-gap">{tree.note}</p>
      {:else}
        <p class="sn-a">{TREE_ABSENT}</p>
      {/if}
    </div>
  </div>
</SnPage>

<!--
  Style notes, kept out of <style>: this component is in a lazy view chunk
  (css="injected"), where comments in the CSS would ship to every reader.
  - .wm-read: The readings under the map, on the page's own lines.
  - .wm-gap: A second aside after a blank rule; the first sits on the rule right under its
    label.
  - .wm-name: An invented thing's name, upright inside the italic aside, as a title is set.
  - .wm-small svg, .wm-blank: The small readings: a drawing two rules tall above the figure
    (Daydream's measures).
  - .wm-tree: The family tree, oldest first, numbered in the margin's orange. With lives
    left out, each item sets its own number (counter-set) and a life with none is unnumbered.
-->

<style>
  .wm-read {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    grid-template-areas: 'hl hl hl hl hl md md md tr tr tr tr';
    column-gap: clamp(24px, 3vw, 48px);
    row-gap: 32px;
    align-items: start;
    margin-top: 64px;
  }
  .wm-hl {
    grid-area: hl;
    min-width: 0;
  }
  .wm-md {
    grid-area: md;
    display: flex;
    flex-direction: column;
    gap: 32px;
    min-width: 0;
  }
  .wm-tr {
    grid-area: tr;
    min-width: 0;
  }
  .wm-hl .sn-a {
    max-width: 44ch;
  }
  .wm-gap {
    margin-top: 32px;
  }
  .wm-name {
    font-style: normal;
  }

  .wm-small svg,
  .wm-blank {
    display: block;
    height: 56px;
    width: auto;
    max-width: 100%;
    margin-bottom: 8px;
    overflow: visible;
  }
  .wm-small path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .wm-scrib .line {
    stroke: color-mix(in srgb, var(--text-primary) 55%, transparent);
    stroke-width: 1.3;
  }
  .wm-scrib .strike {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: 1 1.05;
  }
  .wm-scrib:global([data-armed]) .strike {
    stroke-dashoffset: 1.03;
  }
  .wm-scrib:global([data-seen]) .strike {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 420ms ease-out calc(200ms + var(--i) * 160ms);
  }
  .wm-x {
    top: -4px;
    margin-right: -6px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(28px, 2.4vw, 34px);
    line-height: 32px;
    color: var(--accent-hover);
  }

  .wm-tree {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .wm-tree li {
    position: relative;
    padding-left: 36px;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 18px;
    line-height: 32px;
    color: var(--text-secondary);
    counter-increment: wm-life;
  }
  .wm-tree li::before {
    content: counter(wm-life, lower-roman) '.';
    position: absolute;
    left: 0;
    top: 0;
    font-family: var(--font-mono);
    font-style: normal;
    font-size: var(--fs-label-xs);
    color: var(--accent-hover);
  }
  .wm-tree li[data-kind='living'],
  .wm-tree li[data-kind='ended'] {
    color: var(--text-primary);
  }
  .wm-tree li[data-kind='ghost'] {
    color: var(--text-ghost);
    counter-increment: none;
  }
  .wm-tree li[data-kind='ghost']::before,
  .wm-tree li[data-unnumbered]::before {
    content: none;
  }
  .wm-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-left: 8px;
    border-radius: 100px;
    background: var(--accent);
    vertical-align: middle;
  }

  @media (max-width: 1100px) {
    .wm-read {
      grid-template-areas:
        'hl hl hl hl hl hl hl md md md md md'
        'tr tr tr tr tr tr tr tr tr tr tr tr';
    }
    .wm-tr {
      max-width: 560px;
    }
  }
  @media (max-width: 760px) {
    .wm-read {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'hl' 'md' 'tr';
    }
  }
</style>
