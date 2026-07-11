<script lang="ts">
  // Bespoke SVG chart (line | bar | area | scatter | slope | donut | sankey) on
  // $lib/presentation/chartkit — the house hand-rolled style (policy-engine),
  // no chart library. Series colors walk the editorial palette: petrol
  // accent-ink first, burnt orange second.
  import { donutSegments, extent, fmt, linScale, niceTicks, polyline, sankeyLayout } from '$lib/presentation/chartkit';
  import type { ChartBlock } from '$lib/presentation/types';

  let { block }: { block: ChartBlock } = $props();

  const W = 760;
  const H = 430;
  const PAD = { l: 58, r: 18, t: 16, b: 40 };

  const COLORS = ['var(--accent-ink)', 'var(--accent)', 'rgba(28,22,17,0.55)', '#7a5c2e', '#4a3b6b'];
  // Opaque siblings of COLORS for sankey ribbons (CSS vars can't take alpha).
  const RIBBONS = ['rgba(14,91,102,0.32)', 'rgba(196,87,10,0.30)', 'rgba(28,22,17,0.22)', 'rgba(122,92,46,0.30)', 'rgba(74,59,107,0.30)'];

  const series = $derived(block.series ?? []);
  const hasAxes = $derived(['line', 'bar', 'area', 'scatter'].includes(block.kind));

  const allX = $derived(series.flatMap((s) => s.points.map((p) => p.x)));
  const allY = $derived(series.flatMap((s) => s.points.map((p) => p.y)));
  const zeroBased = $derived(block.kind === 'bar' || block.kind === 'area');
  const xe = $derived(extent(allX, 0.02));
  const ye = $derived(extent(allY, 0.08, zeroBased));
  const sx = $derived(linScale([xe.lo, xe.hi], [PAD.l, W - PAD.r]));
  const sy = $derived(linScale([ye.lo, ye.hi], [H - PAD.b, PAD.t]));
  const xTicks = $derived(niceTicks(xe.lo, xe.hi, 5));
  const yTicks = $derived(niceTicks(ye.lo, ye.hi, 4));

  // Bar geometry: group per x value, one bar per series within the group.
  const xValues = $derived([...new Set(allX)].sort((a, b) => a - b));
  const groupW = $derived((W - PAD.l - PAD.r) / Math.max(1, xValues.length));
  const barW = $derived(Math.min(46, (groupW * 0.7) / Math.max(1, series.length)));

  function barX(x: number, si: number): number {
    const gi = xValues.indexOf(x);
    const center = PAD.l + groupW * (gi + 0.5);
    return center - (barW * series.length) / 2 + si * barW;
  }

  function areaPath(pts: { x: number; y: number }[]): string {
    const line = polyline(pts.map((p) => sx(p.x)), pts.map((p) => sy(p.y)));
    if (!line) return '';
    const base = sy(Math.max(ye.lo, 0)).toFixed(1);
    return `${line} L${sx(pts[pts.length - 1].x).toFixed(1)},${base} L${sx(pts[0].x).toFixed(1)},${base} Z`;
  }

  // Slope: first vs last point of each series, two labelled columns.
  const SLOPE_PAD = { l: 170, r: 170, t: 30, b: 34 };
  const slopeEnds = $derived(
    series.map((s) => ({ label: s.label, a: s.points[0], b: s.points[s.points.length - 1] })),
  );
  const slopeYe = $derived(extent(slopeEnds.flatMap((s) => [s.a?.y ?? 0, s.b?.y ?? 0]), 0.14));
  const slopeSy = $derived(linScale([slopeYe.lo, slopeYe.hi], [H - SLOPE_PAD.b, SLOPE_PAD.t]));

  // Donut geometry.
  const segments = $derived(block.segments ?? []);
  const donut = $derived(
    block.kind === 'donut' ? donutSegments(segments.map((s) => s.value), W / 2, H / 2 + 4, 150, 92) : [],
  );
  const donutTotal = $derived(segments.reduce((a, s) => a + s.value, 0));

  // Sankey geometry.
  const sankey = $derived(block.kind === 'sankey' ? sankeyLayout(block.flows ?? [], W, H, { l: 10, r: 10, t: 14, b: 14 }) : null);
  const sankeyDepthMax = $derived(sankey ? Math.max(...sankey.nodes.map((n) => n.depth), 0) : 0);
  const nodeColor = $derived(new Map((sankey?.nodes ?? []).map((n, i) => [n.id, i % COLORS.length])));
</script>

<figure class="chart">
  {#if block.title}<figcaption class="ch-title">{block.title}</figcaption>{/if}
  <svg viewBox="0 0 {W} {H}" role="img" aria-label={block.title ?? 'chart'}>
    {#if hasAxes}
      {#each yTicks as t}
        <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} class="grid" />
        <text x={PAD.l - 8} y={sy(t) + 3} class="tick" text-anchor="end">{fmt(t, 0)}</text>
      {/each}
    {/if}

    {#if block.kind === 'line' || block.kind === 'area'}
      {#each xTicks as t}
        <text x={sx(t)} y={H - PAD.b + 18} class="tick" text-anchor="middle">{fmt(t, 0)}</text>
      {/each}
      {#each series as s, si}
        {#if block.kind === 'area'}
          <path d={areaPath(s.points)} class="area-fill" style:fill={COLORS[si % COLORS.length]} style:animation-delay="{si * 180 + 350}ms" />
        {/if}
        <path
          d={polyline(s.points.map((p) => sx(p.x)), s.points.map((p) => sy(p.y)))}
          class="line draw"
          pathLength="1"
          style:stroke={COLORS[si % COLORS.length]}
          style:animation-delay="{si * 180}ms"
        />
        {#each s.points as p, pi}
          <circle
            cx={sx(p.x)}
            cy={sy(p.y)}
            r="3.2"
            class="dot-in"
            style:fill={COLORS[si % COLORS.length]}
            style:animation-delay="{si * 180 + (pi / Math.max(1, s.points.length - 1)) * 950}ms"
          />
        {/each}
      {/each}
    {:else if block.kind === 'bar'}
      {#each xValues as x, xi}
        <text x={PAD.l + groupW * (xi + 0.5)} y={H - PAD.b + 18} class="tick" text-anchor="middle">
          {block.xLabels?.[xi] ?? fmt(x, 0)}
        </text>
      {/each}
      {#each series as s, si}
        {#each s.points as p, pi}
          <rect
            x={barX(p.x, si)}
            y={Math.min(sy(p.y), sy(0))}
            width={barW - 3}
            height={Math.abs(sy(p.y) - sy(0))}
            class="bar-in"
            style:fill={COLORS[si % COLORS.length]}
            style:animation-delay="{pi * 90 + si * 60}ms"
            rx="1"
          />
        {/each}
      {/each}
    {:else if block.kind === 'scatter'}
      {#each xTicks as t}
        <text x={sx(t)} y={H - PAD.b + 18} class="tick" text-anchor="middle">{fmt(t, 0)}</text>
      {/each}
      {#each series as s, si}
        {#each s.points as p, pi}
          <circle
            cx={sx(p.x)}
            cy={sy(p.y)}
            r="6"
            class="scatter-pop"
            style:fill={COLORS[si % COLORS.length]}
            style:animation-delay="{si * 140 + pi * 45}ms"
          />
        {/each}
      {/each}
    {:else if block.kind === 'slope'}
      {#each [0, 1] as end}
        <line
          x1={end === 0 ? SLOPE_PAD.l : W - SLOPE_PAD.r}
          x2={end === 0 ? SLOPE_PAD.l : W - SLOPE_PAD.r}
          y1={SLOPE_PAD.t - 8}
          y2={H - SLOPE_PAD.b + 8}
          class="grid"
        />
        <text
          x={end === 0 ? SLOPE_PAD.l : W - SLOPE_PAD.r}
          y={H - SLOPE_PAD.b + 26}
          class="tick slope-end"
          text-anchor="middle">{block.xLabels?.[end] ?? (end === 0 ? 'before' : 'after')}</text
        >
      {/each}
      {#each slopeEnds as s, si}
        <path
          d={polyline([SLOPE_PAD.l, W - SLOPE_PAD.r], [slopeSy(s.a.y), slopeSy(s.b.y)])}
          class="line draw"
          pathLength="1"
          style:stroke={COLORS[si % COLORS.length]}
          style:animation-delay="{si * 150}ms"
        />
        {#each [{ x: SLOPE_PAD.l, y: s.a.y, anchor: 'end', dx: -12 }, { x: W - SLOPE_PAD.r, y: s.b.y, anchor: 'start', dx: 12 }] as pt, pi}
          <circle cx={pt.x} cy={slopeSy(pt.y)} r="4" class="dot-in" style:fill={COLORS[si % COLORS.length]} style:animation-delay="{si * 150 + pi * 620}ms" />
          <text
            x={pt.x + pt.dx}
            y={slopeSy(pt.y) + 4}
            class="slope-label"
            text-anchor={pt.anchor}
            style:fill={COLORS[si % COLORS.length]}
            style:animation-delay="{si * 150 + pi * 620}ms">{fmt(pt.y, 0)}{pi === 1 ? ` ${s.label}` : ''}</text
          >
        {/each}
      {/each}
    {:else if block.kind === 'donut'}
      {#each donut as seg, i}
        <path d={seg.path} class="donut-seg" style:fill={COLORS[i % COLORS.length]} style:animation-delay="{i * 110}ms" />
        {#if seg.frac >= 0.04}
          <text x={seg.lx} y={seg.ly + 3} class="tick" text-anchor={seg.lx > W / 2 ? 'start' : 'end'}>
            {Math.round(seg.frac * 100)}%
          </text>
        {/if}
      {/each}
      <text x={W / 2} y={H / 2 - 2} class="donut-total" text-anchor="middle">{fmt(donutTotal, 0)}</text>
      <text x={W / 2} y={H / 2 + 22} class="tick" text-anchor="middle">total</text>
    {:else if block.kind === 'sankey' && sankey}
      {#each sankey.links as link, i}
        <path d={link.path} class="sankey-link" style:fill={RIBBONS[(nodeColor.get(link.from) ?? 0) % RIBBONS.length]} style:animation-delay="{200 + i * 70}ms" />
      {/each}
      {#each sankey.nodes as node, i}
        <rect
          x={node.x0}
          y={node.y0}
          width={node.x1 - node.x0}
          height={Math.max(2, node.y1 - node.y0)}
          class="sankey-node"
          style:fill={COLORS[(nodeColor.get(node.id) ?? 0) % COLORS.length]}
          style:animation-delay="{i * 60}ms"
          rx="1"
        />
        <text
          x={node.depth < sankeyDepthMax ? node.x1 + 8 : node.x0 - 8}
          y={(node.y0 + node.y1) / 2 + 3.5}
          class="sankey-label"
          text-anchor={node.depth < sankeyDepthMax ? 'start' : 'end'}>{node.id}</text
        >
      {/each}
    {/if}

    {#if block.yLabel && hasAxes}<text x={12} y={PAD.t + 2} class="axis-label">{block.yLabel}</text>{/if}
    {#if block.xLabel && hasAxes}<text x={W - PAD.r} y={H - 8} class="axis-label" text-anchor="end">{block.xLabel}</text>{/if}
  </svg>
  {#if block.kind === 'donut' && segments.length}
    <div class="legend">
      {#each segments as s, si}
        <span class="leg-item">
          <span class="leg-swatch" style:background={COLORS[si % COLORS.length]}></span>{s.label}
        </span>
      {/each}
    </div>
  {:else if series.length > 1 && block.kind !== 'slope'}
    <div class="legend">
      {#each series as s, si}
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
  .slope-end { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
  .slope-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
  }
  .donut-total {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: 44px;
    fill: var(--ink);
  }
  .sankey-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    letter-spacing: 0.04em;
    fill: rgba(28, 22, 17, 0.72);
  }
  .axis-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    fill: rgba(28, 22, 17, 0.5);
  }
  .line { fill: none; stroke-width: 2.4; stroke-linejoin: round; stroke-linecap: round; }
  .area-fill { opacity: 0.14; }
  .sankey-link { opacity: 1; }
  /* entrance choreography: lines draw in, points/bars/segments/ribbons follow.
     CSS-driven so it replays whenever the keyed slide mounts; disabled under
     prefers-reduced-motion (matching the dur() contract elsewhere). */
  @media (prefers-reduced-motion: no-preference) {
    .line.draw {
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      animation: chart-draw 1100ms cubic-bezier(0.33, 1, 0.68, 1) both;
    }
    .dot-in,
    .slope-label {
      opacity: 0;
      animation: chart-fade 300ms ease-out both;
    }
    .area-fill {
      opacity: 0;
      animation: chart-area 700ms ease-out both;
    }
    .bar-in {
      transform-box: fill-box;
      transform-origin: bottom;
      transform: scaleY(0);
      animation: chart-bar 640ms cubic-bezier(0.33, 1, 0.68, 1) both;
    }
    .scatter-pop {
      transform-box: fill-box;
      transform-origin: center;
      transform: scale(0);
      animation: chart-pop 460ms cubic-bezier(0.33, 1, 0.68, 1) both;
    }
    .donut-seg {
      transform-box: fill-box;
      transform-origin: center;
      opacity: 0;
      transform: scale(0.86);
      animation: chart-seg 520ms cubic-bezier(0.33, 1, 0.68, 1) both;
    }
    .sankey-node {
      transform-box: fill-box;
      transform-origin: top;
      transform: scaleY(0);
      animation: chart-bar 560ms cubic-bezier(0.33, 1, 0.68, 1) both;
    }
    .sankey-link {
      opacity: 0;
      animation: chart-ribbon 640ms ease-out both;
    }
  }
  @keyframes chart-draw { to { stroke-dashoffset: 0; } }
  @keyframes chart-fade { to { opacity: 1; } }
  @keyframes chart-area { to { opacity: 0.14; } }
  @keyframes chart-bar { to { transform: scaleY(1); } }
  @keyframes chart-pop { to { transform: scale(1); } }
  @keyframes chart-seg { to { opacity: 1; transform: scale(1); } }
  @keyframes chart-ribbon { to { opacity: 1; } }
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
