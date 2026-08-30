<script lang="ts">
  // 03 — FORM. Which way this ground is going, and every effort on it.
  //
  // The four cards read `segmentForm`; none of them recompute it. It is
  // median-based on purpose — one effort spent waiting at a gate is a 40%
  // outlier on a short segment, and a mean would call that a collapse — with a
  // ±2% holding band, a six-effort floor, and `daysSincePb` measured to NOW
  // rather than to the last effort.
  //
  // THE SQUARE MARKER IS NOT DECORATION. An effort whose heart-rate window
  // covered less than half the distance has no average claimed for it, so it is
  // unranked on every HR-derived metric. The scatter draws those as squares so
  // a reader can see which dots the efficiency story is not built from.
  import SectionHead from './SectionHead.svelte';
  import {
    formCards,
    formKicker,
    formTitle,
    scatterGeometry,
    scatterNote,
    SCATTER,
  } from '$lib/health/segment-detail';
  import type { SegmentDetail } from '$lib/trails/segments-service';

  interface Props {
    segment: SegmentDetail;
    nowS: number;
  }

  let { segment, nowS }: Props = $props();

  const cards = $derived(formCards(segment, nowS));
  const scatter = $derived(scatterGeometry(segment.efforts));
  const note = $derived(scatterNote(segment));
</script>

<section class="sf">
  <div class="sf-inner">
    <SectionHead
      kicker={formKicker(segment.efforts, nowS)}
      title={formTitle(segment.form)}
      strap="Median-based, deliberately: one effort spent waiting at a gate is a 40% outlier, and a mean would call that a collapse in form."
    />

    <div class="sf-cards">
      {#each cards as card (card.key)}
        <div class="sf-card" class:loud={card.loud}>
          <p class="sf-label" class:lit={card.loud}>{card.label}</p>
          <p class="sf-value tone-{card.tone}">
            {card.value}{#if card.unit}<span class="sf-unit">{card.unit}</span>{/if}
          </p>
          <p class="sf-note">{card.note}</p>
        </div>
      {/each}
    </div>

    {#if scatter}
      <div class="sf-chart">
        <div class="sf-chart-head">
          <p class="sf-chart-label">Every effort, oldest first</p>
          <div class="sf-keys">
            <span class="sf-key"><i class="k-pb"></i>PB</span>
            <span class="sf-key"><i class="k-median"></i>Rolling median</span>
            <span class="sf-key"><i class="k-square"></i>No HR claimed</span>
          </div>
        </div>

        <svg
          class="sf-svg"
          viewBox="0 0 {SCATTER.w} {SCATTER.h}"
          role="img"
          aria-label="Every effort on this segment, oldest first"
        >
          {#each scatter.gridlines as line, i (i)}
            <line
              x1={SCATTER.x0 - 20}
              y1={line.y}
              x2={SCATTER.w}
              y2={line.y}
              class="sf-grid"
              class:last={i === scatter.gridlines.length - 1}
            />
            <text x={SCATTER.x0 - 26} y={line.y + 4} text-anchor="end" class="sf-tick">
              {line.label}
            </text>
          {/each}

          {#if scatter.medianLine}
            <polyline points={scatter.medianLine} class="sf-median" />
          {/if}

          {#if scatter.pb}
            <line
              x1={scatter.pb.x}
              y1={SCATTER.top}
              x2={scatter.pb.x}
              y2={SCATTER.bottom}
              class="sf-pb-rule"
            />
          {/if}

          {#each scatter.dots as dot (dot.key)}
            {#if dot.kind === 'unranked'}
              <rect x={dot.x - 3.5} y={dot.y - 3.5} width="7" height="7" class="sf-dot-square" />
            {:else}
              <circle
                cx={dot.x}
                cy={dot.y}
                r={dot.kind === 'pb' ? 5.5 : dot.kind === 'last' ? 4.5 : 3.5}
                class="sf-dot {dot.kind}"
              />
            {/if}
          {/each}

          {#if scatter.pb}
            <text x={scatter.pb.x + 7} y={scatter.pb.y - 8} class="sf-tick lit">{scatter.pb.label}</text>
          {/if}
          {#if scatter.last}
            <text x={scatter.last.x - 7} y={scatter.last.y - 10} text-anchor="end" class="sf-tick ink">
              {scatter.last.label}
            </text>
          {/if}

          {#each scatter.xLabels as label, i (i)}
            <text x={label.x} y={SCATTER.h - 16} text-anchor={label.anchor} class="sf-tick">
              {label.label}
            </text>
          {/each}
        </svg>

        <p class="sf-chart-note">{note}</p>
      </div>
    {/if}
  </div>
</section>

<style>
  .sf {
    padding: clamp(40px, 5vw, 68px) clamp(20px, 3vw, 44px);
    background: var(--bg-section);
    border-bottom: 2px solid var(--line);
  }
  .sf-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  .sf-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 16px;
    margin-bottom: clamp(20px, 2.4vw, 28px);
  }
  .sf-card {
    border: 1px solid var(--card-border);
    border-radius: 0;
    background: var(--bg);
    padding: 20px;
    min-width: 0;
  }
  /* 2px and a tint: the verdict is the card the section is for. */
  .sf-card.loud {
    border: 2px solid var(--accent-tint-35);
    background: var(--accent-tint-08);
  }

  .sf-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 12px;
  }
  .sf-label.lit {
    color: var(--accent);
  }

  .sf-value {
    font-family: var(--font-display);
    font-size: 26px;
    line-height: 0.95;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    margin: 0 0 10px;
    overflow-wrap: anywhere;
  }
  .sf-value.tone-good {
    color: var(--good);
  }
  .sf-value.tone-accent {
    color: var(--accent);
  }
  .sf-unit {
    font-size: var(--fs-nav);
    color: var(--text-ghost);
  }
  .sf-note {
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-secondary);
    text-wrap: pretty;
    margin: 0;
  }

  .sf-chart {
    border: 1px solid var(--card-border);
    border-radius: 0;
    background: var(--bg);
    padding: clamp(20px, 2.4vw, 30px);
    min-width: 0;
  }
  .sf-chart-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 22px;
  }
  .sf-chart-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin: 0;
  }
  .sf-keys {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
  }
  .sf-key {
    display: flex;
    align-items: center;
    gap: 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .sf-key i {
    display: block;
    flex-shrink: 0;
  }
  .k-pb {
    width: 8px;
    height: 8px;
    border-radius: 100px;
    background: var(--accent);
  }
  .k-median {
    width: 14px;
    height: 2px;
    background: color-mix(in srgb, var(--text-primary) 40%, transparent);
  }
  .k-square {
    width: 8px;
    height: 8px;
    border: 1px solid color-mix(in srgb, var(--text-primary) 40%, transparent);
    background: color-mix(in srgb, var(--text-primary) 8%, transparent);
  }

  .sf-svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .sf-grid {
    stroke: var(--line-hair);
    stroke-width: 1;
  }
  .sf-grid.last {
    stroke: var(--line-strong);
  }
  .sf-median {
    fill: none;
    stroke: color-mix(in srgb, var(--text-primary) 40%, transparent);
    stroke-width: 2;
    stroke-dasharray: 6 4;
  }
  .sf-pb-rule {
    stroke: var(--accent-tint-35);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .sf-dot {
    fill: color-mix(in srgb, var(--text-primary) 45%, transparent);
  }
  .sf-dot.pb {
    fill: var(--accent);
  }
  .sf-dot.last {
    fill: var(--text-primary);
  }
  .sf-dot-square {
    fill: color-mix(in srgb, var(--text-primary) 8%, transparent);
    stroke: color-mix(in srgb, var(--text-primary) 40%, transparent);
    stroke-width: 1;
  }
  /* svg-user-units: viewBox 0 0 900 240 rendered ~1300px wide, so a 9-unit
     label lands near 13px on screen. */
  .sf-tick {
    font-family: var(--font-mono);
    font-size: 9px; /* svg-user-units */
    letter-spacing: 0.6px;
    fill: var(--text-ghost);
  }
  .sf-tick.lit {
    fill: var(--accent);
  }
  .sf-tick.ink {
    fill: var(--text-primary);
  }

  .sf-chart-note {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    text-wrap: pretty;
    max-width: 90ch;
    margin: 20px 0 0;
  }
</style>
