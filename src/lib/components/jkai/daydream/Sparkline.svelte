<script lang="ts">
  /**
   * A small single-series line for the daydream dashboard — coverage over
   * days, spend over days. One hue (the site accent), a faint grid, the
   * newest point emphasised, and a crosshair + tooltip on hover because an
   * HTML chart IS interactive. Nulls break the line: a day we could not see
   * is a gap, never an interpolated guess — the same honesty rule as the
   * feature store it draws from.
   *
   * `fit` scales the y axis to the series' own min–max instead of 0–max and
   * labels both ends, for a reading like room temperature whose movement is a
   * degree or two above a baseline nowhere near zero. A fitted chart drops the
   * area fill: shading down to a non-zero floor would overstate the change.
   */
  type Point = { label: string; value: number | null };

  let {
    points,
    height = 64,
    max = null,
    fit = false,
    format = (v: number) => String(Math.round(v * 100) / 100),
  }: {
    points: Point[];
    height?: number;
    max?: number | null;
    fit?: boolean;
    format?: (v: number) => string;
  } = $props();

  const W = 600;
  const PAD = 6;

  const values = $derived(points.map((p) => p.value).filter((v): v is number => v != null));
  const lo = $derived(values.length ? Math.min(...values) : 0);
  const hi = $derived(values.length ? Math.max(...values) : 1);
  const yMin = $derived(fit ? lo : 0);
  const yMax = $derived(fit ? hi : (max ?? hi) || 1);
  // A flat fitted series has no span; centre it rather than divide by zero.
  const span = $derived(yMax - yMin || 1);
  const x = $derived((i: number) => (points.length <= 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (points.length - 1)));
  const y = $derived((v: number) =>
    fit && yMax === yMin ? height / 2 : height - PAD - ((Math.min(v, yMax) - yMin) / span) * (height - PAD * 2),
  );

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

<div class="frame" class:fit>
{#if fit && values.length}
  <!-- Ends of the fitted scale; a 2·PAD line box centres each on the inset the line uses. -->
  <div class="axis" style="height: {height}px; --pad: {PAD * 2}px" aria-hidden="true">
    <span class="tick">{format(yMax)}</span>
    <span class="tick">{format(yMin)}</span>
  </div>
{/if}
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
      <line x1={PAD} x2={W - PAD} y1={y(yMin + span * g)} y2={y(yMin + span * g)} class="grid" />
    {/each}
    {#each segments as seg, si (si)}
      {#if seg.length > 1}
        {#if !fit}
        <path
          class="area"
          d={`M ${x(seg[0].i)} ${height - PAD} ` + seg.map((p) => `L ${x(p.i)} ${y(p.v)}`).join(' ') + ` L ${x(seg[seg.length - 1].i)} ${height - PAD} Z`}
        />
        {/if}
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
{#if fit && points.length > 1}
  <div class="span" aria-hidden="true"><span>{points[0].label}</span><span>{points[points.length - 1].label}</span></div>
{/if}
</div>

<style>
  .frame.fit { display: grid; grid-template-columns: auto 1fr; column-gap: 8px; }
  .axis { display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end; }
  .tick {
    line-height: var(--pad); white-space: nowrap;
    font-family: var(--font-mono, monospace); font-size: var(--fs-label-xs, 12px);
    color: var(--text-muted); font-variant-numeric: tabular-nums;
  }
  .span {
    grid-column: 2; display: flex; justify-content: space-between; gap: 12px; margin-top: 6px;
    font-family: var(--font-mono, monospace); font-size: var(--fs-label-xs, 12px); color: var(--text-muted);
  }
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
