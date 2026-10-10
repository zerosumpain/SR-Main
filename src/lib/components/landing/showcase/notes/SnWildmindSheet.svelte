<svelte:options css="injected" />

<script lang="ts">
  // The Wildmind map drawn into the notebook: the valley as the two of them
  // have seen it, pencilled in coloured pencil inside a hand-drawn double neat
  // line, with everything they have not seen left as the page's own ruled
  // paper, and the edge of what they've seen a faint broken pencil line (not
  // a coast). Huts that stand together are one camp: a smooth pencilled fence
  // round them on plain paper, each hut a small square inside. Over it, in the
  // page's hand and each on a rubbed-clear patch of paper so it reads on any
  // ground: who is where ("JKai is walking"), the places they are near and a
  // few more by name, each with its pencil cross (unwritten places get no
  // mark), whether they have met (only ever on blank paper), and the valley's
  // day rubber-stamped across the foot as the cover stamps the date. Under it
  // the scale, the key (everything drawn has a line) and the caption, which
  // is the map in words (everything drawn here is aria-hidden).
  //
  //  - The frame keeps the book's measure: it fills the column and is a whole
  //    number of rules tall (CSS round(), from the map's own shape). On a
  //    phone a wide map turns a quarter, west at the top, so it is not a
  //    thumbnail; the words sit in a layer of their own that never turns.
  //    Whether it turns is fixed on the server (data-turn) and only the CSS
  //    acts on it, so nothing is measured in the browser.
  //  - Where the words go is worked out per layout on the server
  //    (notes-map-words.ts, through notes-sheet.server.ts) and
  //    chosen by CSS, so nothing is laid out per frame.
  //  - First seen, it draws itself as every page does: the neat line, then the
  //    colouring-in class by class, then the camps, huts and animals, then the
  //    people and the words, then the stamp, in about a second as the rings
  //    on the pages before it. Server HTML, no JavaScript and reduced
  //    motion show it all drawn. After that the only motion is the core's
  //    two-second glide when someone moves, and "hold still" stops even that.
  //  - It is the drawing, so it goes with .sp-draw in print and in fair copy.
  import type { WildmindNotesSheet, WildmindPerson, WildmindShowcase, WildmindMap as MapData } from '$lib/landing/wildmind';
  import type { MapWords } from '$lib/landing/notes-map-words';
  import { neatStrips, scaleBar, TURN_AT } from '$lib/landing/notes-map-pencil';
  import { NIGHT_AT, captionLine, emptyNote, figLabel, isPast, keyItems, stampWords, stateNote, tagWords } from '$lib/landing/showcase-notes-wildmind';
  import { moon, inkArrow } from '$lib/landing/showcase-notes';
  import { inkLine, rng } from '$lib/landing/notes-ink';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import WildmindMap, { type WildmindLayer } from '../wildmind/WildmindMap.svelte';
  import HoldStill from '../wildmind/HoldStill.svelte';
  import SnWildmindKey from './SnWildmindKey.svelte';
  import { reveal } from './reveal';
  import { snap } from './snap';

  let {
    w,
    map,
    sheet,
    people,
    held,
    onhold,
    watch,
  }: {
    w: WildmindShowcase;
    /** The map pencilled on the server (notes-sheet.server.ts), or null. */
    map: MapData | null;
    /** The rest of the drawing from the server: the words' places, the camps' fences, the counts and the mark size. */
    sheet: WildmindNotesSheet | null;
    /** Where the people are drawn right now (the poll's glide). */
    people: WildmindPerson[];
    held: boolean;
    onhold: () => void;
    /** The poll's action: polls only while the map is on screen. */
    watch: (node: Element) => { destroy(): void };
  } = $props();

  const uid = $props.id();
  const frameId = `sn-wm-frame-${uid}`;
  const STRIPS = neatStrips(611).map((s, i) => ({ ...s, delay: (i % 4) * 60 + (s.box === 'inner' ? 150 : 0) }));
  const STAMP = [
    inkLine(rng(621), 2, 2, 98, 2.5, 0.3, 0.004),
    inkLine(rng(622), 98, 2, 97.5, 38, 0.3, 0.01),
    inkLine(rng(623), 98, 38, 2, 37.5, 0.3, 0.004),
    inkLine(rng(624), 2, 38, 2.5, 2, 0.3, 0.01),
  ].join(' ');
  const BAR = `${inkLine(rng(625), 1, 6, 99, 6, 0.4, 0.004)} M1,1 L1,11 M99,1 L99,11`;
  const MOON = moon(171);
  // The pen arrow from a tag to its disc, drawn for a tag down and to the right; CSS mirrors it to the tag's side.
  const ARROWS: Record<string, { shaft: string; head: string }> = {
    main: inkArrow(rng(631), 43, 29, 9, 8, 0.16),
    companion: inkArrow(rng(632), 43, 29, 9, 8, -0.16),
  };

  let asp = $derived(map ? Math.round((map.w / map.h) * 10_000) / 10_000 : 1.5);
  let turn = $derived(!!map && map.w / map.h >= TURN_AT);
  let label = $derived(figLabel(w));
  let note = $derived(stateNote(w));
  let stamp = $derived(stampWords(w));
  let night = $derived((w.night ?? 0) >= NIGHT_AT);
  let bar = $derived(map ? scaleBar(map) : null);
  let past = $derived(isPast(w));
  let words = $derived<MapWords | null>(sheet?.words ?? null);
  let camp = $derived(sheet?.camp ?? '');
  /** Map units a design unit of a mark: the same size on the page whatever the map's resolution. */
  let k = $derived(sheet?.mark ?? 1);
  let key = $derived(
    keyItems(map, {
      camps: sheet?.camps ?? 0,
      huts: sheet?.huts ?? 0,
      animals: w.animals.length,
    }),
  );
  // "hold still" only while something moves: not over a valley that isn't answering or is paused.
  let still = $derived(w.state !== 'offline' && w.state !== 'stale' && w.state !== 'paused');
  const f4 = (n: number) => Math.round(n * 10_000) / 10_000;
  const LAYOUTS = ['w', 'n', 't'] as const;
  const bareAt = (b: Record<string, { x: number; y: number } | null>) => {
    const p = Object.values(b).find(Boolean);
    return p ? `;--px:${p.x};--py:${p.y}` : '';
  };
  const DIR = (d: number) => (d === 1 ? 'r' : d === -1 ? 'l' : d === 2 ? 'a' : d === -2 ? 'b' : '0');
  const side = (t: MapWords['tags'][string] | undefined) =>
    t ? `--sx-w:${t.w.sx};--sy-w:${t.w.sy};--sx-n:${t.n.sx};--sy-n:${t.n.sy};--sx-t:${t.t.sx};--sy-t:${t.t.sy}` : '';
</script>

<!-- The hatching is drawn for markScale 1 and scaled with it, so it keeps its weight on the page. -->
{#snippet defs({ uid }: WildmindLayer)}
  <pattern id="{uid}-wood" patternUnits="userSpaceOnUse" width="1.4" height="1.4" patternTransform="rotate(45) scale({k})">
    <rect class="pw" width="1.4" height="1.4" /><path class="pw-l" d="M0,.7h1.4" />
  </pattern>
  <pattern id="{uid}-wet" patternUnits="userSpaceOnUse" width="2.4" height="2.4" patternTransform="scale({k})">
    <rect class="pm" width="2.4" height="2.4" /><path class="pm-l" d="M.6,1.6v-.6M.9,1.6v-.8M1.2,1.6v-.6" />
  </pattern>
  <pattern id="{uid}-high" patternUnits="userSpaceOnUse" width="1.6" height="1.6" patternTransform="rotate(45) scale({k})">
    <rect class="ph" width="1.6" height="1.6" /><path class="ph-l" d="M0,.8h1.6M.8,0v1.6" />
  </pattern>
{/snippet}

{#snippet under(_l: WildmindLayer)}
  {#if camp}<path class="wm-camp" d={camp} />{/if}
{/snippet}

<figure class="wm-fig" use:scenery use:snap use:watch>
  <div class="wm-lrow">
    <p class="sn-l">{label}</p>
    {#if still}<span class="wm-hs"><HoldStill {held} {onhold} controls={frameId} /></span>{/if}
  </div>
  {#if note}<p class="sn-a wm-note">{note}</p>{/if}

  <div class="wm-box" data-turn={turn ? '' : undefined} data-empty={map ? undefined : ''} style:--asp={asp}>
    <div class="wm-frame" id={frameId} data-stale={w.state === 'stale' ? '' : undefined} use:reveal>
      {#each STRIPS as s (s.box + s.edge)}
        <svg
          class="nl"
          data-box={s.box}
          data-edge={s.edge}
          viewBox={s.edge === 'top' || s.edge === 'bottom' ? '0 0 1000 8' : '0 0 8 1000'}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
          style:--d="{s.delay}ms"><path d={s.d} pathLength="1" /></svg
        >
      {/each}

      <div class="wm-clip">
        {#if map}
          <div class="wm-turn">
            <WildmindMap
              {map}
              id="sn-wm"
              {people}
              animals={w.animals}
              structures={w.structures}
              fires={w.fires}
              species={w.species}
              night={w.night}
              mark={k}
              trails={w.state !== 'stale'}
              patterns={{ wood: 'wood', wet: 'wet', high: 'high' }}
              {defs}
              {under}
            />
          </div>
          {#if words}
            <div class="wm-tags" aria-hidden="true">
              {#each words.places as l (l.name)}
                <span
                  class="wm-t wm-pl"
                  data-w={DIR(l.at.w)}
                  data-n={DIR(l.at.n)}
                  data-t={DIR(l.at.t)}
                  data-bare={l.bare ? LAYOUTS.filter((k) => l.bare?.[k]).join(' ') : undefined}
                  style="--lx:{l.x};--ly:{l.y}{l.bare ? bareAt(l.bare) : ''}"
                  ><i class="wm-cr"></i><span class="wm-pn">{l.name}</span></span
                >
              {/each}
              {#if words.met}
                {#each LAYOUTS as k (k)}
                  {@const m = words.met[k]}
                  {#if m}<span class="wm-t wm-met" data-for={k} style="--x:{f4(m.x)};--y:{f4(m.y)}">they haven’t met yet</span>{/if}
                {/each}
              {/if}
              {#each people as p (p.id)}
                {@const t = tagWords(p, past)}
                {@const a = ARROWS[p.id] ?? ARROWS.main}
                <span class="wm-t wm-tag" data-who={p.id} style="--x:{f4(p.x / map.w)};--y:{f4(p.y / map.h)};{side(words.tags[p.id])}">
                  <svg class="wm-arrow" viewBox="0 0 46 32" aria-hidden="true" focusable="false"><path d={a.shaft} /><path d={a.head} /></svg>
                  <span class="wm-tt"><b>{t.name}</b>{t.rest}</span>
                </span>
              {/each}
            </div>
          {/if}
        {:else}
          <p class="sn-a wm-empty">{emptyNote(w)}</p>
        {/if}
      </div>

      {#if map}
        <svg class="wm-moon" data-on={night ? '' : undefined} viewBox="0 0 80 64" aria-hidden="true" focusable="false"
          ><path class="mb" d={MOON.body} /><path class="ms" d={MOON.stars} /></svg
        >
      {/if}
      {#if stamp}
        <p class="wm-stamp" data-faded={stamp.faded ? '' : undefined} aria-hidden="true">
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d={STAMP} /></svg>
          <span class="s1">{stamp.one}</span>{#if stamp.two}<span class="s2">{stamp.two}</span>{/if}
        </p>
      {/if}
    </div>

    {#if map && bar}
      <div class="wm-axis" aria-hidden="true">
        <span class="wm-sc" data-for="wide" style:--k={bar.wide.k}
          ><svg viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d={BAR} /></svg>{bar.wide.words}</span
        >
        <span class="wm-sc" data-for="turned" style:--k={bar.turned.k}
          ><svg viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d={BAR} /></svg>{bar.turned.words}</span
        >
      </div>
    {/if}
  </div>

  {#if map}
    <SnWildmindKey items={key} />
    <figcaption class="sn-cap">{captionLine(w, held)}</figcaption>
  {/if}
</figure>

<!--
  Style notes, kept out of <style>: this component is in a lazy view chunk
  (css="injected"), where comments in the CSS would ship to every reader.

  The figure
  - .wm-fig: the page's own pens, mixed with its paper: every colour here follows the tokens.
    --wm-edge is the edge of what they've seen: a faint broken pencil line, so it never reads
    as a coast. --wm-night darkens the paper in the petrol ink (a brown wash read as a coffee
    stain).
  - .wm-lrow: the label row: the label left, "hold still" right, both in the label's mono caps.
    The button sets its own case, so it is told to write in the label's caps; its focus ring
    sits inside the label's rule, clear of the label line and the neat line under it.

  The frame
  - .wm-box --fh: flat, as wide as the column and as tall as the map's shape allows, in whole
    rules.
  - .nl: the neat line: two hand-drawn boxes, each four strips stretched only along their
    length.

  The map's marks
  - .wm-built: a hut, a small square pencilled in, alone or inside a camp's fence.
  - .wm-camp: one smooth pencilled fence round its huts, on plain paper (no hatching, which
    read as weather).
  - .wm-p[data-alive='no'] .wm-disc: where JKai died: an empty ring in their pencil, solid and a
    size up, so "died here" has something to point at on a phone.
  - .wm-frame[data-stale] .wm-turn: not answering: the map greys a touch, as a page left in
    the sun.

  The words over the map (never turned)
  - .wm-pn, .wm-met, .wm-tt: every word is written on a patch of paper rubbed clear, so it
    reads on any ground, wash or hatching.
  - .wm-pl: a place: its cross at the point, its name beside it (right, left, above or below,
    per layout); unwritten places get neither. Anchored at its cross; or, written by the disc
    of the person standing on it, at them, a disc's width off and with no cross.
  - .wm-tag: the words out on one diagonal from the disc, and a pen arrow back to it (straight
    over or under it on a narrow map, sx 0: the words centred, no arrow).
  - .wm-moon: the moon in the frame's top corner by night (the health page's doodle).
  - .wm-stamp: the valley's day, stamped across the frame's foot: rotated, so never a floor.

  First seen: drawn in
  - About a second, as the rings on the pages before it: the neat line, the colouring-in (a
    class at a time), then the camps, huts and animals, then the people and the words, then
    the stamp.

  Layouts
  - Each layout has its own choice of words (notes-map-words.ts works them out on the server
    at the narrowest width of each): the tag sides, which places are written and on which
    side, and where the met note goes. A squarer map lies flat on a phone; a wide one turns
    a quarter, west at the top, and its words stay upright. The stamp's overhang gets a rule
    of its own (.wm-axis).
-->

<style>
  .wm-fig {
    --wm-ground: color-mix(in srgb, var(--good) 11%, var(--surface-card));
    --wm-open: var(--wm-ground);
    --wm-shore: color-mix(in srgb, var(--accent) 14%, var(--bg));
    --wm-fresh: color-mix(in srgb, var(--accent-ink) 22%, var(--bg));
    --wm-sea: color-mix(in srgb, var(--accent-ink) 30%, var(--bg));
    --wm-wood: color-mix(in srgb, var(--good) 30%, var(--bg));
    --wm-wet: color-mix(in srgb, var(--accent-ink) 12%, color-mix(in srgb, var(--good) 22%, var(--bg)));
    --wm-high: color-mix(in srgb, var(--text-primary) 12%, var(--bg));
    --wm-coast: var(--accent-ink);
    --wm-coast-width: 1.2px;
    --wm-edge: var(--text-muted);
    --wm-edge-width: 0.8px;
    --wm-edge-dash: 3 4;
    --wm-relief-line: none;
    --wm-night: var(--accent-ink);
    --wm-night-strength: 0.11;
    --wm-jkai: var(--accent);
    --wm-companion: var(--accent-ink);
    --wm-halo: var(--bg);
    --wm-built: var(--text-secondary);
    --wm-built-edge: none;
    --wm-lit: var(--accent);
    --wm-fire: var(--accent);
    --wm-animal: var(--text-muted);
    --wm-trail-width: 1.4px;
    --wm-trail-dash: 0.1 3.6;
    --wm-hold: var(--accent-ink);
    --wm-hold-on: var(--accent-hover);
    --wm-focus: var(--accent-hover);
    margin: 64px 0 0;
  }

  .wm-lrow {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    column-gap: 24px;
    font: 400 var(--fs-label-xs) / 32px var(--font-mono);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .wm-hs {
    display: flex;
    align-items: center;
    height: 32px;
  }
  .wm-hs :global(button) {
    margin-right: -10px;
    padding-inline: 10px;
    text-transform: uppercase;
  }
  .wm-hs :global(button:focus-visible) {
    outline-offset: -7px;
  }
  .wm-note {
    max-width: 60ch;
  }


  .wm-box {
    container-type: inline-size;
    --fh: clamp(384px, round(down, 100cqw / var(--asp), 32px), 672px);
    --mw: min(100cqw - 20px, (var(--fh) - 20px) * var(--asp));
    --mh: calc(var(--mw) / var(--asp));
  }
  .wm-frame {
    position: relative;
    height: var(--fh);
  }
  .wm-box[data-empty] .wm-frame {
    height: 384px;
  }
  .wm-clip {
    position: absolute;
    inset: 10px;
    overflow: hidden;
  }
  .wm-turn,
  .wm-tags {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
  }
  .wm-turn {
    width: var(--mw);
  }
  .wm-tags {
    width: var(--mw);
    height: var(--mh);
    pointer-events: none;
  }
  .wm-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 24px;
    text-align: center;
  }

  .nl {
    --i: 0px;
    position: absolute;
    overflow: visible;
    pointer-events: none;
  }
  .nl[data-box='inner'] {
    --i: 6px;
  }
  .nl[data-edge='top'],
  .nl[data-edge='bottom'] {
    left: var(--i);
    width: calc(100% - 2 * var(--i));
    height: 8px;
  }
  .nl[data-edge='top'] {
    top: calc(var(--i) - 4px);
  }
  .nl[data-edge='bottom'] {
    bottom: calc(var(--i) - 4px);
  }
  .nl[data-edge='left'],
  .nl[data-edge='right'] {
    top: var(--i);
    height: calc(100% - 2 * var(--i));
    width: 8px;
  }
  .nl[data-edge='left'] {
    left: calc(var(--i) - 4px);
  }
  .nl[data-edge='right'] {
    right: calc(var(--i) - 4px);
  }
  .nl path {
    fill: none;
    stroke: var(--text-primary);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-dasharray: 1 1.05;
  }
  .nl[data-box='inner'] path {
    stroke: var(--text-secondary);
    stroke-width: 0.8;
  }


  .pw {
    fill: var(--wm-wood);
  }
  .pw-l {
    stroke: var(--good);
    stroke-width: 0.2;
    opacity: 0.55;
  }
  .pm {
    fill: var(--wm-wet);
  }
  .pm-l {
    fill: none;
    stroke: var(--good);
    stroke-width: 0.18;
    stroke-linecap: round;
  }
  .ph {
    fill: var(--wm-high);
  }
  .ph-l {
    stroke: var(--text-primary);
    stroke-width: 0.12;
    opacity: 0.35;
  }
  .wm-frame :global(.wm-built) {
    transform-box: fill-box;
    transform-origin: center;
    scale: 0.8;
  }
  .wm-camp {
    fill: var(--surface-card);
    stroke: var(--text-secondary);
    stroke-width: 1.3px;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .wm-frame :global(.wm-p[data-alive='no'] .wm-disc) {
    fill: color-mix(in srgb, var(--wm-jkai) 14%, var(--bg));
    stroke-width: 2px;
    stroke-dasharray: none;
    transform-box: fill-box;
    transform-origin: center;
    scale: 1.25;
  }
  .wm-frame[data-stale] .wm-turn {
    opacity: 0.8;
  }
  .wm-frame :global(.wm-night) {
    transition: opacity 4s linear;
  }


  .wm-t {
    --sx: var(--sx-w);
    --sy: var(--sy-w);
    position: absolute;
    left: calc(var(--x) * 100%);
    top: calc(var(--y) * 100%);
    white-space: nowrap;
  }
  .wm-pn,
  .wm-met,
  .wm-tt {
    padding: 0 4px;
    border-radius: 2px;
    background: var(--bg);
    box-shadow: 0 0 3px 1px var(--bg);
  }
  .wm-pl {
    --x: var(--lx);
    --y: var(--ly);
    --gx: 3px;
    --gy: 5px;
    width: 0;
    height: 0;
  }
  .wm-cr {
    position: absolute;
    left: -5px;
    top: -5px;
    width: 10px;
    height: 10px;
    background:
      linear-gradient(var(--text-secondary), var(--text-secondary)) center / 10px 1.2px no-repeat,
      linear-gradient(var(--text-secondary), var(--text-secondary)) center / 1.2px 10px no-repeat;
  }
  .wm-pn {
    position: absolute;
    left: 0;
    top: 0;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 15px;
    line-height: 20px;
    color: var(--text-secondary);
  }
  .wm-pl[data-w='0'] {
    display: none;
  }
  .wm-pl[data-bare~='w'] {
    --x: var(--px);
    --y: var(--py);
    --gx: 14px;
    --gy: 14px;
  }
  .wm-pl[data-bare~='w'] .wm-cr {
    display: none;
  }
  .wm-pl[data-w='r'] .wm-pn {
    transform: translate(var(--gx), -50%);
  }
  .wm-pl[data-w='l'] .wm-pn {
    transform: translate(calc(-100% - var(--gx)), -50%);
  }
  .wm-pl[data-w='a'] .wm-pn {
    transform: translate(-50%, calc(-100% - var(--gy)));
  }
  .wm-pl[data-w='b'] .wm-pn {
    transform: translate(-50%, var(--gy));
  }
  .wm-met {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 17px;
    line-height: 24px;
    color: var(--text-muted);
    transform: translate(-50%, -50%);
  }
  .wm-met:not([data-for='w']) {
    display: none;
  }
  .wm-tag {
    width: 0;
    height: 0;
  }
  .wm-tt {
    position: absolute;
    left: 0;
    top: 0;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 17px;
    line-height: 24px;
    color: var(--text-secondary);
    transform: translate(calc(var(--sx) * 42px + (var(--sx) - 1) * 50%), calc(var(--sy) * (12px + var(--sx) * var(--sx) * 14px) + (var(--sy) - 1) * 50%));
  }
  .wm-tt b {
    font-weight: 500;
    color: var(--accent-hover);
  }
  .wm-tag[data-who='companion'] .wm-tt b {
    color: var(--accent-ink);
  }
  .wm-arrow {
    position: absolute;
    left: 0;
    top: 0;
    width: 46px;
    height: 32px;
    overflow: visible;
    transform-origin: 0 0;
    transform: scale(var(--sx), var(--sy));
  }
  .wm-arrow path {
    fill: none;
    stroke: var(--text-secondary);
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .wm-moon {
    position: absolute;
    top: 18px;
    right: 22px;
    width: 48px;
    height: 38px;
    overflow: visible;
    opacity: 0;
    transition: opacity 400ms ease-out;
  }
  .wm-moon[data-on] {
    opacity: 1;
  }
  .wm-moon path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .wm-moon .mb {
    stroke: var(--accent-ink);
    stroke-width: 1.6;
    fill: color-mix(in srgb, var(--accent-ink) 15%, transparent);
  }
  .wm-moon .ms {
    stroke: var(--accent);
    stroke-width: 1.4;
  }

  .wm-stamp {
    position: absolute;
    right: 24px;
    bottom: -26px;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0;
    padding: 6px 14px 7px;
    font-family: var(--font-mono);
    text-transform: uppercase;
    color: var(--accent-hover);
    background: var(--bg);
    opacity: 0.88;
    transform: rotate(-4deg);
    pointer-events: none;
  }
  .wm-stamp svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .wm-stamp path {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .s1 {
    font-size: 15px;
    font-weight: 600;
    line-height: 20px;
    letter-spacing: 0.16em;
  }
  .s2 {
    font-size: var(--fs-label-xs);
    line-height: 16px;
    letter-spacing: 0.14em;
  }
  .wm-stamp[data-faded] {
    color: var(--text-muted);
    opacity: 0.6;
  }
  .wm-stamp[data-faded] path {
    stroke: var(--text-muted);
  }


  .wm-axis {
    display: flex;
    justify-content: flex-start;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 32px;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .wm-sc {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .wm-sc svg {
    display: block;
    width: calc(var(--mw) * var(--k));
    height: 12px;
    overflow: visible;
  }
  .wm-sc path {
    fill: none;
    stroke: var(--text-primary);
    stroke-width: 1.3;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .wm-sc[data-for='turned'] {
    display: none;
  }

  .wm-frame:global([data-armed]:not([data-seen])) .nl path {
    stroke-dashoffset: 1.03;
  }
  .wm-frame:global([data-seen]) .nl path {
    animation: wm-draw 500ms cubic-bezier(0.3, 0.7, 0.2, 1) var(--d) both;
  }
  .wm-frame:global([data-armed]:not([data-seen])) :global(:is(.wm-ground > *, .wm-night, .wm-marks > *)),
  .wm-frame:global([data-armed]:not([data-seen])) .wm-camp,
  .wm-frame:global([data-armed]:not([data-seen])) .wm-tags,
  .wm-frame:global([data-armed]:not([data-seen])) .wm-moon,
  .wm-frame:global([data-armed]:not([data-seen])) .wm-stamp {
    opacity: 0;
  }
  .wm-frame:global([data-seen]) :global(:is(.wm-ground > *, .wm-night)) {
    animation: wm-in 240ms ease-out var(--wm-at, 150ms) both;
  }
  .wm-frame :global(.wm-l[data-cls='open']) {
    --wm-at: 200ms;
  }
  .wm-frame :global(.wm-l[data-cls='wood']) {
    --wm-at: 250ms;
  }
  .wm-frame :global(.wm-l[data-cls='wet']) {
    --wm-at: 300ms;
  }
  .wm-frame :global(.wm-l[data-cls='shore']) {
    --wm-at: 350ms;
  }
  .wm-frame :global(.wm-l[data-cls='fresh']) {
    --wm-at: 400ms;
  }
  .wm-frame :global(.wm-l[data-cls='sea']) {
    --wm-at: 450ms;
  }
  .wm-frame :global(:is(.wm-l[data-cls='high'], .wm-night)) {
    --wm-at: 500ms;
  }
  .wm-frame:global([data-seen]) .wm-camp,
  .wm-frame:global([data-seen]) :global(.wm-marks > :is(.wm-animal, .wm-built, .wm-lit, .wm-fire)) {
    animation: wm-in 180ms ease-out 620ms both;
  }
  .wm-frame:global([data-seen]) :global(.wm-marks > :is(.wm-trail, .wm-p)),
  .wm-frame:global([data-seen]) .wm-tags,
  .wm-frame:global([data-seen]) .wm-moon {
    animation: wm-in 180ms ease-out 800ms both;
  }
  .wm-frame:global([data-seen]) .wm-stamp {
    animation: wm-stamp 160ms ease-out 1050ms both;
  }
  @keyframes wm-in {
    from {
      opacity: 0;
    }
  }
  @keyframes wm-draw {
    from {
      stroke-dashoffset: 1.03;
    }
  }
  @keyframes wm-stamp {
    from {
      opacity: 0;
      transform: rotate(-4deg) scale(1.08);
    }
  }


  @media (max-width: 1279px) {
    .wm-t {
      --sx: var(--sx-n);
      --sy: var(--sy-n);
    }
    .wm-pl[data-n='0'] {
      display: none;
    }
    .wm-pl[data-n='r'] {
      display: block;
    }
    .wm-pl[data-n='r'] .wm-pn {
      transform: translate(var(--gx), -50%);
    }
    .wm-pl[data-n='l'] {
      display: block;
    }
    .wm-pl[data-n='l'] .wm-pn {
      transform: translate(calc(-100% - var(--gx)), -50%);
    }
    .wm-pl[data-n='a'] {
      display: block;
    }
    .wm-pl[data-n='a'] .wm-pn {
      transform: translate(-50%, calc(-100% - var(--gy)));
    }
    .wm-pl[data-n='b'] {
      display: block;
    }
    .wm-pl[data-n='b'] .wm-pn {
      transform: translate(-50%, var(--gy));
    }
    .wm-pn {
      font-size: var(--fs-label);
      line-height: 18px;
    }
    .wm-pl[data-bare] {
      --x: var(--lx);
      --y: var(--ly);
      --gx: 3px;
      --gy: 5px;
    }
    .wm-pl[data-bare] .wm-cr {
      display: block;
    }
    .wm-pl[data-bare~='n'] {
      --x: var(--px);
      --y: var(--py);
      --gx: 14px;
      --gy: 14px;
    }
    .wm-pl[data-bare~='n'] .wm-cr {
      display: none;
    }
    .wm-met[data-for='w'] {
      display: none;
    }
    .wm-met[data-for='n'] {
      display: block;
    }
  }
  @media (max-width: 760px) {
    .wm-t {
      --sx: var(--sx-t);
      --sy: var(--sy-t);
    }
    .wm-pl[data-t='0'] {
      display: none;
    }
    .wm-pl[data-t='r'] {
      display: block;
    }
    .wm-pl[data-t='r'] .wm-pn {
      transform: translate(var(--gx), -50%);
    }
    .wm-pl[data-t='l'] {
      display: block;
    }
    .wm-pl[data-t='l'] .wm-pn {
      transform: translate(calc(-100% - var(--gx)), -50%);
    }
    .wm-pl[data-t='a'] {
      display: block;
    }
    .wm-pl[data-t='a'] .wm-pn {
      transform: translate(-50%, calc(-100% - var(--gy)));
    }
    .wm-pl[data-t='b'] {
      display: block;
    }
    .wm-pl[data-t='b'] .wm-pn {
      transform: translate(-50%, var(--gy));
    }
    .wm-met[data-for='n'] {
      display: none;
    }
    .wm-pl[data-bare] {
      --x: var(--lx);
      --y: var(--ly);
      --gx: 3px;
      --gy: 5px;
    }
    .wm-pl[data-bare] .wm-cr {
      display: block;
    }
    .wm-pl[data-bare~='t'] {
      --x: var(--px);
      --y: var(--py);
      --gx: 14px;
      --gy: 14px;
    }
    .wm-pl[data-bare~='t'] .wm-cr {
      display: none;
    }
    .wm-met[data-for='t'] {
      display: block;
    }
    .wm-tt,
    .wm-met {
      font-size: var(--fs-body);
    }
    .wm-box {
      --fh: clamp(288px, round(nearest, (100cqw - 20px) / var(--asp) + 20px, 32px), 544px);
    }
    .wm-box[data-turn] {
      --fh: clamp(384px, round(nearest, (100cqw - 20px) * var(--asp) + 20px, 32px), 544px);
      --mw: min(var(--fh) - 20px, (100cqw - 20px) * var(--asp));
    }
    .wm-box[data-turn] .wm-turn {
      rotate: 90deg;
    }
    .wm-box[data-turn] .wm-tags {
      width: var(--mh);
      height: var(--mw);
    }
    .wm-box[data-turn] .wm-t {
      left: calc((1 - var(--y)) * 100%);
      top: calc(var(--x) * 100%);
    }
    .wm-box[data-turn] .wm-sc[data-for='wide'] {
      display: none;
    }
    .wm-box[data-turn] .wm-sc[data-for='turned'] {
      display: inline-flex;
    }
    .wm-box[data-turn] .wm-sc[data-for='turned'] svg {
      width: calc(var(--mh) * var(--k));
    }
    .wm-axis {
      margin-top: 32px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .wm-frame :global(.wm-night),
    .wm-moon {
      transition: none;
    }
  }
</style>
