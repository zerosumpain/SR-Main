<script lang="ts">
  // 05 — THE RECORD, AND THE WEATHER.
  //
  // The scatter above answers whether the engine is improving. This answers a
  // narrower question: when the record actually moved.
  //
  // THE STEP PATH USES H AND V COMMANDS ONLY. A diagonal between two steps
  // would draw the record improving on a day nothing was run; the shape has to
  // carry one fact and one only, which is that a long flat stretch means
  // nothing has beaten it since. The thick translucent bar is that stretch,
  // measured to today.
  //
  // Conditions are the ambient temperature the WATCH recorded on the parent
  // outing. There is no weather history in this schema and open-meteo is
  // fetched live keyed to now, so it cannot answer "what was it like that day".
  // This is the only honest answer available, and it is three efforts a side.
  import SectionHead from './SectionHead.svelte';
  import {
    conditionsCells,
    conditionsVerdict,
    pbStepGeometry,
    PB_STEP,
    recordNote,
  } from '$lib/health/segment-detail';
  import type { SegmentDetail } from '$lib/trails/segments-service';

  interface Props {
    segment: SegmentDetail;
    nowS: number;
  }

  let { segment, nowS }: Props = $props();

  const steps = $derived(pbStepGeometry(segment.efforts, nowS));
  const note = $derived(recordNote(steps));
  const cells = $derived(conditionsCells(segment.conditions));
  const verdict = $derived(conditionsVerdict(segment.conditions));
</script>

{#if steps || cells}
  <section class="sr">
    <div class="sr-inner">
      <SectionHead
        kicker="05 / The record, and the weather"
        title={['When time was', 'last taken off it']}
        strap="The scatter above answers whether the engine is improving. This answers a narrower question: when the record actually moved."
      />

      <div class="sr-cols" class:one={!steps || !cells}>
        {#if steps}
          <div class="sr-panel">
            <div class="sr-head">
              <p class="sr-label">Personal best over time</p>
              <p class="sr-meta">
                {steps.steps} step{steps.steps === 1 ? '' : 's'} in {steps.months} months
              </p>
            </div>

            <svg
              class="sr-svg"
              viewBox="-40 -8 648 152"
              role="img"
              aria-label="The personal best as it stood on each day"
            >
              {#each steps.gridlines as line, i (i)}
                <line
                  x1="0"
                  y1={line.y}
                  x2={PB_STEP.w}
                  y2={line.y}
                  class="sr-grid"
                  class:last={i === steps.gridlines.length - 1}
                />
                <text x="-6" y={line.y + 4} text-anchor="end" class="sr-tick">{line.label}</text>
              {/each}

              {#if steps.flat}
                <line
                  x1={steps.flat.x}
                  y1={steps.flat.y}
                  x2={PB_STEP.w}
                  y2={steps.flat.y}
                  class="sr-flat"
                />
                <text x={PB_STEP.w} y="16" text-anchor="end" class="sr-tick muted">
                  {steps.flat.label}
                </text>
              {/if}

              <path d={steps.path} class="sr-step" />

              {#each steps.dots as dot, i (i)}
                <circle cx={dot.x} cy={dot.y} r="3" class="sr-dot" />
              {/each}
              <circle cx={steps.pb.x} cy={steps.pb.y} r="4.5" class="sr-dot" />
              <text
                x={steps.pb.anchor === 'end' ? steps.pb.x - 8 : steps.pb.x + 8}
                y={steps.pb.y - 5}
                text-anchor={steps.pb.anchor}
                class="sr-tick lit">{steps.pb.label}</text
              >

              {#each steps.xLabels as label, i (i)}
                <text x={label.x} y="138" text-anchor={label.anchor} class="sr-tick">
                  {label.label}
                </text>
              {/each}
            </svg>

            <p class="sr-note">{note}</p>
          </div>
        {/if}

        {#if cells}
          <div class="sr-panel">
            <div class="sr-head">
              <p class="sr-label">Conditions</p>
              <p class="sr-meta">
                {segment.conditions.sample} of {segment.effortCount} carried a reading
              </p>
            </div>

            <div class="sr-cond">
              {#each cells as cell (cell.key)}
                <div class="sr-cell" class:lit={cell.lit}>
                  <p class="sr-cell-label">{cell.label}</p>
                  <p class="sr-cell-value">
                    {cell.value}<span class="sr-cell-unit">°C</span>
                  </p>
                </div>
              {/each}
            </div>

            <p class="sr-note ruled">
              Ambient temperature the watch recorded on the parent outing. There is no weather
              history in this system, so this is the only honest answer to what it was like that day
              — and it is three efforts a side rather than one, because a single quick effort on a
              cold morning proves nothing.
            </p>
            {#if verdict}<p class="sr-verdict">{verdict}</p>{/if}
          </div>
        {/if}
      </div>
    </div>
  </section>
{/if}

<style>
  .sr {
    padding: clamp(40px, 5vw, 68px) clamp(20px, 3vw, 44px);
    border-bottom: 2px solid var(--line);
  }
  .sr-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  .sr-cols {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
    gap: clamp(18px, 2.2vw, 28px);
    align-items: stretch;
  }
  .sr-cols.one {
    grid-template-columns: minmax(0, 1fr);
  }
  @media (max-width: 860px) {
    .sr-cols {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .sr-panel {
    border: 1px solid var(--card-border);
    border-radius: 0;
    padding: clamp(18px, 2.2vw, 26px);
    min-width: 0;
  }
  .sr-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .sr-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin: 0;
  }
  .sr-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }

  .sr-svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .sr-grid {
    stroke: var(--line-hair);
    stroke-width: 1;
  }
  .sr-grid.last {
    stroke: var(--line-strong);
  }
  .sr-step {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.2;
  }
  .sr-dot {
    fill: var(--accent);
  }
  /* The flat stretch: one thick translucent rule, drawn under the step path. */
  .sr-flat {
    stroke: var(--accent-tint-35);
    stroke-width: 6;
  }
  /* svg-user-units: viewBox -40 -8 648 152 rendered ~700px wide, so a 9-unit
     label lands near 10px on screen. */
  .sr-tick {
    font-family: var(--font-mono);
    font-size: 9px; /* svg-user-units */
    letter-spacing: 0.6px;
    fill: var(--text-ghost);
  }
  .sr-tick.lit {
    fill: var(--accent);
  }
  .sr-tick.muted {
    fill: var(--text-muted);
  }

  .sr-cond {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    margin-bottom: 20px;
  }
  .sr-cell {
    border-left: 3px solid color-mix(in srgb, var(--text-primary) 20%, transparent);
    padding-left: 13px;
    min-width: 0;
  }
  .sr-cell.lit {
    border-left-color: var(--accent);
  }
  .sr-cell-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 7px;
  }
  .sr-cell.lit .sr-cell-label {
    color: var(--accent);
  }
  .sr-cell-value {
    font-family: var(--font-display);
    font-size: 26px;
    line-height: 0.95;
    letter-spacing: -0.02em;
    margin: 0;
  }
  .sr-cell.lit .sr-cell-value {
    color: var(--accent);
  }
  .sr-cell-unit {
    font-size: var(--fs-nav);
    color: var(--text-ghost);
  }

  .sr-note {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    text-wrap: pretty;
    margin: 20px 0 0;
  }
  .sr-note.ruled {
    margin-top: 0;
    padding-top: 18px;
    border-top: 1px solid var(--line);
  }
  .sr-verdict {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-primary);
    text-wrap: pretty;
    margin: 14px 0 0;
  }
</style>
