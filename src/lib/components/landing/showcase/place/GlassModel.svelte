<svelte:options css="injected" />

<script lang="ts">
  // The model under the glass (wildmind-glass.ts): the cards, a layer for
  // every step of height, each drawn twice, once at the height of the card
  // below in the ply's colour and once at its own in the card's, so the strip
  // between is the card's edge; the trees and marsh marks on each card; then
  // the live pieces on top: card huts, a fire's bead, the animals as specks,
  // and the two painted figures on their bases, standing or lying down, with
  // the first stretch of their labels' leaders. Two SVG layers over the
  // gallery's: the cards change only with the terrain, so a glide repaints
  // the pieces' layer alone. Every fill is a token, set by GlassArt.
  import { FIGURE, GALLERY, type Figure, type HutSpot, type PersonAnchor } from '$lib/landing/showcase-place-wildmind';
  import type { WildmindGlass } from '$lib/landing/wildmind-glass';
  import { untrack } from 'svelte';

  let {
    glass,
    figures,
    huts,
    fires,
    animals,
    anchors,
  }: {
    glass: WildmindGlass | null;
    figures: Figure[];
    huts: HutSpot[];
    fires: Array<{ x: number; y: number }>;
    animals: Array<{ x: number; y: number }>;
    anchors: PersonAnchor[];
  } = $props();

  const B = GALLERY.board;
  const FIG = FIGURE.scale;

  // The cards' faces run from a sandy card at the bottom to a pale one on top.
  const LO = [205, 176, 138];
  const HI = [243, 236, 223];
  const face = (i: number, n: number) => {
    const t = n > 2 ? (i - 1) / (n - 2) : 1;
    return `rgb(${LO.map((v, k) => Math.round(v + (HI[k] - v) * t)).join(',')})`;
  };

  // A new terrain version (a new life, or a valley grown) fades in; the first one is simply there.
  const first = untrack(() => glass?.version ?? null);
  let fresh = $derived(!!glass && glass.version !== first);

  /** The specks, as one path of round dots. */
  let specks = $derived(animals.map((a) => `M${Math.round(a.x * 10) / 10} ${Math.round(a.y * 10) / 10}h0`).join(''));
  let leaders = $derived(new Map(anchors.map((a) => [a.id, a])));
</script>

<svg class="gl-layer gm" viewBox="0 0 1000 {GALLERY.h}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
  {#if glass}
    {#key glass.version}
      <g class="gm-model" class:fresh transform="translate({B.x} {B.y})">
        <path class="gm-contact" d={glass.cards[0]?.d ?? ''} transform="translate(1.6 2.6)" />
        {#each glass.cards as c, i (i)}
          {#if c.d}
            <g class="gm-card" style:--i={i}>
              <path class={i % 2 ? 'gm-side a' : 'gm-side b'} d={c.d} transform="translate(0 {-(i ? glass.cards[i - 1].lift : 0)})" />
              <path class={i === 0 ? 'gm-face gm-water' : 'gm-face'} d={c.d} transform="translate(0 {-c.lift})" style:fill={i === 0 ? undefined : face(i, glass.cards.length)} />
              {#if c.wet}
                <path class="gm-wet" d={c.wet} /><path class="gm-wet" d={c.wet} transform="translate(.8 -1.1)" />
              {/if}
              {#if c.wood}
                {#each c.wood as d, k (k)}
                  {#if d}
                    <path class="gm-tree" {d} stroke-width={glass.tree[k] * 2} />
                    <path class="gm-tree-hi" {d} stroke-width={glass.tree[k] * 0.84} transform="translate({-glass.tree[k] * 0.3} {-glass.tree[k] * 0.35})" />
                  {/if}
                {/each}
              {/if}
            </g>
          {/if}
        {/each}
      </g>
    {/key}
  {/if}
</svg>

<svg class="gl-layer gp" id="sp-wm-model" viewBox="0 0 1000 {GALLERY.h}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
  {#if glass}
    <g class="gp-pieces">
      {#if specks}<path class="gp-animals" d={specks} />{/if}
      {#each huts as h (`${h.x}:${h.y}`)}
        <g class="gp-hut" class:lit={h.lit} class:open={!h.done} transform="translate({h.x} {h.y})">
          <path class="hw" d="M-4.4,0v-4.6h8.8v4.6z" />
          <path class="hr" d="M-5.4,-4.2L0,-8.8L5.4,-4.2z" />
          <rect class="hd" x="-1.1" y="-3" width="2.2" height="3" />
        </g>
      {/each}
      {#each fires as f, i (i)}
        <g class="gp-fire" transform="translate({f.x} {f.y - 1.8})">
          <circle class="glow" r="9" />
          <circle class="core" r="2.1" />
        </g>
      {/each}
    </g>
  {/if}
  {#each figures as f (f.id)}
    {@const a = leaders.get(f.id)}
    <g class="gp-who" data-part={f.id} data-who={f.id} class:gone={!f.alive}>
      {#if a}
        <path class="gp-lead" d={a.lead} />
        <circle class="gp-dot" cx={a.x} cy={a.y} r="1.9" />
      {/if}
      <g transform="translate({f.x} {f.y}) scale({FIG})">
        {#if f.alive}<ellipse class="pool" rx="15" ry="4.6" />{/if}
        {#if f.alive}<ellipse class="base" rx="6.4" ry="2.2" />{:else}<ellipse class="base" rx="7.6" ry="2.7" />{/if}
        {#if f.alive && f.asleep}
          <path class="body" d="M-6.4,-3.6h9.6a1.7,1.7 0 0 1 0,3.4h-9.6a1.7,1.7 0 0 1 0,-3.4z" />
          <circle class="body" cx="5.4" cy="-2" r="2.2" />
        {:else if f.alive}
          <path class="body" d="M-1.9,-1v-7.4a1.9,1.9 0 0 1 3.8,0v7.4z" />
          <circle class="body" cy="-11.2" r="2.3" />
        {/if}
      </g>
    </g>
  {/each}
</svg>

<style>
  .gm-contact {
    fill: #000;
    opacity: 0.5;
  }
  .gm-side {
    stroke-width: 0.8;
    stroke-linejoin: round;
  }
  .gm-side.a {
    fill: var(--gm-ply-a);
    stroke: var(--gm-ply-a);
  }
  .gm-side.b {
    fill: var(--gm-ply-b);
    stroke: var(--gm-ply-b);
  }
  .gm-face {
    stroke: var(--gm-edge);
    stroke-width: 0.35;
    fill-rule: evenodd;
  }
  .gm-side {
    fill-rule: evenodd;
  }
  .gm-water {
    fill: var(--gm-water);
  }
  .gm-tree,
  .gm-tree-hi {
    fill: none;
    stroke-linecap: round;
  }
  .gm-tree {
    stroke: var(--gm-tree);
  }
  .gm-tree-hi {
    stroke: var(--gm-tree-hi);
  }
  .gm-wet {
    fill: none;
    stroke: var(--gm-water);
    stroke-width: 0.55;
  }
  .gm-model.fresh {
    animation: gm-fresh 900ms ease-out both;
  }
  @keyframes gm-fresh {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  /* The flourish: the cards go down one by one, from the board up, as the count runs. */
  :global(.sp-scene[data-arm]) .gm-card,
  :global(.sp-scene[data-arm]) .gp {
    opacity: 0;
  }
  :global(.sp-scene[data-play]) .gm-card {
    animation: gm-lay 520ms cubic-bezier(0.2, 0.7, 0.3, 1) calc(var(--i) * 120ms) both;
  }
  :global(.sp-scene[data-play]) .gp {
    animation: gm-fresh 500ms ease-out 900ms both;
  }
  @keyframes gm-lay {
    from {
      opacity: 0;
      transform: translateY(-7px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .gp-animals {
    fill: none;
    stroke: var(--gm-speck);
    stroke-width: 1.7;
    stroke-linecap: round;
  }
  .gp-hut .hw {
    fill: #f6f1e6;
    stroke: #6b5a44;
    stroke-width: 0.4;
  }
  .gp-hut .hr {
    fill: #ddd0b8;
    stroke: #6b5a44;
    stroke-width: 0.4;
  }
  .gp-hut .hd {
    fill: #4a3c2c;
  }
  .gp-hut.lit .hd {
    fill: var(--gl-lamp);
  }
  .gp-hut.open .hw,
  .gp-hut.open .hr {
    fill: none;
    stroke-dasharray: 1.2 1;
  }
  .gp-fire .core {
    fill: #ffcf5a;
  }
  .gp-fire .glow {
    fill: url(#sp-wm-bead);
  }
  .gp-who .pool {
    fill: var(--t);
    opacity: var(--gm-pool, 0.3);
  }
  .gp-who .base {
    fill: #15110d;
    stroke: var(--t);
    stroke-width: 1.1;
  }
  .gp-who .body {
    fill: var(--t);
    stroke: #15110d;
    stroke-width: 0.6;
  }
  /* Where someone fell: their base left empty, ringed in their colour. */
  .gp-who.gone .base {
    fill: rgba(21, 17, 13, 0.55);
    stroke-width: 1.4;
    stroke-dasharray: 2 1.4;
  }
  .gp-who[data-who='main'] {
    --t: var(--accent-on-dark);
  }
  .gp-who[data-who='companion'] {
    --t: var(--accent-ink-on-dark);
  }
  .gp-lead {
    fill: none;
    stroke: rgba(237, 228, 212, 0.5);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .gp-dot {
    fill: #ede4d4;
  }

  /* A phone: the labels are in the list under the picture, so the leaders have nowhere to go. */
  @media (max-width: 759px) {
    .gp-lead,
    .gp-dot {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .gm-model.fresh,
    .gm-card,
    .gp {
      animation: none !important;
    }
  }
</style>
