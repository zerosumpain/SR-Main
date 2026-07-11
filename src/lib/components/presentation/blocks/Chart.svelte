<script lang="ts">
  // Bespoke SVG chart (line | bar) on $lib/presentation/chartkit — the house
  // hand-rolled style (policy-engine), no chart library. Series colors walk
  // the editorial palette: petrol accent-ink first, burnt orange second.
  import { extent, fmt, linScale, niceTicks, polyline } from '$lib/presentation/chartkit';
  import type { ChartBlock } from '$lib/presentation/types';

  let { block }: { block: ChartBlock } = $props();

  const W = 760;
  const H = 430;
  const PAD = { l: 58, r: 18, t: 16, b: 40 };

  const COLORS = ['var(--accent-ink)', 'var(--accent)', 'rgba(28,22,17,0.55)', '#7a5c2e', '#4a3b6b'];

  const allX = $derived(block.series.flatMap((s) => s.points.map((p) => p.x)));
  const allY = $derived(block.series.flatMap((s) => s.points.map((p) => p.y)));
  const xe = $derived(extent(allX, 0.02));
  const ye = $derived(extent(allY, 0.08, block.kind === 'bar'));
  const sx = $derived(linScale([xe.lo, xe.hi], [PAD.l, W - PAD.r]));
  const sy = $derived(linScale([ye.lo, ye.hi], [H - PAD.b, PAD.t]));
  const xTicks = $derived(niceTicks(xe.lo, xe.hi, 5));
  const yTicks = $derived(niceTicks(ye.lo, ye.hi, 4));

  // Bar geometry: group per x value, one bar per series within the group.
  const xValues = $derived([...new Set(allX)].sort((a, b) => a - b));
  const groupW = $derived((W - PAD.l - PAD.r) / Math.max(1, xValues.length));
  const barW = $derived(Math.min(46, (groupW * 0.7) / Math.max(1, block.series.length)));

  function barX(x: number, si: number): number {
    const gi = xValues.indexOf(x);
    const center = PAD.l + groupW * (gi + 0.5);
    return center - (barW * block.series.length) / 2 + si * barW;
  }
</script>

<figure class="chart">
  {#if block.title}<figcaption class="ch-title">{block.title}</figcaption>{/if}
  <svg viewBox="0 0 {W} {H}" role="img" aria-label={block.title ?? 'chart'}>
    {#each yTicks as t}
      <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} class="grid" />
      <text x={PAD.l - 8} y={sy(t) + 3} class="tick" text-anchor="end">{fmt(t, 0)}</text>
    {/each}
    {#if block.kind === 'line'}
      {#each xTicks as t}
        <text x={sx(t)} y={H - PAD.b + 18} class="tick" text-anchor="middle">{fmt(t, 0)}</text>
      {/each}
      {#each block.series as s, si}
        <path
          d={polyline(s.points.map((p) => sx(p.x)), s.points.map((p) => sy(p.y)))}
          class="line"
          style:stroke={COLORS[si % COLORS.length]}
        />
        {#each s.points as p}
          <circle cx={sx(p.x)} cy={sy(p.y)} r="3.2" style:fill={COLORS[si % COLORS.length]} />
        {/each}
      {/each}
    {:else}
      {#each xValues as x, xi}
        <text x={PAD.l + groupW * (xi + 0.5)} y={H - PAD.b + 18} class="tick" text-anchor="middle">
          {block.xLabels?.[xi] ?? fmt(x, 0)}
        </text>
      {/each}
      {#each block.series as s, si}
        {#each s.points as p}
          <rect
            x={barX(p.x, si)}
            y={Math.min(sy(p.y), sy(0))}
            width={barW - 3}
            height={Math.abs(sy(p.y) - sy(0))}
            style:fill={COLORS[si % COLORS.length]}
            rx="1"
          />
        {/each}
      {/each}
    {/if}
    {#if block.yLabel}<text x={12} y={PAD.t + 2} class="axis-label">{block.yLabel}</text>{/if}
    {#if block.xLabel}<text x={W - PAD.r} y={H - 8} class="axis-label" text-anchor="end">{block.xLabel}</text>{/if}
  </svg>
  {#if block.series.length > 1}
    <div class="legend">
      {#each block.series as s, si}
        <span class="leg-item">
          <span class="leg-swatch" style:background={COLORS[si % COLORS.length]}></span>{s.label}
        </span>
      {/each}
    </div>
  {/if}
</figure>

<style>
  .chart { margin: 0; width: 100%; max-width: 860px; }
  .ch-title {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: clamp(15px, 1.9vw, 20px);
    color: var(--ink);
    margin-bottom: 8px;
  }
  svg { width: 100%; height: auto; display: block; }
  .grid { stroke: rgba(28, 22, 17, 0.1); stroke-width: 1; }
  .tick {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    fill: rgba(28, 22, 17, 0.55);
  }
  .axis-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    fill: rgba(28, 22, 17, 0.5);
  }
  .line { fill: none; stroke-width: 2.4; stroke-linejoin: round; stroke-linecap: round; }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 8px; }
  .leg-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
  }
  .leg-swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
</style>
