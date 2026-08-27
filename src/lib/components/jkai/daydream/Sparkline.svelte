<script lang="ts">
  /**
   * A small single-series line for the daydream dashboard — coverage over
   * days, spend over days. One hue (the site accent), a faint grid, the
   * newest point emphasised, and a crosshair + tooltip on hover because an
   * HTML chart IS interactive. Nulls break the line: a day we could not see
   * is a gap, never an interpolated guess — the same honesty rule as the
   * feature store it draws from.
   */
  type Point = { label: string; value: number | null };

  let {
    points,
    height = 64,
    max = null,
    format = (v: number) => String(Math.round(v * 100) / 100),
  }: {
    points: Point[];
    height?: number;
    max?: number | null;
    format?: (v: number) => string;
  } = $props();

  const W = 600;
  const PAD = 6;

  const values = $derived(points.map((p) => p.value).filter((v): v is number => v != null));
  const yMax = $derived((max ?? (values.length ? Math.max(...values) : 1)) || 1);
  const x = $derived((i: number) => (points.length <= 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (points.length - 1)));
  const y = $derived((v: number) => height - PAD - (Math.min(v, yMax) / yMax) * (height - PAD * 2));

  /** Contiguous non-null runs, so a gap in the data is a gap on screen. */
  const segments = $derived.by(() => {
    const segs: Array<Array<{ i: number; v: number }>> = [];
    let run: Array<{ i: number; v: number }> = [];
    points.forEach((p, i) => {
      if (p.value == null) {
        if (run.length) segs.push(run);
        run = [];
      } else {
        run.push({ i, v: p.value });
      }
    });
    if (run.length) segs.push(run);
    return segs;
  });

  const lastIdx = $derived.by(() => {
    for (let i = points.length - 1; i >= 0; i--) if (points[i].value != null) return i;
    return -1;
  });

  let hover = $state<number | null>(null);
  let wrap: HTMLDivElement | undefined = $state();

  function onMove(e: MouseEvent) {
    if (!wrap || points.length === 0) return;
    const rect = wrap.getBoundingClientRect();
    const fx = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    points.forEach((_, i) => {
      const d = Math.abs(x(i) - fx);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    hover = best;
  }

  const hoverPoint = $derived(hover != null ? points[hover] : null);
</script>

<div
  class="spark"
  bind:this={wrap}
  role="img"
  aria-label="chart"
  onmousemove={onMove}
  onmouseleave={() => (hover = null)}
>
  <svg viewBox="0 0 {W} {height}" preserveAspectRatio="none" style="height: {height}px">
    <!-- Recessive grid: quarter lines only. -->
    {#each [0.25, 0.5, 0.75] as g (g)}
      <line x1={PAD} x2={W - PAD} y1={y(yMax * g)} y2={y(yMax * g)} class="grid" />
    {/each}
    {#each segments as seg, si (si)}
      {#if seg.length > 1}
        <path
          class="area"
          d={`M ${x(seg[0].i)} ${height - PAD} ` + seg.map((p) => `L ${x(p.i)} ${y(p.v)}`).join(' ') + ` L ${x(seg[seg.length - 1].i)} ${height - PAD} Z`}
        />
        <path class="line" d={seg.map((p, j) => `${j === 0 ? 'M' : 'L'} ${x(p.i)} ${y(p.v)}`).join(' ')} />
      {:else}
        <circle class="dot" cx={x(seg[0].i)} cy={y(seg[0].v)} r="2.5" />
      {/if}
    {/each}
    {#if lastIdx >= 0 && points[lastIdx].value != null}
      <circle class="end" cx={x(lastIdx)} cy={y(points[lastIdx].value as number)} r="3.5" />
    {/if}
    {#if hover != null && hoverPoint?.value != null}
      <line class="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD} y2={height - PAD} />
      <circle class="hoverdot" cx={x(hover)} cy={y(hoverPoint.value)} r="4" />
    {/if}
  </svg>
  {#if hover != null && hoverPoint}
    <div class="tip" style="left: {(x(hover) / W) * 100}%">
      <span class="tip-label">{hoverPoint.label}</span>
      <span class="tip-value">{hoverPoint.value == null ? 'no data' : format(hoverPoint.value)}</span>
    </div>
  {/if}
</div>

<style>
  .spark { position: relative; width: 100%; }
  svg { display: block; width: 100%; overflow: visible; }
  .grid { stroke: var(--card-border); stroke-width: 1; opacity: 0.5; }
  .line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .area { fill: var(--accent); opacity: 0.1; }
  .dot, .end { fill: var(--accent); }
  .end { stroke: var(--bg-section); stroke-width: 2; }
  .crosshair { stroke: var(--text-muted); stroke-width: 1; stroke-dasharray: 3 3; }
  .hoverdot { fill: var(--accent); stroke: var(--bg-section); stroke-width: 2; }
  .tip {
    position: absolute; top: -6px; transform: translate(-50%, -100%);
    background: var(--text-primary); color: var(--bg);
    font-family: var(--font-mono, monospace); font-size: var(--fs-label-xs, 12px);
    padding: 3px 8px; border-radius: 2px; white-space: nowrap; pointer-events: none;
    display: flex; gap: 8px; z-index: 3;
  }
  .tip-label { opacity: 0.7; }
  .tip-value { font-variant-numeric: tabular-nums; }
</style>
