<script lang="ts">
  import { untrack } from 'svelte';
  import { Chart, Svg, Spline, Area, Highlight, Axis, Grid, Points } from 'layerchart';
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { formatGbp, formatTokens } from './costFormat';
  import { formatDurationMs, formatPercent } from './format';

  const fmtTime = (d: unknown) => {
    const dt = d instanceof Date ? d : new Date(d as string);
    return dt.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  };

  type Metric = 'duration' | 'cost' | 'runs' | 'cache';
  type Range = '1h' | '6h' | '24h' | '7d' | '30d' | 'all';

  interface Props {
    slug: string;
    nodeId: string;
    defaultRange: Range;
    refreshKey?: number;
  }
  let { slug, nodeId, defaultRange, refreshKey = 0 }: Props = $props();

  const DRILL_RANGES: Range[] = ['1h', '6h', '24h', '7d', '30d', 'all'];
  // untrack: we intentionally snapshot `defaultRange` once to seed local state —
  // the user drives `range` from the select after initial mount.
  const initialRange: Range = untrack(() => DRILL_RANGES.includes(defaultRange) ? defaultRange : '24h');

  let metric = $state<Metric>('duration');
  let range = $state<Range>(initialRange);

  interface SeriesPoint {
    t: string;
    p50?: number | null;
    p95?: number | null;
    avg?: number | null;
    max?: number | null;
    value?: number | null;
  }

  let series = $state<SeriesPoint[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const url = `/api/canvas/${encodeURIComponent(slug)}/stats/per-node/${encodeURIComponent(nodeId)}/series?metric=${metric}&period=${range}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: { rows: SeriesPoint[] } };
      series = body.data.rows;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    metric; range; refreshKey;
    load();
  });

  const summary = $derived.by(() => {
    if (metric === 'duration') {
      const avgs = series.map((s) => s.avg).filter((v): v is number => v != null);
      const max = avgs.length ? Math.max(...avgs) : null;
      const median = avgs.length ? avgs.slice().sort((a, b) => a - b)[Math.floor(avgs.length / 2)] : null;
      const p95s = series.map((s) => s.p95).filter((v): v is number => v != null);
      const p95 = p95s.length ? Math.max(...p95s) : null;
      const avg = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
      return { avg, median, max, p95 };
    }
    const vals = series.map((s) => s.value).filter((v): v is number => v != null);
    const sum = vals.reduce((a, b) => a + b, 0);
    const avg = vals.length ? sum / vals.length : null;
    const max = vals.length ? Math.max(...vals) : null;
    return { sum, avg, max };
  });
</script>

<div class="drill">
  <header>
    <div class="tabs" role="tablist">
      {#each ['duration', 'cost', 'runs', 'cache'] as m (m)}
        <button
          role="tab"
          class:active={metric === m}
          onclick={() => (metric = m as Metric)}
        >{m}</button>
      {/each}
    </div>
    <select bind:value={range} class="range">
      <option value="1h">1h</option>
      <option value="6h">6h</option>
      <option value="24h">24h</option>
      <option value="7d">7d</option>
      <option value="30d">30d</option>
      <option value="all">all</option>
    </select>
  </header>

  {#if loading && series.length === 0}
    <div class="skel">Loading…</div>
  {:else if error}
    <div class="error-strip">{error}</div>
  {:else if series.length === 0}
    <div class="empty">No data in this window</div>
  {:else}
    <div class="chart">
      {#if metric === 'duration'}
        <Chart
          data={series.map((s) => ({ t: new Date(s.t), p50: s.p50 ?? 0, p95: s.p95 ?? 0, avg: s.avg ?? 0 }))}
          x="t"
          xScale={scaleTime()}
          yScale={scaleLinear()}
          padding={{ top: 8, bottom: 20, left: 40, right: 8 }}
        >
          <Svg>
            <defs>
              <linearGradient id="drill-dur-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.34" />
                <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
              </linearGradient>
            </defs>
            <Grid y yTicks={4} />
            <Axis placement="left" rule ticks={4} format={(v) => formatDurationMs(v as number)} />
            <Axis placement="bottom" rule ticks={4} format={fmtTime} />
            <Area y="p95" fill="url(#drill-dur-grad)" />
            <Spline y="p50" stroke="var(--accent)" strokeWidth={1.2} />
            <Points y="p50" r={2} fill="var(--accent)" />
            <Spline y="avg" stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="2 3" />
            <Highlight points lines />
          </Svg>
        </Chart>
      {:else}
        <Chart
          data={series.map((s) => ({ t: new Date(s.t), v: s.value ?? 0 }))}
          x="t"
          y="v"
          xScale={scaleTime()}
          yScale={scaleLinear()}
          padding={{ top: 8, bottom: 20, left: 40, right: 8 }}
        >
          <Svg>
            <defs>
              <linearGradient id="drill-val-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.34" />
                <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
              </linearGradient>
            </defs>
            <Grid y yTicks={4} />
            <Axis placement="left" rule ticks={4} format={(v) => metric === 'cost' ? formatGbp(Number(v)) : metric === 'cache' ? Math.round(Number(v) * 100) + '%' : String(v)} />
            <Axis placement="bottom" rule ticks={4} format={fmtTime} />
            <Area fill="url(#drill-val-grad)" />
            <Spline stroke="var(--accent)" strokeWidth={1.5} />
            <Points r={2} fill="var(--accent)" />
            <Highlight points lines />
          </Svg>
        </Chart>
      {/if}
    </div>

    <div class="summary">
      {#if metric === 'duration'}
        <span class="kv"><span class="k">avg</span><span class="v">{formatDurationMs((summary as { avg: number | null }).avg)}</span></span>
        <span class="kv"><span class="k">median</span><span class="v">{formatDurationMs((summary as { median: number | null }).median)}</span></span>
        <span class="kv"><span class="k">p95</span><span class="v">{formatDurationMs((summary as { p95: number | null }).p95)}</span></span>
        <span class="kv"><span class="k">max</span><span class="v">{formatDurationMs((summary as { max: number | null }).max)}</span></span>
      {:else if metric === 'cost'}
        <span class="kv"><span class="k">sum</span><span class="v">{formatGbp((summary as { sum: number }).sum)}</span></span>
        <span class="kv"><span class="k">avg/bucket</span><span class="v">{formatGbp((summary as { avg: number | null }).avg)}</span></span>
        <span class="kv"><span class="k">max/bucket</span><span class="v">{formatGbp((summary as { max: number | null }).max)}</span></span>
      {:else if metric === 'runs'}
        <span class="kv"><span class="k">total</span><span class="v">{(summary as { sum: number }).sum}</span></span>
        <span class="kv"><span class="k">avg/bucket</span><span class="v">{(summary as { avg: number | null }).avg?.toFixed(1) ?? '—'}</span></span>
        <span class="kv"><span class="k">max/bucket</span><span class="v">{(summary as { max: number | null }).max ?? '—'}</span></span>
      {:else}
        <span class="kv"><span class="k">avg hit rate</span><span class="v">{formatPercent((summary as { avg: number | null }).avg ?? 0)}</span></span>
        <span class="kv"><span class="k">peak</span><span class="v">{formatPercent((summary as { max: number | null }).max ?? 0)}</span></span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .drill {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font: 10px / 1.4 ui-monospace, Menlo, monospace;
    color: var(--text-primary);
    padding: 6px 0;
  }
  header { display: flex; justify-content: space-between; align-items: center; }
  .tabs { display: flex; gap: 2px; }
  .tabs button {
    background: transparent;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    padding: 2px 8px;
    border-radius: 3px;
    font: inherit;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .tabs button.active {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .range {
    background: transparent;
    border: 1px solid var(--card-border);
    color: var(--text-primary);
    padding: 1px 4px;
    font: inherit;
  }
  .chart { height: 180px; }
  .chart :global(.tickLabel) { fill: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .chart :global(.tick) { stroke: var(--divider); }
  .chart :global(.rule line) { stroke: var(--divider); }
  .chart :global(.Grid line) { stroke: var(--divider); opacity: 0.5; }
  .summary { display: flex; gap: 12px; flex-wrap: wrap; }
  .kv { display: flex; gap: 4px; align-items: baseline; }
  .kv .k { color: var(--text-muted); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.5px; }
  .kv .v { font-weight: 600; }
  .empty, .skel { color: var(--text-muted); font-style: italic; padding: 12px; text-align: center; }
  .error-strip { color: var(--status-error); font-size: var(--fs-label-xs); padding: 4px; border: 1px solid var(--status-error); border-radius: 4px; }
</style>
