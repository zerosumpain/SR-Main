<script lang="ts">
  // 06 — EFFORT & RECOVERY. What the outing cost, and how fast it was paid off.
  //
  // The recovery curve is drawn here rather than through `TraceChart` because
  // the framing IS the panel: a vertical rule at sixty seconds, a dot on the
  // curve where it crosses, and the reading called out beside it. Everything
  // else on the page is a line in a frame; this one is a line with a claim
  // pinned to it.
  //
  // The sixty-second mark is FOUND, not indexed. The watch returns the recovery
  // samples on whatever grid it likes, so the crossing is interpolated — and
  // when the curve does not reach a full minute there is no marker and no
  // HRR60, because `hrr60` is null in exactly that case and inventing the dot
  // would be inventing the number.
  import EvidenceChip from '$lib/components/health/EvidenceChip.svelte';
  import { activityLabel } from '$lib/trails/format';
  import type { ActivityDetail } from '$lib/trails/activities-service';
  import type { ActivityPhysio } from '$lib/trails/physio-service';
  import {
    comparisonNote,
    comparisons,
    decouplingNote,
    hrrNote,
    interpolate,
  } from '$lib/health/activity-detail';

  interface Props {
    activity: ActivityDetail;
    physio: ActivityPhysio;
    onevidence: (id: string) => void;
  }

  let { activity, physio, onevidence }: Props = $props();

  const W = 600;
  const TOP = 15;
  const FLOOR = 100;

  const curve = $derived(physio.hrrCurve ?? []);

  const geometry = $derived.by(() => {
    if (curve.length < 2) return null;
    const values = curve.map((p) => p[1]);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = hi > lo ? hi - lo : 1;
    const t0 = curve[0][0];
    const tN = curve[curve.length - 1][0];
    const tSpan = tN - t0 || 1;
    const x = (t: number) => ((t - t0) / tSpan) * W;
    const y = (v: number) => FLOOR - ((v - lo) / span) * (FLOOR - TOP);
    const at60 = interpolate(curve as Array<[number, number]>, t0 + 60);
    return {
      lo,
      hi,
      tN: tN - t0,
      line: curve.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' '),
      start: { x: x(t0), y: y(curve[0][1]) },
      mark: at60 == null ? null : { x: x(t0 + 60), y: y(at60), hr: Math.round(at60) },
    };
  });

  /** Keep the callout inside the viewBox when the marker sits near the end. */
  const callout = $derived.by(() => {
    const mark = geometry?.mark;
    if (!mark) return null;
    const flip = mark.x > 380;
    return {
      x: flip ? mark.x - 8 : mark.x + 8,
      // Lifted clear of the curve, and never pushed out of the top of the plot
      // — at the floor of a steep recovery the label would otherwise sit on
      // the line it is annotating.
      y: Math.max(TOP + 9, mark.y - 12),
      anchor: flip ? 'end' : 'start',
      text: `${mark.hr} AT 60s`,
    };
  });

  const endLabel = $derived.by(() => {
    const seconds = geometry?.tN ?? 0;
    if (seconds >= 120) return `+${Math.round(seconds / 60)} min`;
    return `+${Math.round(seconds)}s`;
  });

  const recovery = $derived(hrrNote(physio.hrr60));
  const decoupling = $derived(
    decouplingNote(physio.decouplingPct, activity.activeDurationS ?? activity.durationS),
  );
  const vs = $derived(comparisons(activity, physio));
  const vsNote = $derived(vs ? comparisonNote(vs.rows) : '');

  const hasLeft = $derived(!!geometry);
  const hasRight = $derived(!!decoupling || !!vs);
</script>

{#if hasLeft || hasRight}
  <section class="ae">
    <div class="ae-inner">
      <div class="ae-head">
        <p class="ae-kicker">Effort &amp; recovery</p>
        {#if physio.hrr60 != null}
          <p class="ae-meta">
            HRR60 −{Math.round(physio.hrr60)} bpm
            <EvidenceChip id="hrr60" onopen={onevidence} />
          </p>
        {/if}
      </div>

      <div class="ae-grid" class:single={!hasLeft || !hasRight}>
        {#if geometry}
          <div class="ae-card">
            <p class="ae-card-label">Heart rate after finishing</p>
            <svg
              class="ae-chart"
              viewBox="-42 -10 654 132"
              role="img"
              aria-label="Heart rate over the two minutes after finishing"
            >
              <line class="ae-grid-line" x1="0" y1={TOP} x2={W} y2={TOP} />
              <line class="ae-grid-line floor" x1="0" y1={FLOOR} x2={W} y2={FLOOR} />
              <text class="ae-tick" x="-6" y={TOP + 4} text-anchor="end"
                >{Math.round(geometry.hi)}</text
              >
              <text class="ae-tick" x="-6" y={FLOOR + 4} text-anchor="end"
                >{Math.round(geometry.lo)}</text
              >

              {#if geometry.mark}
                <line
                  class="ae-mark-rule"
                  x1={geometry.mark.x}
                  y1={TOP}
                  x2={geometry.mark.x}
                  y2={FLOOR}
                />
              {/if}

              <polyline class="ae-line" points={geometry.line} />
              <circle class="ae-dot" cx={geometry.start.x} cy={geometry.start.y} r="3.5" />
              {#if geometry.mark}
                <circle class="ae-dot" cx={geometry.mark.x} cy={geometry.mark.y} r="4.5" />
              {/if}
              {#if callout}
                <text class="ae-callout" x={callout.x} y={callout.y} text-anchor={callout.anchor}
                  >{callout.text}</text
                >
              {/if}

              <text class="ae-tick" x="0" y="118">Finish</text>
              {#if geometry.mark}
                <text class="ae-tick" x={geometry.mark.x} y="118" text-anchor="middle">+60s</text>
              {/if}
              <text class="ae-tick" x={W} y="118" text-anchor="end">{endLabel}</text>
            </svg>
            {#if recovery}<p class="ae-body">{recovery}</p>{/if}
          </div>
        {/if}

        {#if hasRight}
          <div class="ae-card stack">
            {#if decoupling}
              <div class="ae-strip">
                <p class="ae-strip-label">
                  Aerobic decoupling
                  <EvidenceChip id="decoupling" onopen={onevidence} />
                </p>
                <p class="ae-figure">
                  {physio.decouplingPct?.toFixed(1)}<span class="ae-figure-unit">%</span>
                </p>
                <p class="ae-body tight">{decoupling}</p>
              </div>
            {/if}

            {#if vs}
              <div class="ae-vs" class:ruled={!!decoupling}>
                <p class="ae-vs-label">
                  Against your last {vs.n}
                  {activityLabel(activity.activityType).toLowerCase()}s
                </p>
                <div class="ae-vs-rows">
                  {#each vs.rows as row (row.label)}
                    <div class="ae-vs-row">
                      <p class="ae-vs-name">{row.label}</p>
                      <p class="ae-vs-value {row.tone}">{row.text}</p>
                    </div>
                  {/each}
                </div>
                {#if vsNote}<p class="ae-body">{vsNote}</p>{/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </section>
{/if}

<style>
  .ae {
    padding: clamp(30px, 3.6vw, 48px) clamp(20px, 3vw, 44px);
    background: var(--bg-section);
    border-bottom: 2px solid var(--line);
  }
  .ae-inner {
    max-width: 1300px;
    margin: 0 auto;
  }

  .ae-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 22px;
  }
  .ae-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin: 0;
  }
  .ae-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }

  .ae-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    gap: clamp(18px, 2.2vw, 30px);
    align-items: stretch;
  }
  .ae-grid.single {
    grid-template-columns: minmax(0, 1fr);
  }

  .ae-card {
    border: 1px solid var(--card-border);
    border-radius: 0;
    background: var(--bg);
    padding: 20px;
    min-width: 0;
  }
  .ae-card.stack {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .ae-card-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    margin: 0 0 14px;
  }

  .ae-chart {
    width: 100%;
    height: auto;
    display: block;
  }
  .ae-grid-line {
    stroke: var(--line-hair);
    stroke-width: 1;
  }
  .ae-grid-line.floor {
    stroke: var(--card-border);
  }
  .ae-mark-rule {
    stroke: var(--accent-tint-35);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .ae-line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.2;
    stroke-linejoin: round;
  }
  .ae-dot {
    fill: var(--accent);
  }
  /* svg-user-units: viewBox -42 -10 654 132 rendered ~600px wide, so a 9-unit
     label is ~9 screen px at the narrowest column and larger everywhere else. */
  .ae-tick,
  .ae-callout {
    font-family: var(--font-mono);
    font-size: 9px; /* svg-user-units */
    letter-spacing: 0.6px;
    text-transform: uppercase;
    fill: var(--text-ghost);
  }
  /* A paper halo, drawn under the glyphs, so the callout stays legible where
     it crosses the trace. `paint-order` is what keeps the stroke behind the
     fill rather than fattening the letters. */
  .ae-callout {
    fill: var(--accent);
    stroke: var(--bg);
    stroke-width: 3;
    paint-order: stroke fill;
  }

  .ae-body {
    font-size: var(--fs-nav);
    line-height: 1.5;
    color: var(--text-muted);
    text-wrap: pretty;
    margin: 16px 0 0;
  }
  .ae-body.tight {
    color: var(--text-secondary);
    margin-top: 10px;
  }

  /* The one 3px rule in the design: an accent left strip, never a shadow. */
  .ae-strip {
    border-left: 3px solid var(--accent);
    padding-left: 16px;
  }
  .ae-strip-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 8px;
  }
  .ae-figure {
    font-family: var(--font-display);
    font-size: 30px;
    line-height: 0.95;
    letter-spacing: -0.02em;
    margin: 0;
  }
  .ae-figure-unit {
    font-size: var(--fs-body-sm);
    color: var(--text-ghost);
  }

  .ae-vs.ruled {
    border-top: 1px solid var(--line);
    padding-top: 18px;
  }
  .ae-vs-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 12px;
  }
  .ae-vs-rows {
    display: flex;
    flex-direction: column;
    gap: 11px;
  }
  .ae-vs-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
  }
  .ae-vs-name {
    font-size: var(--fs-nav);
    color: var(--text-secondary);
    margin: 0;
  }
  .ae-vs-value {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-weight: 500;
    margin: 0;
    white-space: nowrap;
  }
  .ae-vs-value.good {
    color: var(--good);
  }
  .ae-vs-value.cost {
    color: var(--accent);
  }
  .ae-vs-value.flat {
    color: var(--text-muted);
  }

  @media (max-width: 860px) {
    .ae-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
