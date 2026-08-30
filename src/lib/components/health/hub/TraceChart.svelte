<script lang="ts">
  // One trace: a line over a 600×105 plot, inside a PADDED viewBox.
  //
  // The padding is the whole point. Axis labels are drawn at x = −6 and the
  // x-axis row sits below the plot, so an unpadded box clips both — and it is
  // the VIEWPORT doing the clipping, not CSS, so no amount of `overflow` on the
  // parent gets them back. `-42 -10 654 158` leaves 42 user units for the value
  // labels on the left, 10 above the top gridline, and enough below for the
  // x-axis row.
  //
  // Extents are the raw min and max, unpadded: the top gridline IS the peak and
  // the bottom one IS the floor, which is what makes "185 / 137 / 90" beside a
  // heart-rate trace true rather than decorative.
  interface Props {
    /** `[x, y]`, x ascending. Two points minimum or nothing is drawn. */
    points: Array<[number, number]>;
    /** Three gridlines (top / mid / floor) or two (top / floor). */
    gridlines?: 3 | 2;
    /** Any CSS colour — a token in practice. */
    colour?: string;
    /** Fill the area under the line, for the elevation trace. */
    fill?: boolean;
    /** Renders the value labels down the left edge. */
    yFormat?: (value: number) => string;
    /** One, two or three labels, placed at the start, middle and end. */
    xLabels?: string[];
    /** A dashed rule across the plot — the heart-rate trace's average. */
    average?: number | null;
    averageLabel?: string | null;
    label: string;
  }

  let {
    points,
    gridlines = 3,
    colour = 'var(--accent)',
    fill = false,
    yFormat = (v: number) => String(Math.round(v)),
    xLabels = [],
    average = null,
    averageLabel = null,
    label,
  }: Props = $props();

  const W = 600;
  const TOP = $derived(gridlines === 3 ? 15 : 20);
  const FLOOR = $derived(gridlines === 3 ? 120 : 100);
  const BOX_H = $derived(gridlines === 3 ? 158 : 138);
  const AXIS_Y = $derived(gridlines === 3 ? 140 : 120);

  const extent = $derived.by(() => {
    const values = points.map((p) => p[1]);
    if (average != null && Number.isFinite(average)) values.push(average);
    if (!values.length) return { lo: 0, hi: 1 };
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    // A dead-flat series still needs a span, or every point lands on NaN.
    return hi > lo ? { lo, hi } : { lo: lo - 1, hi: hi + 1 };
  });

  function y(value: number): number {
    const span = extent.hi - extent.lo || 1;
    return FLOOR - ((value - extent.lo) / span) * (FLOOR - TOP);
  }

  const xSpan = $derived.by(() => {
    if (points.length < 2) return 0;
    return points[points.length - 1][0] - points[0][0];
  });

  const plotted = $derived.by(() => {
    if (points.length < 2 || !(xSpan > 0)) return [];
    const x0 = points[0][0];
    return points.map(([px, pv]) => [((px - x0) / xSpan) * W, y(pv)] as [number, number]);
  });

  const line = $derived(plotted.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' '));
  const area = $derived(
    plotted.length < 2
      ? ''
      : `M${plotted.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' L')} L${W},${FLOOR} L0,${FLOOR} Z`,
  );

  /** Top, middle and floor — the values the gridlines are actually at. */
  const yTicks = $derived.by(() =>
    gridlines === 3
      ? [
          { value: extent.hi, at: TOP },
          { value: (extent.hi + extent.lo) / 2, at: (TOP + FLOOR) / 2 },
          { value: extent.lo, at: FLOOR },
        ]
      : [
          { value: extent.hi, at: TOP },
          { value: extent.lo, at: FLOOR },
        ],
  );

  const avgY = $derived(average != null && Number.isFinite(average) ? y(average) : null);

  /** Start, middle, end — a two-label axis skips the middle. */
  const xTicks = $derived.by(() => {
    if (xLabels.length === 3) {
      return [
        { text: xLabels[0], x: 0, anchor: 'start' },
        { text: xLabels[1], x: W / 2, anchor: 'middle' },
        { text: xLabels[2], x: W, anchor: 'end' },
      ];
    }
    if (xLabels.length === 2) {
      return [
        { text: xLabels[0], x: 0, anchor: 'start' },
        { text: xLabels[1], x: W, anchor: 'end' },
      ];
    }
    return [];
  });
</script>

{#if plotted.length > 1}
  <svg class="tc" viewBox="-42 -10 654 {BOX_H}" role="img" aria-label={label}>
    {#each yTicks as tick, i (i)}
      <line
        class="grid"
        class:floor={tick.at === FLOOR}
        x1="0"
        y1={tick.at}
        x2={W}
        y2={tick.at}
      />
      <text class="tc-tick" x="-6" y={tick.at + 4} text-anchor="end">{yFormat(tick.value)}</text>
    {/each}

    {#if fill && area}
      <path class="tc-area" d={area} />
    {/if}

    {#if avgY != null}
      <line class="tc-avg" x1="0" y1={avgY} x2={W} y2={avgY} />
      {#if averageLabel}
        <text class="tc-avg-label" x={W} y={avgY - 4} text-anchor="end">{averageLabel}</text>
      {/if}
    {/if}

    <polyline class="tc-line" points={line} style="stroke: {colour}" />

    {#each xTicks as tick, i (i)}
      <text class="tc-tick" x={tick.x} y={AXIS_Y} text-anchor={tick.anchor}>{tick.text}</text>
    {/each}
  </svg>
{:else}
  <p class="tc-empty">Not enough of this series to draw.</p>
{/if}

<style>
  .tc {
    width: 100%;
    height: auto;
    display: block;
  }

  .grid {
    stroke: var(--line-hair);
    stroke-width: 1;
  }
  .grid.floor {
    stroke: var(--card-border);
  }

  .tc-line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .tc-area {
    fill: var(--accent-tint-14);
    stroke: none;
  }

  .tc-avg {
    stroke: rgba(26, 16, 8, 0.35);
    stroke-width: 1;
    stroke-dasharray: 4 4;
  }

  /* svg-user-units: viewBox -42 -10 654 158, rendered ~1250px wide, so a 9-unit
     label is ~17 screen px. */
  .tc-tick,
  .tc-avg-label {
    font-family: var(--font-mono);
    font-size: 9px; /* svg-user-units */
    letter-spacing: 0.6px;
    fill: var(--text-ghost);
  }
  .tc-avg-label {
    fill: var(--text-muted);
    text-transform: uppercase;
  }

  .tc-empty {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
</style>
