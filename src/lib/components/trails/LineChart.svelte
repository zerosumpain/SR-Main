<script lang="ts">
  // One measure against distance or time. Deliberately single-series and
  // single-axis: an elevation profile and a heart-rate trace are two charts
  // stacked, never one plot with two y-scales.
  //
  // The viewBox is sized to the element's real pixel width so one SVG unit is
  // one CSS pixel. Two reasons: preserveAspectRatio="none" would stretch the
  // tick text horizontally, and a uniformly-scaled viewBox would shrink labels
  // below the 12px floor the site holds sitewide.
  import { onMount } from 'svelte';
  import { formatDistance, formatDuration } from '$lib/trails/format';

  let {
    points,
    label,
    unitSuffix = '',
    xKind = 'distance',
    fill = false,
    colour = 'var(--accent)',
    height = 160,
    zeroBaseline = false,
    formatValue = (v: number) => `${Math.round(v)}${unitSuffix}`,
  }: {
    /** [x, y] where x is metres (distance) or seconds (time). */
    points: [number, number][];
    label: string;
    unitSuffix?: string;
    xKind?: 'distance' | 'time';
    fill?: boolean;
    colour?: string;
    height?: number;
    zeroBaseline?: boolean;
    formatValue?: (v: number) => string;
  } = $props();

  const PAD = { top: 14, right: 12, bottom: 26, left: 48 };

  let width = $state(720);
  let frameEl: HTMLDivElement | undefined = $state();
  let svgEl: SVGSVGElement | undefined;
  // Observer handle is machinery, not reactive state — a $state handle read and
  // written by the same lifecycle function loops the effect that owns it.
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

  const xs = $derived(points.map((p) => p[0]));
  const ys = $derived(points.map((p) => p[1]));

  const xMin = $derived(xs.length ? Math.min(...xs) : 0);
  const xMax = $derived(xs.length ? Math.max(...xs) : 1);
  const rawMin = $derived(ys.length ? Math.min(...ys) : 0);
  const rawMax = $derived(ys.length ? Math.max(...ys) : 1);

  // Headroom so the line never touches the frame, and a floor that tells the
  // truth: an elevation profile zeroed to sea level flattens every hill, so
  // only charts that genuinely start at zero get a zero baseline.
  const yMin = $derived(zeroBaseline ? 0 : rawMin - (rawMax - rawMin || 1) * 0.12);
  const yMax = $derived(rawMax + (rawMax - rawMin || 1) * 0.12);

  const sx = $derived(
    (x: number) => PAD.left + ((x - xMin) / (xMax - xMin || 1)) * (width - PAD.left - PAD.right),
  );
  const sy = $derived(
    (y: number) =>
      height - PAD.bottom - ((y - yMin) / (yMax - yMin || 1)) * (height - PAD.top - PAD.bottom),
  );

  const path = $derived(
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`)
      .join(''),
  );

  const areaPath = $derived(
    points.length
      ? `${path}L${sx(xs[xs.length - 1]).toFixed(1)},${height - PAD.bottom}L${sx(xs[0]).toFixed(1)},${height - PAD.bottom}Z`
      : '',
  );

  // Four gridlines: enough to read a value against, few enough to stay recessive.
  const yTicks = $derived(Array.from({ length: 4 }, (_, i) => yMin + ((yMax - yMin) / 3) * i));
  // Fewer x labels on a narrow screen, so they never collide.
  const xTickCount = $derived(width < 420 ? 3 : 5);
  const xTicks = $derived(
    Array.from({ length: xTickCount }, (_, i) => xMin + ((xMax - xMin) / (xTickCount - 1)) * i),
  );

  function fmtX(v: number): string {
    return xKind === 'distance' ? formatDistance(v) : formatDuration(v);
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
      const d = Math.abs(points[i][0] - target);
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
        {formatValue(hovered[1])}
        <span class="readout-at">at {fmtX(hovered[0])}</span>
      </span>
    {/if}
  </figcaption>

  <div class="frame" bind:this={frameEl}>
    {#if points.length < 2}
      <div class="empty" style:height="{height}px">No data</div>
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
        {#each yTicks as t}
          <line class="grid" x1={PAD.left} x2={width - PAD.right} y1={sy(t)} y2={sy(t)} />
          <text class="tick" x={PAD.left - 8} y={sy(t) + 4} text-anchor="end">{Math.round(t)}</text>
        {/each}

        {#if fill}
          <path class="area" d={areaPath} style:fill={colour} />
        {/if}
        <path class="line" d={path} style:stroke={colour} />

        {#each xTicks as t, i}
          <text
            class="tick"
            x={sx(t)}
            y={height - 8}
            text-anchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
          >
            {fmtX(t)}
          </text>
        {/each}

        {#if hovered}
          <line
            class="crosshair"
            x1={sx(hovered[0])}
            x2={sx(hovered[0])}
            y1={PAD.top}
            y2={height - PAD.bottom}
          />
          <circle class="dot" cx={sx(hovered[0])} cy={sy(hovered[1])} r="4.5" style:fill={colour} />
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

  /* The readout wears text tokens, never the series colour — the mark carries
     identity, the number stays ink. */
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

  .area {
    opacity: 0.16;
    stroke: none;
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
