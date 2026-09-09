<script lang="ts">
  // B — THE PLOT. Every exploitation play on two axes a policy professional
  // already argues in: how easy it is to do, and how much of the objective it
  // destroys. Top right is the corner that ends careers.
  //
  // Drawn by hand rather than through a chart component because the encoding is
  // specific: radius carries exposure (the geometric mean of all four factors)
  // and fill carries its band, so a small pale dot bottom-left and a large solid
  // dot top-right are the same reading twice over.
  //
  // The box is 360 user units, not 100, and padded on every side. SVG text scales
  // with the viewBox, so a 100-unit box would make a real 12px type token a
  // twelfth of the chart — and the site gates every font size at a 12px floor,
  // which a hand-tuned sub-pixel literal fails for good reason. (The gate reads
  // comments too, so this one does not spell one out.)
  import type { Play } from '$lib/policy-analysis/view';
  import { BAND_FILL, BAND_LABEL, PLOT_SIZE, plotPoints } from '$lib/policy-analysis/view';

  interface Props {
    plays: Play[];
    inspect: (id: string) => void;
  }

  let { plays, inspect }: Props = $props();
  let hovered = $state<string | null>(null);

  const points = $derived(plotPoints(plays));
  const active = $derived(points.find((p) => p.play.artefact.id === hovered) ?? null);
  // Only the worst three are labelled on the plot itself; a number on every mark
  // is unreadable at this size and the list below carries the rest.
  const labelled = $derived(points.slice(0, 3));
</script>

{#if points.length}
  <figure class="plot-figure">
    <svg viewBox="0 0 {PLOT_SIZE} {PLOT_SIZE}" role="img" aria-label="Exploitation plays plotted by how easy they are against how much damage they do">
      <line class="axis" x1="44" y1="316" x2="330" y2="316" />
      <line class="axis" x1="44" y1="30" x2="44" y2="316" />
      <line class="grid" x1="187" y1="30" x2="187" y2="316" />
      <line class="grid" x1="44" y1="173" x2="330" y2="173" />
      <rect class="danger-zone" x="187" y="30" width="143" height="143" />
      {#each points as point (point.play.artefact.id)}
        <circle
          class="mark"
          class:dim={hovered !== null && hovered !== point.play.artefact.id}
          cx={point.x}
          cy={point.y}
          r={point.r}
          fill={BAND_FILL[point.play.band]}
          role="button"
          tabindex="0"
          aria-label="{point.play.artefact.label}. {BAND_LABEL[point.play.band]} exposure."
          onmouseenter={() => (hovered = point.play.artefact.id)}
          onmouseleave={() => (hovered = null)}
          onfocus={() => (hovered = point.play.artefact.id)}
          onblur={() => (hovered = null)}
          onclick={() => inspect(point.play.artefact.id)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inspect(point.play.artefact.id); } }}
        />
      {/each}
      {#each labelled as point, i (point.play.artefact.id)}
        <text class="rank" x={point.x} y={point.y + 4} text-anchor="middle">{i + 1}</text>
      {/each}
      <text class="axis-label" x="330" y="340" text-anchor="end">Easier to do →</text>
      <text class="axis-label" x="26" y="30" transform="rotate(-90 26 30)" text-anchor="end">More damaging →</text>
      <text class="zone-label" x="322" y="48" text-anchor="end">Easy and damaging</text>
    </svg>
    <figcaption>
      {#if active}
        <strong>{active.play.artefact.label}</strong>
        <span class="muted">{active.play.actor?.label ?? 'Actor unresolved'} · {BAND_LABEL[active.play.band]} · exposure {Math.round(active.play.exposure * 100)}%</span>
        <p>{active.play.artefact.statement}</p>
      {:else}
        <strong>{points.length} plays, ranked</strong>
        <span class="muted">Size is overall exposure. Hover a mark to read it; select one to open its evidence.</span>
        <p>The three worst are numbered. Nothing here is a prediction — each is a play the actor's own incentives make available.</p>
      {/if}
    </figcaption>
  </figure>
{/if}

<style>
  .plot-figure { display: grid; grid-template-columns: minmax(15rem, 22rem) minmax(0, 1fr); gap: 1.5rem; align-items: start; margin: 1.5rem 0 0; }
  @media (max-width: 720px) { .plot-figure { grid-template-columns: 1fr; } }
  svg { width: 100%; height: auto; overflow: visible; }
  .axis { stroke: var(--line-strong); stroke-width: 1.5; }
  .grid { stroke: var(--line); stroke-width: 1; stroke-dasharray: 4 5; }
  .danger-zone { fill: var(--accent-tint-04); }
  .mark { stroke: var(--bg); stroke-width: 2; cursor: pointer; transition: opacity .12s; }
  .mark.dim { opacity: .35; }
  .mark:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 2px; }
  .rank { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: var(--bg); pointer-events: none; }
  .axis-label, .zone-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: var(--text-muted); letter-spacing: .04em; text-transform: uppercase; }
  figcaption { border-left: 2px solid var(--accent); padding-left: 1rem; min-height: 6rem; }
  figcaption strong { display: block; font-size: var(--fs-body-lg); }
  figcaption p { margin: .5rem 0 0; }
  .muted { color: var(--text-muted); font-size: var(--fs-label); }
</style>
