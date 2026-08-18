<script lang="ts">
  // One daily measure against calendar time. Same discipline as LineChart:
  // single series, single axis (a rolling mean of the SAME measure may overlay
  // the raw readings — that is one measure at two smoothings, not two series).
  // viewBox is sized to real pixels for the same tick-text reasons.
  import { onMount } from 'svelte';

  interface DayPoint {
    date: string; // YYYY-MM-DD
    value: number;
  }

  let {
    points,
    rolling = null,
    baseline = null,
    baselineLabel = '28d',
    label,
    unitSuffix = '',
    colour = 'var(--accent)',
    height = 180,
    dp = 0,
    zeroBaseline = false,
  }: {
    /** Raw daily readings — dots when a rolling overlay exists, a line otherwise. */
    points: DayPoint[];
    /** Optional rolling mean of the same measure, drawn as the main line. */
    rolling?: DayPoint[] | null;
    /** Optional reference level (e.g. 28-day mean), drawn dashed. */
    baseline?: number | null;
    baselineLabel?: string;
    label: string;
    unitSuffix?: string;
    colour?: string;
    height?: number;
    dp?: number;
    zeroBaseline?: boolean;
  } = $props();

  const PAD = { top: 14, right: 12, bottom: 26, left: 48 };

  let width = $state(720);
  let frameEl: HTMLDivElement | undefined = $state();
  let svgEl: SVGSVGElement | undefined;
  // Observer handle is machinery, not reactive state.
  let observer: ResizeObserver | null = null;

  onMount(() => {
    if (!frameEl) return;
    observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) width = w;
    });
    observer.observe(frameEl);
    return () => {
      observer?.disconnect();
      observer = null;
    };
  });

  const day = (d: string) => Math.floor(Date.parse(d + 'T00:00:00Z') / 86400000);

  const allPoints = $derived([...points, ...(rolling ?? [])]);
  const xMin = $derived(allPoints.length ? Math.min(...allPoints.map((p) => day(p.date))) : 0);
  const xMax = $derived(allPoints.length ? Math.max(...allPoints.map((p) => day(p.date))) : 1);

  const values = $derived([
    ...allPoints.map((p) => p.value),
    ...(baseline != null ? [baseline] : []),
  ]);
  const rawMin = $derived(values.length ? Math.min(...values) : 0);
  const rawMax = $derived(values.length ? Math.max(...values) : 1);
  const yMin = $derived(zeroBaseline ? 0 : rawMin - (rawMax - rawMin || 1) * 0.12);
  const yMax = $derived(rawMax + (rawMax - rawMin || 1) * 0.12);

  const sx = $derived(
    (x: number) => PAD.left + ((x - xMin) / (xMax - xMin || 1)) * (width - PAD.left - PAD.right),
  );
  const sy = $derived(
    (y: number) =>
      height - PAD.bottom - ((y - yMin) / (yMax - yMin || 1)) * (height - PAD.top - PAD.bottom),
  );

  function linePath(series: DayPoint[]): string {
    return series
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(day(p.date)).toFixed(1)},${sy(p.value).toFixed(1)}`)
      .join('');
  }

  const rawPath = $derived(rolling ? '' : linePath(points));
  const rollingPath = $derived(rolling ? linePath(rolling) : '');

  const yTicks = $derived(Array.from({ length: 4 }, (_, i) => yMin + ((yMax - yMin) / 3) * i));
  // Never more ticks than there are distinct days — a 3-day domain at 5 ticks
  // prints the same date twice.
  const xTickCount = $derived(Math.max(2, Math.min(width < 420 ? 3 : 5, xMax - xMin + 1)));
  const xTicks = $derived(
    Array.from({ length: xTickCount }, (_, i) => xMin + ((xMax - xMin) / (xTickCount - 1)) * i),
  );

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDay(d: number): string {
    const dt = new Date(d * 86400000);
    return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
  }
  function fmtValue(v: number): string {
    return `${v.toFixed(dp)}${unitSuffix}`;
  }

  let hoverIndex = $state<number | null>(null);

  function onMove(e: PointerEvent) {
    if (!svgEl || !points.length) return;
    const rect = svgEl.getBoundingClientRect();
    const xPixel = e.clientX - rect.left;
    const target = xMin + ((xPixel - PAD.left) / (width - PAD.left - PAD.right)) * (xMax - xMin);
    let best = 0;
    let bestDelta = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(day(points[i].date) - target);
      if (d < bestDelta) {
        bestDelta = d;
        best = i;
      }
    }
    hoverIndex = best;
  }

  const hovered = $derived(hoverIndex == null ? null : points[hoverIndex]);
</script>

<figure class="chart">
  <figcaption class="chart-hd">
    <span class="sr-label-tight">{label}</span>
    {#if hovered}
      <span class="readout">
        {fmtValue(hovered.value)}
        <span class="readout-at">on {fmtDay(day(hovered.date))}</span>
      </span>
    {/if}
  </figcaption>

  <div class="frame" bind:this={frameEl}>
    {#if points.length < 2}
      <div class="empty" style:height="{height}px">Not enough data yet</div>
    {:else}
      <svg
        bind:this={svgEl}
        width={width}
        height={height}
        viewBox="0 0 {width} {height}"
        role="img"
        aria-label={label}
        onpointermove={onMove}
        onpointerleave={() => (hoverIndex = null)}
      >
        {#each yTicks as t, ti (ti)}
          <line class="grid" x1={PAD.left} x2={width - PAD.right} y1={sy(t)} y2={sy(t)} />
          <text class="tick" x={PAD.left - 8} y={sy(t) + 4} text-anchor="end">{t.toFixed(dp)}</text>
        {/each}

        {#if baseline != null}
          <line
            class="baseline"
            x1={PAD.left}
            x2={width - PAD.right}
            y1={sy(baseline)}
            y2={sy(baseline)}
          />
          <text class="tick baseline-tag" x={width - PAD.right - 4} y={sy(baseline) - 5} text-anchor="end">
            {baselineLabel} {fmtValue(baseline)}
          </text>
        {/if}

        {#if rolling}
          {#each points as p, pi (pi)}
            <circle class="raw-dot" cx={sx(day(p.date))} cy={sy(p.value)} r="2.5" />
          {/each}
          <path class="line" d={rollingPath} style:stroke={colour} />
        {:else}
          <path class="line" d={rawPath} style:stroke={colour} />
          {#each points as p, pi (pi)}
            <circle class="mark-dot" cx={sx(day(p.date))} cy={sy(p.value)} r="3" style:fill={colour} />
          {/each}
        {/if}

        {#each xTicks as t, i (i)}
          <text
            class="tick"
            x={sx(t)}
            y={height - 8}
            text-anchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
          >
            {fmtDay(t)}
          </text>
        {/each}

        {#if hovered}
          <line
            class="crosshair"
            x1={sx(day(hovered.date))}
            x2={sx(day(hovered.date))}
            y1={PAD.top}
            y2={height - PAD.bottom}
          />
          <circle
            class="dot"
            cx={sx(day(hovered.date))}
            cy={sy(hovered.value)}
            r="4.5"
            style:fill={colour}
          />
        {/if}
      </svg>
    {/if}
  </div>
</figure>

<style>
  .chart {
    margin: 0 0 1.25rem;
  }

  .chart-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.4rem;
  }

  /* Readouts wear text tokens, never the series colour. */
  .readout {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }

  .readout-at {
    color: var(--text-muted);
  }

  .frame {
    width: 100%;
  }

  svg {
    display: block;
    border: 1px solid var(--line-hair);
    background: var(--surface-sunken);
    touch-action: pan-y;
  }

  .grid {
    stroke: var(--line-hair);
    stroke-width: 1;
  }

  .tick {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    fill: var(--text-ghost);
  }

  .line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .raw-dot {
    fill: var(--text-ghost);
    opacity: 0.55;
  }

  .mark-dot {
    stroke: var(--bg);
    stroke-width: 1.5;
  }

  .baseline {
    stroke: var(--text-secondary);
    stroke-width: 1;
    stroke-dasharray: 5 4;
    opacity: 0.7;
  }

  .baseline-tag {
    fill: var(--text-muted);
  }

  .crosshair {
    stroke: var(--text-primary);
    stroke-width: 1;
    opacity: 0.4;
  }

  .dot {
    stroke: var(--bg);
    stroke-width: 2;
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--line-hair);
    background: var(--surface-sunken);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
</style>
