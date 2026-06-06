<script lang="ts">
  // OutcomeChart — a bespoke responsive SVG line chart with optional P10–P90
  // uncertainty bands, a "today" divider between history and projection, an
  // optional target line, and a hover readout. No external chart library
  // (mirrors data-convergence's bespoke-renderer approach). Self-contained.

  export interface ChartSeries {
    label: string;
    color: string;
    values: number[];        // one per year
    dashed?: boolean;        // render as a dashed line (used for "all pupils" vs "disadvantaged")
    band?: { p10: number[]; p90: number[] } | null; // optional uncertainty fan
    emphasis?: boolean;      // thicker stroke
  }

  interface Props {
    title: string;
    unit: string;
    years: number[];
    series: ChartSeries[];
    baseYear: number;         // vertical "today" divider
    horizonYear?: number | null; // moving marker at the selected horizon
    target?: { value: number; label: string } | null;
    dp?: number;
    zeroBased?: boolean;
    height?: number;
    goodIfUp?: boolean;
  }

  let {
    title, unit, years, series, baseYear, horizonYear = null,
    target = null, dp = 1, zeroBased = false, height = 230, goodIfUp = true,
  }: Props = $props();

  // --- layout ---
  const padL = 46, padR = 14, padT = 14, padB = 26;
  let w = $state(620);
  let host: HTMLDivElement;

  $effect(() => {
    if (!host) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) w = Math.max(280, e.contentRect.width);
    });
    ro.observe(host);
    return () => ro.disconnect();
  });

  const innerW = $derived(w - padL - padR);
  const innerH = $derived(height - padT - padB);

  // --- domains ---
  const xMin = $derived(years[0] ?? 0);
  const xMax = $derived(years[years.length - 1] ?? 1);

  const yExtent = $derived.by(() => {
    let lo = Infinity, hi = -Infinity;
    for (const s of series) {
      for (const v of s.values) { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
      if (s.band) {
        for (const v of s.band.p10) if (isFinite(v)) lo = Math.min(lo, v);
        for (const v of s.band.p90) if (isFinite(v)) hi = Math.max(hi, v);
      }
    }
    if (target) { lo = Math.min(lo, target.value); hi = Math.max(hi, target.value); }
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    if (zeroBased) lo = Math.min(lo, 0);
    if (lo === hi) { hi = lo + 1; }
    const pad = (hi - lo) * 0.08;
    return { lo: zeroBased ? lo : lo - pad, hi: hi + pad };
  });

  function xScale(year: number): number {
    if (xMax === xMin) return padL;
    return padL + ((year - xMin) / (xMax - xMin)) * innerW;
  }
  function yScale(v: number): number {
    const { lo, hi } = yExtent;
    return padT + (1 - (v - lo) / (hi - lo)) * innerH;
  }

  // nice y ticks
  const yTicks = $derived.by(() => {
    const { lo, hi } = yExtent;
    const span = hi - lo;
    const raw = span / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
    const ticks: number[] = [];
    const start = Math.ceil(lo / step) * step;
    for (let t = start; t <= hi + 1e-9; t += step) ticks.push(t);
    return ticks;
  });

  const xTicks = $derived.by(() => {
    const span = xMax - xMin;
    const stride = span > 18 ? 5 : span > 8 ? 2 : 1;
    const ticks: number[] = [];
    for (let y = xMin; y <= xMax; y += stride) ticks.push(y);
    if (ticks[ticks.length - 1] !== xMax) ticks.push(xMax);
    return ticks;
  });

  function linePath(values: number[]): string {
    let d = '';
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!isFinite(v)) continue;
      const cmd = d === '' ? 'M' : 'L';
      d += `${cmd}${xScale(years[i]).toFixed(1)},${yScale(v).toFixed(1)} `;
    }
    return d.trim();
  }

  function bandPath(p10: number[], p90: number[]): string {
    let top = '', bot = '';
    for (let i = 0; i < years.length; i++) {
      if (!isFinite(p90[i])) continue;
      top += `${top === '' ? 'M' : 'L'}${xScale(years[i]).toFixed(1)},${yScale(p90[i]).toFixed(1)} `;
    }
    for (let i = years.length - 1; i >= 0; i--) {
      if (!isFinite(p10[i])) continue;
      bot += `L${xScale(years[i]).toFixed(1)},${yScale(p10[i]).toFixed(1)} `;
    }
    return (top + bot + 'Z').trim();
  }

  function fmt(v: number): string {
    if (!isFinite(v)) return '—';
    return v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }

  // --- hover ---
  let hoverIdx = $state<number | null>(null);
  function onMove(e: PointerEvent) {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;
    const yr = xMin + ((px - padL) / innerW) * (xMax - xMin);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < years.length; i++) {
      const d = Math.abs(years[i] - yr);
      if (d < bestD) { bestD = d; best = i; }
    }
    hoverIdx = best;
  }
  function onLeave() { hoverIdx = null; }

  const baseX = $derived(xScale(baseYear));
</script>

<div class="chart" bind:this={host}>
  <div class="chart-head">
    <span class="chart-title">{title}</span>
    <span class="chart-unit">{unit}</span>
  </div>
  <svg viewBox="0 0 {w} {height}" width="100%" {height} role="img" aria-label={title}
       onpointermove={onMove} onpointerleave={onLeave} onpointerdown={onMove}>
    <!-- y grid + labels -->
    {#each yTicks as t}
      <line x1={padL} x2={w - padR} y1={yScale(t)} y2={yScale(t)} class="grid" />
      <text x={padL - 6} y={yScale(t) + 3} class="ylab" text-anchor="end">{fmt(t)}</text>
    {/each}

    <!-- history shading -->
    <rect x={padL} y={padT} width={Math.max(0, baseX - padL)} height={innerH} class="hist-shade" />
    <line x1={baseX} x2={baseX} y1={padT} y2={padT + innerH} class="today" />
    <text x={baseX} y={padT - 3} class="todaylab" text-anchor="middle">{baseYear}</text>

    <!-- moving horizon marker (driven by the year selector) -->
    {#if horizonYear && horizonYear > baseYear && horizonYear <= xMax}
      <line x1={xScale(horizonYear)} x2={xScale(horizonYear)} y1={padT} y2={padT + innerH} class="horizon" />
      <text x={xScale(horizonYear)} y={padT - 3} class="horizonlab" text-anchor="middle">{horizonYear} ▸</text>
    {/if}

    <!-- target -->
    {#if target}
      <line x1={padL} x2={w - padR} y1={yScale(target.value)} y2={yScale(target.value)} class="target" />
      <text x={w - padR} y={yScale(target.value) - 4} class="targetlab" text-anchor="end">{target.label}</text>
    {/if}

    <!-- bands -->
    {#each series as s}
      {#if s.band}
        <path d={bandPath(s.band.p10, s.band.p90)} fill={s.color} opacity="0.12" stroke="none" />
      {/if}
    {/each}

    <!-- x labels -->
    {#each xTicks as t}
      <text x={xScale(t)} y={height - 8} class="xlab" text-anchor="middle">{t}</text>
    {/each}

    <!-- lines -->
    {#each series as s}
      <path d={linePath(s.values)} fill="none" stroke={s.color}
            stroke-width={s.emphasis ? 2.4 : 1.7}
            stroke-dasharray={s.dashed ? '4 3' : 'none'}
            stroke-linejoin="round" stroke-linecap="round" />
    {/each}

    <!-- hover -->
    {#if hoverIdx !== null}
      <line x1={xScale(years[hoverIdx])} x2={xScale(years[hoverIdx])} y1={padT} y2={padT + innerH} class="hover-line" />
      {#each series as s}
        {#if isFinite(s.values[hoverIdx])}
          <circle cx={xScale(years[hoverIdx])} cy={yScale(s.values[hoverIdx])} r="3" fill={s.color} stroke="#fff" stroke-width="1" />
        {/if}
      {/each}
    {/if}
  </svg>

  {#if hoverIdx !== null}
    <div class="readout">
      <span class="ro-year">{years[hoverIdx]}</span>
      {#each series as s}
        <span class="ro-item">
          <i style="background:{s.color}"></i>{s.label}
          <b>{fmt(s.values[hoverIdx])}</b>
        </span>
      {/each}
    </div>
  {:else}
    <div class="legend">
      {#each series as s}
        <span class="lg-item"><i style="background:{s.color}" class:dash={s.dashed}></i>{s.label}</span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .chart {
    background: rgba(255,255,255,0.4);
    border: 1px solid rgba(28,22,17,0.12);
    border-radius: 8px;
    padding: 8px 10px 6px;
  }
  .chart-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 2px; }
  .chart-title {
    font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 13.5px;
    color: var(--ink, #1c1611); line-height: 1.2;
  }
  .chart-unit {
    font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 9.5px;
    letter-spacing: 0.06em; text-transform: uppercase; color: rgba(28,22,17,0.5); white-space: nowrap;
  }
  svg { display: block; touch-action: none; cursor: crosshair; }
  .grid { stroke: rgba(28,22,17,0.08); stroke-width: 1; }
  .hist-shade { fill: rgba(28,22,17,0.035); }
  .today { stroke: rgba(28,22,17,0.34); stroke-width: 1; stroke-dasharray: 3 2; }
  .horizon { stroke: #2f6f97; stroke-width: 1; stroke-dasharray: 2 2; opacity: 0.7; }
  .horizonlab { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; fill: #2f6f97; font-weight: 600; }
  .todaylab, .targetlab { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; fill: rgba(28,22,17,0.5); }
  .target { stroke: #2f7d4f; stroke-width: 1; stroke-dasharray: 5 3; opacity: 0.7; }
  .targetlab { fill: #2f7d4f; }
  .ylab, .xlab { font-family: 'JetBrains Mono', monospace; font-size: 9px; fill: rgba(28,22,17,0.55); }
  .hover-line { stroke: rgba(28,22,17,0.3); stroke-width: 1; }
  .legend, .readout {
    display: flex; flex-wrap: wrap; gap: 8px 12px; padding: 5px 2px 2px;
    font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28,22,17,0.7);
    min-height: 18px;
  }
  .lg-item, .ro-item { display: inline-flex; align-items: center; gap: 4px; }
  .lg-item i, .ro-item i { width: 10px; height: 3px; border-radius: 2px; display: inline-block; }
  .lg-item i.dash { background-image: none; opacity: 0.6; height: 2px; }
  .ro-year { font-weight: 600; color: var(--ink, #1c1611); }
  .ro-item b { color: var(--ink, #1c1611); }
</style>
