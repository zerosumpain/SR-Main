<svelte:options css="injected" />

<script lang="ts">
  // Wildmind, drawn: a gallery at the end of the street with a big shop
  // window, and inside, under a glass vitrine on a plinth, a planning model
  // of the valley (GlassModel.svelte). People on the pavement look in; a
  // child points. The gallery follows the owner's sun as the towers do, from
  // the tokens cityVars() and skyVars() write: by day the glass carries the
  // sky along its top, a faint mirrored street in its lower corners (held off
  // the vitrine) and a glare streak that slides across with the sun, and the
  // light through the window falls on the model; with the sun low a warm
  // glint runs down the frame and along the vitrine; after dark the track's
  // spotlights come on, pool on the back wall and wash the model warm, the
  // fascia lettering and the fanlight glow, light spills across the
  // pavement and the people looking in turn to silhouettes. The valley's
  // own night never lights the gallery: it is in the dateline, and in the
  // figures lying down.
  //
  // States: paused hangs a "back shortly" card inside the glass; between
  // lives the model greys a little and the lights drop to two spots; stale
  // stills and dulls it; offline puts a dust sheet over the vitrine and the
  // gallery down to one spot, the plaque engraved but unlit. A picture only:
  // PlaceScene's labels carry every word, and its summary says it in text.
  //
  // Layers: each SVG's drawing is wrapped in plain groups, so when a label
  // is open PlaceScene's fall-back dims the group and it multiplies with the
  // sun- and lamp-driven opacities inside (a day-only layer stays out at
  // night, and the other way round). The plinth and its plate are the
  // plaque's part (`data-part="latest"`), lit when the plaque is open.
  import { shadows, skyline } from '$lib/landing/showcase-city';
  import { seeded, type Box } from '$lib/landing/showcase-place';
  import { GALLERY, GALLERY_LIGHT, type Figure, type HutSpot, type PersonAnchor } from '$lib/landing/showcase-place-wildmind';
  import type { WildmindState } from '$lib/landing/wildmind';
  import { BOARD, TILT, type WildmindGlass } from '$lib/landing/wildmind-glass';
  import CityRow from './CityRow.svelte';
  import SafeMask from './SafeMask.svelte';
  import GlassModel from './GlassModel.svelte';

  let {
    state,
    glass,
    figures,
    huts,
    fires,
    animals,
    anchors,
    plaque,
    light,
    sunX,
    quiet = [],
  }: {
    state: WildmindState;
    glass: WildmindGlass | null;
    figures: Figure[];
    huts: HutSpot[];
    fires: Array<{ x: number; y: number }>;
    animals: Array<{ x: number; y: number }>;
    anchors: PersonAnchor[];
    /** The plaque's words are on the plinth (a label): the drawn plate is then only a phone's decoration. */
    plaque: boolean;
    /** Where the sun stands and how far its shadows run. */
    light: { side: 'east' | 'west'; reach: number };
    /** The sun across the sky, 0–100 (skyVars' --sun-x): the glare streak stands opposite it on the glass. */
    sunX: number;
    quiet?: Box[];
  } = $props();

  const G = GALLERY.ground;
  const Bd = GALLERY.building;
  const W = GALLERY.window;
  const BED = W.y + W.h;
  const PL = GALLERY.plinth;
  const V = GALLERY.vitrine;
  const VH = V.foot - V.front;
  const BX = GALLERY.board.x;
  const BY = GALLERY.board.y;
  const D = GALLERY.door;
  const C = GALLERY.card;
  const P = GALLERY_LIGHT.pool;
  const mid = PL.x + PL.w / 2;

  // The street behind: tall glass over the gallery's roof, lower towers left of it, dark behind the copy.
  let FAR = $derived(
    skyline({ quiet, seed: 61, street: 'glass', from: -700, to: 1700, base: G, lo: 380, hi: 640, wide: [36, 84], gap: [4, 22], low: [[-700, 420, 360]], dark: [[-1000, 472]], litShare: 0.14 }),
  );
  let NEAR = $derived(
    skyline({ quiet, seed: 62, street: 'mixed', from: -700, to: 420, base: G, lo: 110, hi: 300, wide: [40, 80], gap: [8, 26], dark: [[-1000, 472]], litShare: 0.2 }),
  );
  let shade = $derived(shadows([{ x: Bd.x, w: Bd.r - Bd.x, top: Bd.top, d: '' }], light.side, light.reach, G, 14));

  // The gallery's upper floors: two bands of windows, some lit after dark.
  const panes = (() => {
    const rnd = seeded(21);
    let dark = '';
    let lit = '';
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 13; i++) {
        const r = `M${458 + i * 38.5},${64 + j * 24.5}h28v14h-28z`;
        if (rnd() < 0.26) lit += r;
        else dark += r;
      }
    return { dark, lit };
  })();

  // The track's spots, their cones down to the plinth, and their pools on the back wall.
  const SPOTS = GALLERY.spots;
  const cone = (x: number, i: number) => `M${x - 4},${W.y + 19}L${x + 4},${W.y + 19}L${x + 92 - i * 26},${PL.top}L${x - 92 + (2 - i) * 26},${PL.top}Z`;

  // The dust sheet over the vitrine (offline): its hem in soft folds.
  const SHEET = (() => {
    const x0 = V.x - 9;
    const x1 = V.x + V.w + 9;
    const yt = V.back - 5;
    const yb = PL.top + 5;
    let hem = '';
    const n = 12;
    const step = (x1 - x0) / n;
    for (let i = 0; i < n; i++) hem += ` q${-step / 2},${i % 2 ? 5 : -3} ${-step},${i % 3 ? 1.5 : -1}`;
    const d = `M${x0},${yb} L${x0 + 5},${yt + 34} Q${x0 + 10},${yt} ${x0 + 46},${yt + 2} Q${(x0 + x1) / 2},${yt - 6} ${x1 - 46},${yt + 2} Q${x1 - 10},${yt} ${x1 - 5},${yt + 34} L${x1},${yb}${hem}Z`;
    const folds = [0.18, 0.34, 0.52, 0.66, 0.83]
      .map((f, i) => {
        const x = x0 + (x1 - x0) * f;
        return `M${x - 6 + i * 2},${yt + 10} Q${x + (i % 2 ? 8 : -8)},${(yt + yb) / 2} ${x + (i % 2 ? -4 : 5)},${yb - 2}`;
      })
      .join(' ');
    return { d, folds };
  })();

  // The glare streak, opposite the sun on the glass: left of centre with the sun high in the east, far right as it sets in the west.
  let glareX = $derived(W.x + W.w * (1 - sunX / 100) - W.w * 0.11);
  const glare = (x: number, w: number) => `M${x},${W.y}h${w}l-150,${W.h}h${-w}z`;

  // The sunlight through the window on the board: a skewed patch, falling away from the sun's side.
  let sunPatch = $derived.by(() => {
    const x = BX + BOARD.w * (sunX / 100) - 150;
    return `M${x},${BY - 6}h300l-60,${BOARD.d + 13}h-300z`;
  });

  // The board's planning grid: squares a fifth of the board deep.
  const GRID = { w: BOARD.w / 20, h: (BOARD.w / 20) * TILT };

  let shown = $derived(state !== 'offline');
</script>

<div class="gl" data-state={state} style:--gl-wall-night={GALLERY_LIGHT.wallNight} style:--gl-wall-day={GALLERY_LIGHT.wallDay}>
  <svg class="gl-layer gl-back" viewBox="0 0 1000 {GALLERY.h}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <SafeMask id="sp-wm-safe" side="l" h={GALLERY.h} boxes={quiet} />
    <defs>
      <radialGradient id="sp-wm-pool" cx=".5" cy=".5" r=".5">
        <stop offset="0" stop-color={GALLERY_LIGHT.lamp} stop-opacity={P.peak} />
        <stop offset=".55" stop-color="#d9965a" stop-opacity={P.half} />
        <stop offset="1" stop-color="#d9965a" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="sp-wm-cone" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffe2b8" stop-opacity={GALLERY_LIGHT.cone} />
        <stop offset="1" stop-color="#ffe2b8" stop-opacity=".02" />
      </linearGradient>
      <linearGradient id="sp-wm-floor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#5a4028" stop-opacity="0" />
        <stop offset="1" stop-color="#6a4a2c" stop-opacity=".55" />
      </linearGradient>
      <linearGradient id="sp-wm-plinth" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffcf94" stop-opacity=".22" />
        <stop offset="1" stop-color="#ffcf94" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="sp-wm-plinth-day" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--city-sunlit, #dbe4e7)" stop-opacity=".34" />
        <stop offset="1" stop-color="var(--city-sunlit, #dbe4e7)" stop-opacity=".08" />
      </linearGradient>
      <radialGradient id="sp-wm-bead">
        <stop offset="0" stop-color="#ffcf5a" stop-opacity=".85" />
        <stop offset="1" stop-color="#ff9a3a" stop-opacity="0" />
      </radialGradient>
      <clipPath id="sp-wm-boardclip"><rect x={BX - 6} y={BY - 6} width={BOARD.w + 12} height={BOARD.d + 13} /></clipPath>
      <!-- By day a little of the light through the window glows on the floor; the room above it stays dark. -->
      <linearGradient id="sp-wm-day" x1="0" y1="0" x2="0" y2="1">
        <stop offset=".72" stop-color="#e9d2ac" stop-opacity="0" />
        <stop offset="1" stop-color="#e9d2ac" stop-opacity=".09" />
      </linearGradient>
      <pattern id="sp-wm-grid" patternUnits="userSpaceOnUse" x={BX} y={BY} width={GRID.w} height={GRID.h}>
        <path class="gl-grid" d="M0,0H{GRID.w}M0,0V{GRID.h}" />
      </pattern>
    </defs>

    <g>
    <CityRow line={FAR} far side={light.side} base={G} safe="sp-wm-safe" glow={300} />
    <CityRow line={NEAR} side={light.side} reach={light.reach} base={G} safe="sp-wm-safe" />
    {#if shade}<path class="gl-shadow" d={shade} />{/if}

    <!-- The gallery's front: its upper floors, the fascia and the deep reveal round the window. -->
    <rect class="gl-bld" x={Bd.x} y={Bd.top} width={Bd.r - Bd.x} height={G - Bd.top} />
    <rect class="gl-cap" x={Bd.x - 4} y={Bd.top - 6} width={Bd.r - Bd.x + 8} height="6" />
    <path class="gl-pane" d={panes.dark + panes.lit} />
    <path class="gl-pane-lit" d={panes.lit} mask="url(#sp-wm-safe)" />
    <rect class="gl-fascia" x={GALLERY.fascia.x} y={GALLERY.fascia.y} width={GALLERY.fascia.w} height={GALLERY.fascia.h} />
    <rect class="gl-reveal" x={W.x - 10} y={W.y - 10} width={W.w + 20} height={W.h + 10} />

    <!-- Inside: the back wall, the pools of lamplight on it, the floor, the track and its spots. -->
    <rect class="gl-wall" x={W.x} y={W.y} width={W.w} height={W.h} />
    <rect class="gl-daylight" x={W.x} y={W.y} width={W.w} height={W.h} fill="url(#sp-wm-day)" />
    <g class="gl-lit">
      {#each SPOTS as x, i (x)}<ellipse class="gl-pool" data-spot={i} cx={x} cy={P.cy} rx={P.rx} ry={P.ry} fill="url(#sp-wm-pool)" />{/each}
      <rect x={W.x} y={BED - 34} width={W.w} height="34" fill="url(#sp-wm-floor)" />
    </g>
    <rect class="gl-track" x={W.x + 40} y={W.y + 8} width={W.w - 80} height="2.4" />
    {#each SPOTS as x, i (x)}
      <path class="gl-cone" data-spot={i} d={cone(x, i)} fill="url(#sp-wm-cone)" />
      <g class="gl-spot" data-spot={i}>
        <rect x={x - 1} y={W.y + 10} width="2" height="5" />
        <path d="M{x - 4.4},{W.y + 14}h8.8l-1.4,6h-6z" transform="rotate({(1 - i) * 8} {x} {W.y + 14})" />
      </g>
    {/each}

    </g>

    <!-- The plinth and its plate (the plaque's words stand on it as a label): the plaque's part. -->
    <g data-part="latest">
    <ellipse class="gl-pl-shadow" cx={mid} cy={BED - 1} rx={PL.w / 2 + 34} ry="5" />
    <rect class="gl-pl-top" x={PL.x - 4} y={PL.top - 3} width={PL.w + 8} height="3" />
    <rect class="gl-pl" x={PL.x} y={PL.top} width={PL.w} height={BED - PL.top} />
    <rect class="gl-pl-lamp" x={PL.x} y={PL.top} width={PL.w} height={BED - PL.top} fill="url(#sp-wm-plinth)" />
    <rect class="gl-pl-sun" x={PL.x} y={PL.top} width={PL.w} height={BED - PL.top} fill="url(#sp-wm-plinth-day)" />
    <rect class="gl-pl-skirt" x={PL.x} y={BED - 4} width={PL.w} height="4" />
    <g class="gl-plate" class:bare={!plaque}>
      <rect x={mid - 60} y={PL.top + 13} width="120" height="32" rx="1.5" />
      <rect class="in" x={mid - 57.5} y={PL.top + 15.5} width="115" height="27" rx="1" />
      <path class="eng" d="M{mid - 26},{PL.top + 22}h52M{mid - 44},{PL.top + 29.5}h88M{mid - 32},{PL.top + 36.5}h64" />
    </g>
    </g>

    <!-- The model's board. -->
    <g>
    <rect class="gl-board-front" x={BX - 6} y={BY + BOARD.d} width={BOARD.w + 12} height="7" />
    <rect class="gl-board" x={BX - 6} y={BY - 6} width={BOARD.w + 12} height={BOARD.d + 6} />
    <rect x={BX} y={BY} width={BOARD.w} height={BOARD.d} fill="url(#sp-wm-grid)" />
    <!-- By day the sun comes in through the window and lies across the board, the model standing in it. -->
    <path class="gl-sunpatch" d={sunPatch} clip-path="url(#sp-wm-boardclip)" />
    </g>
  </svg>

  {#if shown}
    <div class="gl-held" class:still={state === 'stale'} class:ended={state === 'between-lives'}>
      <GlassModel {glass} {figures} {huts} {fires} {animals} {anchors} />
    </div>
  {/if}

  <svg class="gl-layer gl-front" viewBox="0 0 1000 {GALLERY.h}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="sp-wm-warm" cx=".5" cy=".6" r=".55">
        <stop offset="0" stop-color="#ffb35c" stop-opacity=".22" />
        <stop offset="1" stop-color="#ffb35c" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="sp-wm-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--sky-low, #d2e6f5)" stop-opacity=".8" />
        <stop offset=".6" stop-color="var(--sky-mid, #acd0ef)" stop-opacity=".22" />
        <stop offset="1" stop-color="var(--sky-mid, #acd0ef)" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="sp-wm-glare" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0" />
        <stop offset=".3" stop-color="#fff" stop-opacity=".46" />
        <stop offset=".52" stop-color="#fff" stop-opacity=".1" />
        <stop offset=".68" stop-color="#fff" stop-opacity=".32" />
        <stop offset="1" stop-color="#fff" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="sp-wm-cloth" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff6e6" stop-opacity=".5" />
        <stop offset=".5" stop-color="#fff6e6" stop-opacity="0" />
        <stop offset="1" stop-color="#3a2c1e" stop-opacity=".35" />
      </linearGradient>
      <radialGradient id="sp-wm-spill" cx=".5" cy=".1" r=".6">
        <stop offset="0" stop-color="#ffcb88" stop-opacity=".42" />
        <stop offset=".55" stop-color="#ffb870" stop-opacity=".14" />
        <stop offset="1" stop-color="#ffb870" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="sp-wm-hole" cx=".5" cy=".5" r=".5">
        <stop offset="0" stop-color="#000" />
        <stop offset=".62" stop-color="#000" />
        <stop offset="1" stop-color="#fff" />
      </radialGradient>
      <!-- The street's reflection keeps off the vitrine, so the model reads clear through it. -->
      <mask id="sp-wm-refl" maskUnits="userSpaceOnUse" x={W.x} y={W.y} width={W.w} height={W.h}>
        <rect x={W.x} y={W.y} width={W.w} height={W.h} fill="#fff" />
        <ellipse cx={mid} cy={(V.back + PL.top) / 2 + 20} rx={V.w * 0.66} ry={(PL.top - V.back) * 0.9} fill="url(#sp-wm-hole)" />
      </mask>
      <clipPath id="sp-wm-win"><rect x={W.x} y={W.y} width={W.w} height={W.h} /></clipPath>
      <clipPath id="sp-wm-vit"><rect x={V.x} y={V.back} width={V.w} height={V.foot - V.back} /></clipPath>
      <!-- The vitrine's front edge catches the light most at its corners, least across the model behind it. -->
      <linearGradient id="sp-wm-edge" gradientUnits="userSpaceOnUse" x1={V.x} y1="0" x2={V.x + V.w} y2="0">
        <stop class="gl-edge-stop" offset="0" />
        <stop class="gl-edge-stop" offset=".16" stop-opacity=".3" />
        <stop class="gl-edge-stop" offset=".84" stop-opacity=".3" />
        <stop class="gl-edge-stop" offset="1" />
      </linearGradient>
    </defs>

    <g>
    <!-- The lamps' warmth over the model after dark, and the daylight through the window on it by day. -->
    {#if shown}
      <rect class="gl-warm" x={V.x - 40} y={V.back - 40} width={V.w + 80} height={PL.top - V.back + 60} fill="url(#sp-wm-warm)" />
    {/if}

    <!-- The vitrine: its lid and front pane, a sheen, its edges, the lamp on its front edge, the low sun's glint. -->
    <rect class="gl-lid" x={V.x} y={V.back} width={V.w} height={V.front - V.back} />
    <rect class="gl-pane-front" x={V.x} y={V.front} width={V.w} height={VH} />
    <path
      class="gl-sheen"
      d="M{V.x + 30},{V.back}L{V.x + 92},{V.back}L{V.x + 10},{V.foot}L{V.x - 22},{V.foot}Z M{V.x + 112},{V.back}L{V.x + 126},{V.back}L{V.x + 44},{V.foot}L{V.x + 30},{V.foot}Z"
      clip-path="url(#sp-wm-vit)"
    />
    <path
      class="gl-edge back"
      d="M{V.x},{V.back}H{V.x + V.w}M{V.x},{V.back}V{V.back + VH}M{V.x + V.w},{V.back}V{V.back + VH}M{V.x},{V.back + VH}H{V.x + 30}M{V.x + V.w},{V.back + VH}H{V.x + V.w - 30}"
    />
    <path class="gl-edge" d="M{V.x},{V.back}V{V.foot}M{V.x + V.w},{V.back}V{V.foot}" />
    <path class="gl-edge hi" d="M{V.x},{V.front}H{V.x + V.w}" stroke="url(#sp-wm-edge)" />
    <path class="gl-glint" d="M{V.x + V.w},{V.back}V{V.foot}M{V.x},{V.front}H{V.x + V.w}" />

    {#if state === 'offline'}
      <g class="gl-sheet">
        <path class="cloth" d={SHEET.d} />
        <path d={SHEET.d} fill="url(#sp-wm-cloth)" opacity=".7" />
        <path class="folds" d={SHEET.folds} />
      </g>
    {/if}
    {#if state === 'paused'}
      <!-- A card on a suction hook inside the glass; its words are the HTML beside this drawing. -->
      <g class="gl-card">
        <path class="string" d="M{C.x + C.w / 2},{C.y - 9}L{C.x + 12},{C.y + 2}M{C.x + C.w / 2},{C.y - 9}L{C.x + C.w - 12},{C.y + 2}" />
        <circle class="hook" cx={C.x + C.w / 2} cy={C.y - 10} r="2.6" />
        <rect class="board" x={C.x} y={C.y} width={C.w} height={C.h} rx="1.5" transform="rotate(-2 {C.x + C.w / 2} {C.y})" />
      </g>
    {/if}

    <!-- The window's glass by day: the sky along its top, the street behind you mirrored low down, a glare streak. -->
    <rect class="gl-skystrip" x={W.x} y={W.y} width={W.w} height={GALLERY.skyStrip} fill="url(#sp-wm-sky)" />
    <g class="gl-refl" mask="url(#sp-wm-refl)">
      <path
        class="gl-refl-city"
        d="M{W.x},{BED}V420H486V368H530V448H588V396H620V462H690V410H752V380H794V440H852V358H896V430H936V400H{W.x + W.w}V{BED}Z"
      />
    </g>
    <g class="gl-glare" clip-path="url(#sp-wm-win)" mask="url(#sp-wm-refl)">
      <path d={glare(glareX, 74)} fill="url(#sp-wm-glare)" />
      <path class="thin" d={glare(glareX + 104, 18)} fill="url(#sp-wm-glare)" />
    </g>

    <!-- The frame, the riser under the window, the door and its fanlight. -->
    <rect class="gl-mull" x={W.x - 2} y={W.y} width="4" height={W.h} />
    <rect class="gl-mull" x={W.x + W.w - 2} y={W.y} width="4" height={W.h} />
    <rect class="gl-mull" x={W.x} y={W.y - 2} width={W.w} height="4" />
    <path class="gl-glint" d="M{W.x + W.w + 2},{W.y}V{BED}M{W.x},{W.y + 1}H{W.x + W.w}" />
    <rect class="gl-riser" x={W.x - 10} y={BED} width={W.w + 20} height={G - BED} />
    <rect class="gl-door" x={D.x} y={D.top} width={D.w} height={G - D.top} />
    <rect class="gl-fan" x={D.x + 4} y={D.top + 4} width={D.w - 8} height="14" mask="url(#sp-wm-safe)" />

    <!-- The pavement: the window's light spilling across it after dark, the walk's footpath to the door, the people looking in. -->
    <ellipse class="gl-spill" cx={W.x + W.w / 2} cy={G + 4} rx={W.w * 0.66} ry="44" fill="url(#sp-wm-spill)" mask="url(#sp-wm-safe)" />
    <path class="gl-foot" d="M-2000,{G - 3}H{D.x + D.w / 2}" />
    <g class="gl-ppl">
      <!-- Leaning in, hands in pockets. -->
      <path d="M470,{G}l1.6,-36l-3,-2l1.8,-24q1,-9 9,-10l6,-1q7,1 7.6,9l-1,22l-3.4,4l2.4,38h-6l-3.2,-34h-2.6l-2.8,34z" />
      <circle cx="489" cy={G - 82} r="8.4" />
      <!-- A grown-up, a hand on the child's shoulder. -->
      <path d="M958,{G}l1,-38l-2.4,-2l1.2,-28q1.4,-9 10,-9.6h5.6q8.4,0.6 9.4,9.6l1.2,28l-2.4,2l1,38h-6.4l-2.4,-36h-2l-2.4,36z" />
      <circle cx="969.6" cy={G - 88} r="8.2" />
      <path d="M958.6,{G - 70}l-14,10l2,3.4l14,-8z" />
      <!-- The child, pointing at the model. -->
      <path d="M932,{G}l0.8,-22l-1.8,-1.4l1,-16q1,-6.4 7,-6.8h3.6q6,0.4 6.8,6.8l0.8,16l-1.6,1.4l0.8,22h-4.6l-1.6,-20h-1.4l-1.6,20z" />
      <circle cx="940" cy={G - 52} r="6.4" />
      <path d="M934.4,{G - 40}l-16,-14l2.4,-2.8l16,12z" />
    </g>
    </g>
  </svg>

  <!-- The fascia's lettering, and the paused card's: words in the drawing, said elsewhere in text. -->
  <p class="gl-fascia" aria-hidden="true"><b>Wildmind</b><span>models of a made-up valley</span></p>
  {#if state === 'paused'}
    <p class="gl-card-words" aria-hidden="true">Back<br />shortly</p>
  {/if}
</div>

<style>
  .gl {
    --gl-lamp: #ffd9a0;
    /* How far the gallery's own lights are up: a little by day, full after dark. */
    --gl-on: calc(0.22 + 0.78 * var(--windows, 0));
    --gm-ply-a: #7a5c3c;
    --gm-ply-b: #9c7b52;
    --gm-water: #5a8296;
    --gm-edge: rgba(70, 50, 30, 0.5);
    --gm-tree: #6c8253;
    --gm-tree-hi: #98ad72;
    --gm-speck: #2b2420;
    /* Daylight in the gallery: a trace of the sun's colour on its dark wall with the sun out (the room stays darker than the street). */
    --gl-sunk: calc(var(--city-sun-on, 0) * 4%);
    position: absolute;
    inset: 0;
  }
  .gl :global(.gl-layer) {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .gl-held {
    position: absolute;
    inset: 0;
  }

  /* ---- the street and the gallery's front */
  .gl-shadow {
    fill: #000;
    opacity: var(--city-shadow, 0);
  }
  .gl-bld {
    fill: var(--city-glass, #0d121b);
    stroke: var(--city-edge, rgba(237, 228, 212, 0.12));
    stroke-width: 0.8;
  }
  .gl-cap,
  .gl-fascia,
  .gl-mull,
  .gl-riser {
    fill: var(--city-deck, #15171b);
  }
  .gl-fascia,
  .gl-mull,
  .gl-riser {
    stroke: rgba(237, 228, 212, 0.18);
    stroke-width: 0.6;
  }
  .gl-pane {
    fill: var(--city-shade, #080b11);
  }
  .gl-pane-lit {
    fill: var(--city-pane2, #f6cf8a);
    opacity: calc(var(--windows, 0) * 0.9);
  }
  .gl-reveal {
    fill: #0d0c0b;
  }

  /* ---- inside */
  .gl-wall {
    fill: color-mix(in srgb, var(--gl-wall-night) calc(var(--windows, 0) * 100%), color-mix(in srgb, var(--city-sunlit, #dbe4e7) var(--gl-sunk), var(--gl-wall-day)));
  }
  /* The daylight through the window, a low glow on the floor only. */
  .gl-daylight {
    opacity: calc(1 - var(--windows, 0));
  }
  .gl-lit {
    opacity: var(--gl-on);
  }
  .gl-track,
  .gl-spot {
    fill: #0b0a09;
  }
  .gl-cone {
    opacity: calc(var(--windows, 0) * var(--gl-spot, 1));
  }
  .gl-pool {
    opacity: var(--gl-spot, 1);
  }
  .gl-pl {
    fill: color-mix(in srgb, #1b1713 calc(var(--windows, 0) * 100%), #29231c);
  }
  .gl-pl-top {
    fill: color-mix(in srgb, #2e271f calc(var(--windows, 0) * 100%), #3b3227);
  }
  .gl-pl-lamp {
    opacity: var(--gl-on);
  }
  .gl-pl-sun {
    opacity: calc(var(--city-sun-on, 0) * 0.7);
  }
  .gl-pl-skirt {
    fill: #0d0b09;
  }
  .gl-pl-shadow {
    fill: #000;
    opacity: 0.55;
  }
  .gl-plate rect {
    fill: #8a6c3e;
  }
  .gl-plate .in {
    fill: #2a2015;
  }
  .gl-plate .eng {
    stroke: #b8955a;
    stroke-width: 1.6;
    opacity: 0.7;
  }
  /* On a desktop the plaque's words stand on the plinth as a label in a bronze plate of their own. */
  @media (min-width: 760px) {
    .gl-plate:not(.bare) {
      display: none;
    }
  }
  .gl-board {
    fill: color-mix(in srgb, #221d18 calc(var(--windows, 0) * 100%), #211c17);
  }
  .gl-board-front {
    fill: color-mix(in srgb, #110e0b calc(var(--windows, 0) * 100%), #100d0a);
  }
  .gl-grid {
    fill: none;
    stroke: rgba(237, 228, 212, 0.13);
    stroke-width: 0.5;
  }

  /* ---- the light on the model */
  .gl-warm {
    opacity: var(--windows, 0);
  }
  .gl-sunpatch {
    fill: #ffe9c4;
    opacity: calc(var(--city-sun-on, 0) * 0.26);
  }

  /* ---- the vitrine */
  .gl-lid {
    fill: rgba(207, 227, 238, 0.04);
  }
  .gl-pane-front {
    fill: rgba(207, 227, 238, 0.08);
  }
  .gl-sheen {
    fill: #fff;
    opacity: calc(0.04 + 0.07 * var(--daylight, 0));
  }
  .gl-edge {
    fill: none;
    stroke: rgba(237, 228, 212, 0.42);
    stroke-width: 0.8;
  }
  .gl-edge.back {
    stroke: rgba(237, 228, 212, 0.16);
    stroke-width: 0.6;
  }
  .gl-edge.hi {
    stroke-width: 1.1;
    opacity: calc(0.45 + 0.45 * var(--windows, 0));
  }
  .gl-edge-stop {
    stop-color: color-mix(in srgb, var(--gl-lamp) calc(var(--windows, 0) * 100%), #f4f8fb);
  }
  .gl-glint {
    fill: none;
    stroke: var(--city-glint, #fff1d8);
    stroke-width: 1.4;
    opacity: var(--city-glint-on, 0);
  }

  /* ---- the window's glass by day */
  .gl-skystrip {
    opacity: calc(var(--daylight, 0) * 0.6);
  }
  .gl-refl {
    opacity: calc(0.5 * var(--daylight, 0));
  }
  .gl-refl-city {
    fill: var(--city-sunlit, #dbe4e7);
    opacity: 0.18;
  }
  .gl-glare {
    opacity: calc(var(--city-sun-on, 0) * 1.1);
  }
  .gl-glare .thin {
    opacity: 0.7;
  }
  .gl-door {
    fill: var(--city-shade, #080b11);
    stroke: rgba(237, 228, 212, 0.18);
    stroke-width: 0.6;
  }
  .gl-fan {
    fill: var(--gl-lamp);
    opacity: calc(0.12 + 0.8 * var(--windows, 0));
  }

  /* ---- the pavement */
  .gl-spill {
    opacity: calc(0.85 * var(--windows, 0));
  }
  .gl-foot {
    fill: none;
    stroke: rgba(237, 228, 212, 0.5);
    stroke-width: 2;
    stroke-dasharray: 0.5 5;
    stroke-linecap: round;
  }
  .gl-ppl {
    fill: color-mix(in srgb, #07090d calc(30% + 70% * var(--windows, 0)), var(--city-shade, #132842));
  }

  /* ---- the fascia's lettering, glowing warm after dark */
  .gl-fascia {
    position: absolute;
    left: calc((440 + 6) / 10 * 1%);
    width: calc((540 - 12) / 10 * 1%);
    top: calc(116 / 600 * 100%);
    height: calc(24 / 600 * 100%);
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1.6%;
    box-sizing: border-box;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.78);
    pointer-events: none;
  }
  .gl-fascia b {
    font-weight: 600;
    color: color-mix(in srgb, #e2bd78 calc(35% + 65% * var(--windows, 0)), rgba(237, 228, 212, 0.86));
    text-shadow: 0 0 calc(10px * var(--windows, 0)) rgba(255, 190, 110, 0.55);
  }
  .gl-fascia span {
    opacity: 0.62;
    letter-spacing: 0.2em;
  }

  /* ---- states */
  .gl-sheet .cloth {
    fill: color-mix(in srgb, #8c8274 calc(55% + 45% * var(--windows, 0)), #6b6459);
  }
  .gl-sheet .folds {
    fill: none;
    stroke: #8f8170;
    stroke-width: 1.2;
    opacity: 0.55;
  }
  .gl-card .board {
    fill: #f3ecdc;
    stroke: #8a7a62;
    stroke-width: 0.6;
  }
  .gl-card .string {
    fill: none;
    stroke: rgba(237, 228, 212, 0.6);
    stroke-width: 0.6;
  }
  .gl-card .hook {
    fill: rgba(207, 227, 238, 0.35);
    stroke: rgba(237, 228, 212, 0.5);
    stroke-width: 0.6;
  }
  .gl-card-words {
    position: absolute;
    left: calc(520 / 10 * 1%);
    width: calc(76 / 10 * 1%);
    top: calc(494 / 600 * 100%);
    height: calc(42 / 600 * 100%);
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transform: rotate(-2deg);
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 15px;
    line-height: 1.05;
    text-align: center;
    color: #3a2a1a;
    pointer-events: none;
  }
  .gl-held.ended {
    filter: saturate(0.55);
  }
  .gl-held.still {
    filter: saturate(0.5) brightness(0.8);
  }
  /* Between lives the lights drop to the two outer spots; offline to the middle one (a factor on each light's own opacity). */
  .gl[data-state='between-lives'] [data-spot='1'],
  .gl[data-state='offline'] [data-spot='0'],
  .gl[data-state='offline'] [data-spot='2'] {
    --gl-spot: 0.1;
  }
  .gl[data-state='offline'] .gl-lit {
    opacity: calc(var(--gl-on) * 0.6);
  }

  /* A phone: the fascia centres its name and drops its line; the card's words come down a size. */
  @media (max-width: 759px) {
    .gl-fascia {
      justify-content: center;
    }
    .gl-fascia span {
      display: none;
    }
    .gl-card-words {
      font-size: 12px;
    }
  }
  @media print {
    .gl {
      display: none;
    }
  }
</style>
