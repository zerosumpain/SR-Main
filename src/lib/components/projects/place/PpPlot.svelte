<svelte:options css="injected" />

<script lang="ts">
  // One project on its plot: its building drawn as an elevation at the
  // town's one scale (so a tower stands taller than a shed), the plot's
  // number on a plate, then what it is, what it does and the street sign of
  // what it is built with. The whole plot is the link; the owner's controls
  // sit above it.
  import type { Snippet } from 'svelte';
  import type { ProjectEntry } from '$lib/projects/views';
  import { facade, range, shapeOf } from './place';
  import PpBuilding from './PpBuilding.svelte';

  let { e, index, controls }: { e: ProjectEntry; index: number; controls: Snippet<[ProjectEntry]> } = $props();

  /** One street unit of weight on a plot, and the street's height: the same for every plot. */
  const UNIT = 64;
  const H = 240;
  let shape = $derived(shapeOf(e, index));
  let f = $derived(facade(e, shape.variant, shape.weight * UNIT, Math.min(H - 2, shape.height * H)));
  // Near the town's one scale, so a shed stays lower than a tower; only the tallest are held under the plot's sky.
  let k = $derived(Math.min(0.95, 146 / f.h));
  // A street tree beside it, on whichever side its key says.
  let treeLeft = $derived(e.n % 2 === 0);
  // The neighbours behind it: plain towers in the haze, the plot's own.
  let behind = $derived(range(`pp-plot:${e.key}`, 9, 14, 44).d);
</script>

<li class="pt" data-product={e.product ? '' : undefined} data-hidden={e.isPublic ? undefined : ''}>
  <div class="pt-art" aria-hidden="true">
    <svg class="pt-far" viewBox="0 0 1000 100" preserveAspectRatio="none" focusable="false"><path d={behind} /></svg>
    <span class="pt-no">No. {e.n}</span>
    <svg class="pt-tree" data-side={treeLeft ? 'l' : 'r'} style:--half="{(f.w * k) / 2}px" viewBox="0 0 24 40" focusable="false">
      <path d="M12,40 V22" /><circle cx="12" cy="15" r="10" />
    </svg>
    <div class="pt-b" style:width="{f.w * k}px" style:height="{f.h * k}px">
      <PpBuilding {f} hidden={!e.isPublic} />
    </div>
  </div>
  <div class="pt-copy">
    <p class="pt-kind"><span class="pt-k">{e.kind}</span> <span class="pt-tag">{e.tag}</span></p>
    <h3 class="pt-title">
      <a class="pt-link" href={e.href} data-sveltekit-reload={e.separateApp ? '' : undefined} rel={e.external ? 'noopener' : undefined}>{e.title}</a>
    </h3>
    <p class="pt-blurb">{e.blurb}</p>
    <p class="pt-sign">{e.chips}</p>
    <div class="pt-ctl">{@render controls(e)}</div>
  </div>
</li>

<style>
  .pt {
    --on: 237, 228, 212;
    --hue: #f4b270;
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid rgba(var(--on), 0.18);
    background: rgba(8, 20, 44, 0.28);
    transition: border-color var(--t-base, 220ms) ease;
  }
  /* A finished product reads in petrol, not orange: a kind, not a rank. */
  .pt[data-product] {
    --hue: #a3d2d8;
  }
  .pt[data-hidden] {
    border-style: dashed;
    border-color: rgba(var(--on), 0.34);
  }
  .pt:hover,
  .pt:focus-within {
    border-color: rgba(var(--on), 0.5);
  }

  /* The elevation: the building on its plot, a pale sky behind it, the
     pavement at its foot. */
  .pt-art {
    position: relative;
    height: 176px;
    overflow: hidden;
    background: linear-gradient(180deg, #2a5389 0%, #3c6aa0 70%, #5d86b4 100%);
    border-bottom: 3px solid #2d3947;
  }
  .pt-far {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 100%;
    height: 46%;
    fill: rgba(20, 42, 74, 0.42);
  }
  .pt-b {
    position: absolute;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    transition: transform var(--t-base, 220ms) ease;
  }
  .pt:hover .pt-b,
  .pt:focus-within .pt-b {
    transform: translate(-50%, -3px);
  }
  .pt-tree {
    position: absolute;
    bottom: 0;
    left: calc(50% + var(--half) + 12px);
    width: 22px;
    height: 37px;
  }
  .pt-tree[data-side='l'] {
    left: calc(50% - var(--half) - 34px);
  }
  .pt-tree path {
    fill: none;
    stroke: #2a3442;
    stroke-width: 1.6;
  }
  .pt-tree circle {
    fill: #6d8f7a;
    stroke: rgba(26, 16, 8, 0.4);
  }
  /* The plot's number, on a plate like a house number. */
  .pt-no {
    position: absolute;
    z-index: 1;
    top: 12px;
    left: 12px;
    padding: 3px 7px;
    background: #0f2648;
    border: 1px solid rgba(var(--on), 0.5);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: rgb(var(--on));
  }

  .pt-copy {
    display: flex;
    flex: 1;
    flex-direction: column;
    padding: 16px 18px 18px;
  }
  .pt-kind {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    margin: 0 0 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .pt-k {
    color: var(--hue);
  }
  .pt-tag {
    color: rgba(var(--on), 0.72);
  }
  .pt-title {
    margin: 0 0 8px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: var(--fs-body-lg);
    line-height: 1.2;
    letter-spacing: -0.01em;
  }
  .pt-link {
    color: rgb(var(--on));
    text-decoration: none;
  }
  /* The whole plot is the link. */
  .pt-link::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
  }
  .pt:hover .pt-link {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  .pt-link:focus-visible {
    outline: none;
  }
  .pt:has(.pt-link:focus-visible) {
    outline: 2px solid #f4b270;
    outline-offset: 3px;
  }
  .pt-blurb {
    display: -webkit-box;
    margin: 0 0 14px;
    overflow: hidden;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: rgba(var(--on), 0.8);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
    line-clamp: 4;
  }
  /* What it is built with, as a street name plate. */
  .pt-sign {
    margin: auto 0 0;
    padding: 6px 10px;
    background: #0f2648;
    border: 1px solid rgba(var(--on), 0.3);
    border-left: 3px solid var(--hue);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(var(--on), 0.86);
  }
  .pt-ctl {
    position: relative;
    z-index: 2;
    --pc-ctl-ink: rgba(237, 228, 212, 0.86);
    --pc-ctl-line: rgba(237, 228, 212, 0.4);
    --pc-ctl-hot: #f4b270;
  }
  .pt-ctl:not(:empty) {
    margin-top: 12px;
  }
  /* The host's danger red is drawn for paper; on the night-blue it needs to be lighter to read. */
  .pt-ctl :global(.ctl.danger) {
    color: #ff9c8f;
    border-color: #ff9c8f;
  }
  .pt-ctl :global(.ctl-chip.private) {
    color: #ffd2cc;
    background: rgba(204, 68, 68, 0.32);
  }

  @media (prefers-reduced-motion: reduce) {
    .pt,
    .pt-b {
      transition: none;
    }
    .pt:hover .pt-b,
    .pt:focus-within .pt-b {
      transform: translateX(-50%);
    }
  }
  @media print {
    .pt,
    .pt[data-hidden] {
      break-inside: avoid;
      border: 1px solid #999;
      background: none;
    }
    .pt-art {
      display: none;
    }
    .pt-link,
    .pt-k,
    .pt-tag,
    .pt-blurb,
    .pt-sign {
      color: #1a1008;
    }
    .pt-sign {
      background: none;
    }
    .pt-blurb {
      display: block;
    }
  }
</style>
