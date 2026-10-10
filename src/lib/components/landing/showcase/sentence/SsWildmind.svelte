<svelte:options css="injected" />

<script lang="ts">
  // Wildmind's plate in the sentence view: the map of the valley the two of
  // them have seen, set in the main column where every other chapter puts its
  // picture, with its caption in the margin (the label, a line a person saying
  // what they're doing, and the page's "hold still"). Under the map, a scale
  // bar and a key, in the margin charts' ends-and-key type.
  //
  // It is drawn in the essay's own inks, engraved rather than pixelled: the
  // tracer's two-metre steps are smoothed into curves (wildmind-smooth.ts),
  // specks are dropped, and only the outer rim of the known land and the
  // water's edge carry a line. The known land is card paper on the page's
  // paper, woods a fine hatch, marsh short dashes, high ground a stipple,
  // water a petrol tint, JKai in the chapter's orange and Wren in its petrol
  // (the same colours as their names in the prose). What they've built is a
  // dashed camp fence where it crowds together, with the things in it drawn
  // faint inside, and a small square elsewhere (builtMarks). Animals are
  // small open rings, so they never read as built. A fifty-metre survey grid
  // sits under it all as a CSS background, centred on the sheet so the part
  // squares at its edges match, and the unseen land between two explored
  // patches reads as unsurveyed rather than missing. The frame is always three by two with a
  // margin round the land, so nothing under it moves as the map grows and no
  // coast runs into the neat line. Place names are HTML over the map
  // (wildmind-labels.ts places them), never SVG text: the places someone is
  // near at any width, the rest only where the map is wide enough. Night is
  // left to the margin's side line: a wash would make the known land darker
  // than the unknown paper round it.
  //
  // Motion: the ground, then the marks, fade in once on first view (only when
  // the plate starts below the fold); the people glide between polls (the
  // poll moves them). Under reduced motion there is none of that, and each
  // answer simply replaces the frame. Print gets the map in ink, with JKai as
  // a solid disc and Wren as a ring. Between lives the map is as JKai left it,
  // so every disc is drawn hollow.
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { WildmindPerson, WildmindShowcase } from '$lib/landing/wildmind';
  import { frameRect } from '$lib/landing/wildmind-frame';
  import { placeLabels } from '$lib/landing/wildmind-labels';
  import { smoothMap } from '$lib/landing/wildmind-smooth';
  import { builtMarks, plateFrame, plateSummary, plateWords } from '$lib/landing/showcase-sentence-wildmind';
  import { belowFold, firstView, prefersReducedMotion } from '$lib/landing/showcase-motion';
  import WildmindMap from '../wildmind/WildmindMap.svelte';
  import HoldStill from '../wildmind/HoldStill.svelte';

  let {
    w,
    people,
    held,
    onhold,
  }: {
    /** What the poll holds now (with a map: the chapter only sets a plate when there is one). */
    w: WildmindShowcase;
    /** The people where they are drawn right now (the poll's glide). */
    people: WildmindPerson[];
    held: boolean;
    onhold: () => void;
  } = $props();

  /** The map's drawn width; before it is measured, a 1440 desktop's. */
  let boxW = $state(909);
  let el = $state<HTMLElement>();
  let armed = $state(false);
  let seen = $state(false);
  let reduced = $state(false);
  onMount(() => {
    reduced = prefersReducedMotion();
    armed = belowFold(el) && !reduced;
  });

  let map = $derived(w.map);
  // Smoothed once per map version; the plate shows high ground by class, not the relief outline.
  let drawn = $derived(map ? { ...smoothMap(map), relief: null } : null);
  let built = $derived(builtMarks(w.structures, map?.metresPerUnit));
  let plate = $derived(map ? plateFrame(map) : undefined);
  let frame = $derived(map ? frameRect(map, plate) : { x: 0, y: 0, w: 1, h: 1 });
  let ppu = $derived(Math.max(0.01, boxW) / frame.w);
  let big = $derived(boxW >= 600);
  let rPx = $derived(big ? 5 : 4.5);
  let mark = $derived(rPx / (1.5 * ppu));
  /** Pixels on screen to map units. */
  const u = (px: number) => Math.round((px / ppu) * 1000) / 1000;
  let words = $derived(plateWords(w));
  // Placed on each answer (the people's end positions), never per glide frame.
  let labels = $derived(
    map ? placeLabels({ labels: map.labels, frame, people: w.people, width: boxW, rPx, marks: built.clear, soft: built.soft }) : { people: [], places: [] },
  );
  /** A lone built thing: 0.6 of a cell, never under four pixels. */
  let sq = $derived(Math.max(0.6, 4 / ppu));
  let past = $derived(w.state === 'between-lives');
  let keys = $derived((words?.keys ?? []).filter((k) => big || k !== 'animals'));
  let side = $derived(Object.fromEntries(labels.people.map((p) => [p.id, p.side])) as Record<string, 'l' | 'r'>);
  let patterns = $derived(big ? { wood: 'wood', wet: 'wet', high: 'stip' } : { wood: 'wood', wet: 'wet' });
  let hatch = $derived(big ? 5 : 4);
  let grid = $derived(words?.grid ?? 25);
  let scalePx = $derived(words && map ? Math.round((words.scale.metres / map.metresPerUnit) * ppu) : 0);
  const KEY: Record<string, string> = { wood: 'woods', water: 'water', wet: 'marsh', high: 'high ground', camp: 'camp', built: 'built', animals: 'animals' };
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const pc = (n: number) => `${Math.round(n * 10_000) / 100}%`;
</script>

{#if map && words}
  <div
    class="ss-pl"
    id="ss-wm-plate"
    class:ss-pl-big={big}
    data-past={past ? '' : undefined}
    data-armed={armed && !seen ? '' : undefined}
    data-seen={armed && seen ? '' : undefined}
    style:--r="{rPx}px"
    bind:this={el}
    use:firstView={() => (seen = true)}
  >
    <p class="ss-vh">{plateSummary(w)}</p>
    <p class="ss-pl-lab">{words.label}</p>

    <div class="ss-pl-fig">
      <div class="ss-pl-box" bind:clientWidth={boxW} style:--gx={pc(grid / frame.w)} style:--gy={pc(grid / frame.h)}>
        <WildmindMap
          map={drawn}
          id="ss-wm"
          {people}
          animals={big ? w.animals : []}
          structures={[]}
          fires={w.fires}
          species={w.species}
          night={null}
          {mark}
          trails
          fit="meet"
          frame={plate}
          {patterns}
        >
          {#snippet defs({ uid })}
            <pattern id="{uid}-wood" patternUnits="userSpaceOnUse" width={u(hatch)} height={u(hatch)} patternTransform="rotate(45)">
              <rect class="ss-pt-wf" width={u(hatch)} height={u(hatch)} />
              <line class="ss-pt-wl" x1="0" y1="0" x2="0" y2={u(hatch)} stroke-width={u(0.75)} />
            </pattern>
            <pattern id="{uid}-wet" patternUnits="userSpaceOnUse" width={u(6)} height={u(5)}>
              <rect class="ss-pt-mf" width={u(6)} height={u(5)} />
              <line class="ss-pt-ml" x1={u(1)} y1={u(2.5)} x2={u(4)} y2={u(2.5)} stroke-width={u(1)} />
            </pattern>
            {#if big}
              <pattern id="{uid}-stip" patternUnits="userSpaceOnUse" width={u(4)} height={u(4)}>
                <rect class="ss-pt-hf" width={u(4)} height={u(4)} />
                <circle class="ss-pt-hd" cx={u(1)} cy={u(1)} r={u(0.7)} />
                <circle class="ss-pt-hd" cx={u(3)} cy={u(3)} r={u(0.7)} />
              </pattern>
            {/if}
          {/snippet}
          {#snippet under()}
            {#if drawn?.edge}<path class="ss-pl-edge" d={drawn.edge} />{/if}
            {#each built.camps as c, i (i)}
              <path class="ss-pl-camp" d={c.d} />
              {#each c.members as b, j (j)}
                <rect class="ss-pl-in" x={r3(b.x - sq / 2)} y={r3(b.y - sq / 2)} width={r3(sq)} height={r3(sq)} />
              {/each}
            {/each}
            {#each built.singles as b, i (i)}
              <rect
                class="ss-pl-built"
                data-unfinished={b.complete ? undefined : ''}
                x={r3(b.x - sq / 2)}
                y={r3(b.y - sq / 2)}
                width={r3(sq)}
                height={r3(sq)}
              />
            {/each}
          {/snippet}
          {#snippet overlay({ place })}
            {#each labels.places as l, i (l.name)}
              <span
                class="ss-pl-name"
                class:ss-pl-lm={l.landmark}
                style={place(l.x, l.y)}
                style:--i={i}
                aria-hidden="true"
                transition:fade={{ duration: reduced ? 0 : 360 }}>{l.name}</span
              >
            {/each}
            {#each people as p (p.id)}
              <span class="ss-pl-tag" data-who={p.id} data-side={side[p.id] ?? 'r'} style={place(p.x, p.y)} aria-hidden="true"
                ><i></i><b>{p.name}</b></span
              >
            {/each}
          {/snippet}
        </WildmindMap>
      </div>
      <p class="ss-pl-ends" aria-hidden="true">
        <span class="ss-pl-scale"><i style:width="{scalePx}px"></i>{words.scale.word}</span>
        <span class="ss-pl-key">
          {#each keys as k (k)}<span><i class="ss-pl-sw" data-k={k}></i>{KEY[k]}</span>{/each}
        </span>
      </p>
    </div>

    <div class="ss-pl-who">
      {#if words.who.length}
        <ul aria-hidden="true">
          {#each words.who as p (p.id)}<li data-who={p.id} data-hollow={p.hollow ? '' : undefined}><i></i>{p.text}</li>{/each}
        </ul>
      {/if}
      <p class="ss-pl-hold"><HoldStill {held} {onhold} pressed controls="ss-wm-plate" /></p>
    </div>
  </div>
{/if}

<!--
  Style notes, kept out of <style>: this component is in a lazy view chunk
  (css="injected"), where comments in the CSS would ship to every reader.
  - .ss-pl --wm-ground: The essay's inks, named for the shared map (WildmindMap reads these).
  - .ss-pl --wm-edge: Inner boundaries carry no line: only the rim of the known land (drawn here
    as .ss-pl-edge) and the water's edge do.
  - .ss-pl-fig width: The column less the rope lane, and never taller than a screen can show.
  - .ss-pl-box: The survey grid: hairlines every fifty metres (or a hundred, on a big sheet),
    under the transparent map, closed at the far edges.
  - .ss-pl-edge: The rim of the known land, camps and lone built things.
  - .ss-pl-camp: A camp: a dashed fence round the ground they've built on, as a plan marks a
    settlement, rather than forty squares of ink.
  - .ss-pl-in: The things inside a camp, faint, so the fence reads as round buildings.
  - .ss-pl-box :global(.wm-animal): Animals: small open rings, lighter than anything built.
  - .ss-pl[data-past] .ss-pl-box :global(.wm-p .wm-disc): Between lives the map is as JKai left
    it: nobody on it is there now.
  - .ss-pt-wf: Patterns, in the plate's inks.
  - .ss-pl-name, .ss-pl-tag: Words on the map: names in the essay's italic, people in its
    display face.
  - .ss-pl-tag b: The name on a solid plate of card, so it holds its contrast over hatch, marsh
    or a camp.
  - .ss-pl-ends: The ends row: the scale on the left, the key flush with the map's right edge.
  - .ss-pl-who: Who is doing what, as the margin's side lines; then the switch. A phone keeps
    room for four lines and the switch, so a poll never moves the floors below.
  - .ss-pl-hold :global(.wm-hold): In the margin's caps, as the side lines above it.
  - .ss-pl[data-armed]: first view: the empty survey sheet, then the ground, then the marks.
  - .ss-pl-who (print): paper doesn't reflow under a poll, so it keeps no room in reserve.
  - .ss-pl-box :global(.wm-p[data-who='companion'] .wm-disc): Shape stands in for colour: JKai a
    solid disc, Wren a ring.
-->

<style>
  .ss-pl {
    --wm-ground: var(--surface-card);
    --wm-open: transparent;
    --wm-edge: none;
    --wm-edge-width: 1px;
    --wm-edge-dash: none;
    --wm-sea: var(--accent-ink-tint-35);
    --wm-fresh: var(--accent-ink-tint-22);
    --wm-coast: var(--accent-ink-tint-35);
    --wm-coast-width: 1px;
    --wm-shore: var(--accent-tint-08);
    --wm-high: color-mix(in srgb, var(--fg) 9%, transparent);
    --wm-relief: none;
    --wm-relief-line: color-mix(in srgb, var(--fg) 28%, transparent);
    --wm-relief-width: 0.75px;
    --wm-night-strength: 0;
    --wm-jkai: var(--t-accent);
    --wm-companion: var(--t-ink);
    --wm-halo: var(--surface-card);
    --ss-pl-rim: color-mix(in srgb, var(--fg) 55%, transparent);
    --ss-pl-built: color-mix(in srgb, var(--fg) 55%, transparent);
    --ss-pl-camp: color-mix(in srgb, var(--fg) 5%, transparent);
    --wm-lit: var(--accent-tint-35);
    --wm-fire: var(--fg);
    --wm-animal: var(--fg3);
    --wm-trail-width: 1.5px;
    --wm-trail-dash: 1 4;
    --wm-wood-fill: color-mix(in srgb, var(--good) 10%, transparent);
    --wm-wood-line: color-mix(in srgb, var(--fg) 30%, transparent);
    --wm-wet-fill: var(--accent-ink-tint-06);
    --wm-wet-line: color-mix(in srgb, var(--t-ink) 55%, transparent);
    --wm-high-fill: var(--bg-section);
    --wm-high-dot: color-mix(in srgb, var(--fg) 45%, transparent);
    --wm-hold: var(--fg);
    --wm-hold-on: var(--tone);
    --wm-focus: var(--tone);
    --halo: 0 0 2px var(--surface-card), 0 0 3px var(--surface-card), 0 0 5px var(--surface-card);
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'lab' 'fig' 'who';
    margin-top: clamp(26px, 4vw, 36px);
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
  .ss-pl-lab,
  .ss-pl-who,
  .ss-pl-ends {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
  }
  .ss-pl-lab {
    grid-area: lab;
    margin: 0 0 10px;
    padding-right: var(--lane);
    letter-spacing: 0.08em;
    line-height: 1.5;
    color: var(--fg2);
  }
  .ss-pl-fig {
    grid-area: fig;
    width: min(100% - var(--lane), min(620px, 72svh) * 1.5);
    min-width: 0;
  }
  .ss-pl-box {
    position: relative;
    background:
      linear-gradient(to right, var(--line-hair) 1px, transparent 1px) 50% 50% / var(--gx) var(--gy),
      linear-gradient(to bottom, var(--line-hair) 1px, transparent 1px) 50% 50% / var(--gx) var(--gy);
    box-shadow: inset 0 0 0 1px var(--line-hair);
  }

  .ss-pl-edge {
    fill: none;
    stroke: var(--ss-pl-rim);
    stroke-width: 1px;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .ss-pl-camp {
    fill: var(--ss-pl-camp);
    stroke: var(--ss-pl-built);
    stroke-width: 1px;
    stroke-dasharray: 3 2;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .ss-pl-built {
    fill: var(--ss-pl-built);
  }
  .ss-pl-in {
    fill: var(--ss-pl-built);
    opacity: 0.3;
  }
  .ss-pl-box :global(.wm-animal) {
    fill: none;
    stroke: var(--wm-animal);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }
  .ss-pl-built[data-unfinished] {
    fill: none;
    stroke: var(--ss-pl-built);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }
  .ss-pl[data-past] .ss-pl-box :global(.wm-p .wm-disc) {
    fill: var(--wm-halo);
    stroke: var(--wm-who);
    stroke-width: 1.5px;
    stroke-dasharray: none;
  }
  .ss-pl[data-past] .ss-pl-box :global(.wm-tick) {
    display: none;
  }

  .ss-pt-wf {
    fill: var(--wm-wood-fill);
  }
  .ss-pt-wl {
    stroke: var(--wm-wood-line);
  }
  .ss-pt-mf {
    fill: var(--wm-wet-fill);
  }
  .ss-pt-ml {
    stroke: var(--wm-wet-line);
    stroke-linecap: round;
  }
  .ss-pt-hf {
    fill: var(--wm-high-fill);
  }
  .ss-pt-hd {
    fill: var(--wm-high-dot);
  }

  .ss-pl-name,
  .ss-pl-tag {
    position: absolute;
    white-space: nowrap;
  }
  .ss-pl-name {
    text-shadow: var(--halo);
  }
  .ss-pl-name {
    transform: translate(-50%, -50%);
    font-family: var(--fs-serif);
    font-style: italic;
    font-weight: 400;
    font-size: 14px;
    line-height: 1.25;
    color: var(--fg2);
  }
  .ss-pl-name.ss-pl-lm {
    font-size: 16px;
    color: var(--fg);
  }
  .ss-pl-tag {
    padding-left: 16px;
    transform: translate(calc(var(--r) + 2px), -50%);
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 13px;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--wm-jkai);
  }
  .ss-pl-big .ss-pl-tag {
    font-size: 14px;
  }
  .ss-pl-tag[data-who='companion'] {
    color: var(--wm-companion);
  }
  .ss-pl-tag i {
    position: absolute;
    left: 0;
    top: 50%;
    width: 14px;
    border-top: 1px solid currentColor;
  }
  .ss-pl-tag[data-side='l'] {
    padding: 0 16px 0 0;
    transform: translate(calc(-100% - var(--r) - 2px), -50%);
  }
  .ss-pl-tag[data-side='l'] i {
    left: auto;
    right: 0;
  }
  .ss-pl-tag b {
    display: inline-block;
    padding: 2px 3px;
    border-radius: 2px;
    font-weight: inherit;
    background: var(--surface-card);
  }

  .ss-pl-ends {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 6px 24px;
    margin: 10px 0 0;
    letter-spacing: 0.1em;
    color: var(--fg3);
  }
  .ss-pl-scale,
  .ss-pl-key > span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .ss-pl-scale i {
    display: inline-block;
    height: 5px;
    box-sizing: border-box;
    border: 1px solid var(--fg3);
    border-top: 0;
  }
  .ss-pl-key {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
  }
  .ss-pl-sw {
    display: inline-block;
    width: 10px;
    height: 10px;
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .ss-pl-sw[data-k='wood'] {
    background: repeating-linear-gradient(45deg, var(--wm-wood-line) 0 1px, var(--wm-wood-fill) 1px 4px);
  }
  .ss-pl-sw[data-k='water'] {
    background: var(--wm-fresh);
    border: 1.5px solid var(--wm-coast);
  }
  .ss-pl-sw[data-k='wet'] {
    background:
      linear-gradient(var(--wm-wet-line), var(--wm-wet-line)) 50% 50% / 6px 1.5px no-repeat,
      var(--wm-wet-fill);
  }
  .ss-pl-sw[data-k='high'] {
    background: var(--wm-high);
  }
  .ss-pl-big .ss-pl-sw[data-k='high'] {
    background:
      radial-gradient(circle at 30% 30%, var(--wm-high-dot) 0 1px, transparent 1.2px) 0 0 / 4px 4px,
      var(--wm-high-fill);
  }
  .ss-pl-sw[data-k='camp'] {
    border-radius: 100px;
    border: 1px dashed var(--ss-pl-built);
    background: var(--ss-pl-camp);
  }
  .ss-pl-sw[data-k='built'] {
    width: 5px;
    height: 5px;
    margin: 0 2px;
    background: var(--ss-pl-built);
  }
  .ss-pl-sw[data-k='animals'] {
    width: 5px;
    height: 5px;
    margin: 0 2px;
    border-radius: 100px;
    border: 1px solid var(--wm-animal);
  }

  .ss-pl-who {
    grid-area: who;
    align-self: start;
    margin-top: 14px;
    padding-right: var(--lane);
    min-height: calc(4 * 1.6 * var(--fs-label-xs) + 50px);
    letter-spacing: 0.08em;
    line-height: 1.6;
    color: var(--fg);
  }
  .ss-pl-who ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .ss-pl-who li {
    margin: 0 0 6px;
    padding-left: 14px;
    text-indent: -14px;
  }
  .ss-pl-who li i {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 8px;
    box-sizing: border-box;
    border-radius: 100px;
    background: var(--wm-jkai);
    border: 1.5px solid var(--wm-jkai);
    vertical-align: 0.12em;
    text-indent: 0;
  }
  .ss-pl-who li[data-who='companion'] i {
    background: var(--wm-companion);
    border-color: var(--wm-companion);
  }
  .ss-pl-who li[data-hollow] i {
    background: none;
  }
  .ss-pl-hold {
    margin: 12px 0 0 -4px;
    letter-spacing: 0.06em;
  }
  .ss-pl-hold :global(.wm-hold) {
    text-transform: inherit;
  }

  @media (min-width: 900px) {
    .ss-pl {
      grid-template-columns: var(--margin) minmax(0, 1fr);
      grid-template-rows: auto 1fr;
      grid-template-areas: 'lab fig' 'who fig';
      column-gap: 32px;
      margin-top: 0;
    }
    .ss-pl-lab {
      margin: 0;
      padding: 6px 0 0;
    }
    .ss-pl-who {
      margin-top: 18px;
      padding-right: 0;
      min-height: 0;
    }
  }

  .ss-pl[data-armed] :global(.wm-ground),
  .ss-pl[data-armed] :global(.wm-marks),
  .ss-pl[data-armed] .ss-pl-name,
  .ss-pl[data-armed] .ss-pl-tag {
    opacity: 0;
  }
  .ss-pl[data-seen] :global(.wm-ground) {
    animation: ss-pl-in 420ms ease-out 120ms both;
  }
  .ss-pl[data-seen] :global(.wm-marks),
  .ss-pl[data-seen] .ss-pl-tag {
    animation: ss-pl-in 420ms ease-out 380ms both;
  }
  .ss-pl[data-seen] .ss-pl-name {
    animation: ss-pl-in 420ms ease-out calc(380ms + var(--i, 0) * 28ms) both;
  }
  @keyframes ss-pl-in {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ss-pl[data-seen] :global(.wm-ground),
    .ss-pl[data-seen] :global(.wm-marks),
    .ss-pl[data-seen] .ss-pl-tag,
    .ss-pl[data-seen] .ss-pl-name {
      animation: none;
    }
  }

  @media print {
    .ss-pl {
      break-inside: avoid;
      --wm-jkai: #1a1008;
      --wm-companion: #1a1008;
      --halo: none;
      --ss-pl-rim: #1a1008;
      --ss-pl-built: #1a1008;
    }
    .ss-pl-tag b {
      background: none;
      padding: 0;
    }
    .ss-pl-fig {
      width: min(100%, 160mm);
    }
    .ss-pl-box {
      background: none;
      box-shadow: none;
    }
    .ss-pl-who {
      min-height: 0;
    }
    .ss-pl-box :global(.wm-p[data-who='companion'] .wm-disc) {
      fill: none;
      stroke: #1a1008;
      stroke-width: 1.5px;
    }
    .ss-pl-who li[data-who='companion'] i {
      background: none;
    }
    .ss-pl :global(.wm-ground),
    .ss-pl :global(.wm-marks),
    .ss-pl .ss-pl-name,
    .ss-pl .ss-pl-tag {
      opacity: 1 !important;
      animation: none !important;
    }
    .ss-pl-lab,
    .ss-pl-ends,
    .ss-pl-name,
    .ss-pl-name.ss-pl-lm,
    .ss-pl-tag {
      color: #1a1008;
    }
  }
</style>
