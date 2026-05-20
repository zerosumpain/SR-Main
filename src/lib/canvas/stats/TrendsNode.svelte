<script lang="ts">
  import { Chart, Svg, Area, Spline, Highlight, Tooltip, Axis, Grid, Points } from 'layerchart';
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { curveMonotoneX } from 'd3-shape';
  import { useStats } from './useStats.svelte';
  import { formatDurationMs, formatPercent, formatRelative } from './format';

  interface RecentRun {
    id: string;
    status: string;
    healing: boolean;
    startedAt: string;
    durationMs: number | null;
  }

  interface TrendsData {
    buckets: Array<{
      t: string;
      runs: { success: number; failed: number; healing: number };
      durationMs: { p50: number | null; p95: number | null; avg: number | null };
    }>;
    recentRuns: RecentRun[];
    costByModel: Array<{ t: string; model: string; costUsd: number }>;
    priorRunsByBucket: Array<{ t: string; count: number }>;
  }

  interface Props {
    slug: string;
    period: string;
    refreshKey?: number;
  }
  let { slug, period, refreshKey = 0 }: Props = $props();

  const stats = useStats<TrendsData>(
    () => slug,
    'trends',
    () => period,
    () => refreshKey,
  );

  /** Window-wide aggregates, computed from buckets. */
  const kpis = $derived.by(() => {
    let runs = 0,
      success = 0,
      failed = 0,
      healing = 0,
      avgWeightedSum = 0,
      avgWeightedCount = 0,
      minMs: number | null = null,
      maxMs: number | null = null;
    for (const b of stats.data?.buckets ?? []) {
      const total = b.runs.success + b.runs.failed + b.runs.healing;
      runs += total;
      success += b.runs.success;
      failed += b.runs.failed;
      healing += b.runs.healing;
      if (b.durationMs.avg !== null) {
        avgWeightedSum += b.durationMs.avg * total;
        avgWeightedCount += total;
        if (minMs === null || b.durationMs.avg < minMs) minMs = b.durationMs.avg;
        if (maxMs === null || b.durationMs.avg > maxMs) maxMs = b.durationMs.avg;
      }
    }
    const avg = avgWeightedCount > 0 ? avgWeightedSum / avgWeightedCount : null;
    return { runs, success, failed, healing, avg, minMs, maxMs };
  });

  // Sparkline series: average duration per bucket, oldest → newest. We
  // only render this when there are enough non-null points to look like
  // a meaningful curve rather than a stray dot.
  const durationSparkline = $derived(
    (stats.data?.buckets ?? [])
      .filter((b) => b.durationMs.avg !== null)
      .map((b) => ({ t: new Date(b.t), v: b.durationMs.avg as number })),
  );

  // Run-volume sparkline: total runs per bucket, oldest → newest.
  const volumeSparkline = $derived(
    (stats.data?.buckets ?? []).map((b) => ({
      t: new Date(b.t),
      v: b.runs.success + b.runs.failed + b.runs.healing,
    })),
  );

  // Success and failed reference splines for volume chart.
  const successSparkline = $derived(
    (stats.data?.buckets ?? []).map((b) => ({
      t: new Date(b.t),
      v: b.runs.success,
    })),
  );

  const failedSparkline = $derived(
    (stats.data?.buckets ?? []).map((b) => ({
      t: new Date(b.t),
      v: b.runs.failed,
    })),
  );

  const recentRuns = $derived(stats.data?.recentRuns ?? []);
  // Render the timeline oldest → newest so the most recent run is on the
  // right (matches the way users read time-series charts).
  const timelineRuns = $derived([...recentRuns].reverse());

  // Duration-proportional bar heights for recent runs timeline.
  const maxDurationMs = $derived(
    Math.max(0, ...timelineRuns.map((r) => r.durationMs ?? 0)),
  );

  function tickBarHeight(durationMs: number | null): number {
    if (maxDurationMs === 0 || durationMs === null) return 4;
    return 4 + (durationMs / maxDurationMs) * 18;
  }

  const showVolumeChart = $derived(
    volumeSparkline.filter((p) => p.v > 0).length >= 4,
  );
  const showDurationChart = $derived(durationSparkline.length >= 4);

  // ——— Cost-by-model track ———
  const costByModelGrouped = $derived.by(() => {
    const map = new Map<string, Map<number, number>>(); // model -> bucketMs -> costUsd
    for (const row of stats.data?.costByModel ?? []) {
      const bucketMs = new Date(row.t).getTime();
      let mm = map.get(row.model);
      if (!mm) {
        mm = new Map();
        map.set(row.model, mm);
      }
      mm.set(bucketMs, (mm.get(bucketMs) ?? 0) + row.costUsd);
    }
    const models = [...map.keys()].sort();
    return { map, models };
  });

  const showCostChart = $derived((stats.data?.costByModel?.length ?? 0) > 0);

  // ——— Prior-period overlay for run-volume chart ———
  const priorOverlay = $derived(
    (stats.data?.priorRunsByBucket ?? []).map((p) => ({
      t: new Date(p.t),
      v: p.count,
    })),
  );

  function colorForModel(model: string): string {
    // Deterministic colour from model name — same model always gets the
    // same hue across renders, while distinct models stay visually separated.
    let hash = 0;
    for (let i = 0; i < model.length; i++) hash = (hash * 31 + model.charCodeAt(i)) | 0;
    const hue = ((hash % 360) + 360) % 360;
    return `hsl(${hue}, 65%, 55%)`;
  }

  // Shared bottom-axis time formatter.
  function fmtDate(d: any): string {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  }
</script>

<div class="stats-node stats-trends">
  <header class="hd">
    <span class="title">Trends</span>
    {#if stats.window?.granularity}
      <span class="gran">{stats.window.granularity}-buckets</span>
    {/if}
    <button class="refresh" onclick={() => stats.refresh()} aria-label="Refresh">⟳</button>
  </header>

  {#if stats.error}
    <div class="error-strip">{stats.error}</div>
  {:else if stats.loading && !stats.data}
    <div class="skel">Loading…</div>
  {:else if stats.data}
    <!-- ——— KPI strip ——— -->
    <div class="kpis">
      <div class="kpi">
        <span class="kpi-l">Runs</span>
        <span class="kpi-v">{kpis.runs}</span>
      </div>
      <div class="kpi">
        <span class="kpi-l">Success</span>
        <span class="kpi-v ok">{kpis.success}</span>
      </div>
      <div class="kpi">
        <span class="kpi-l">Failed</span>
        <span class="kpi-v fail">{kpis.failed}</span>
      </div>
      <div class="kpi">
        <span class="kpi-l">Rate</span>
        <span class="kpi-v">
          {kpis.runs ? formatPercent(kpis.success / kpis.runs) : '—'}
        </span>
      </div>
      <div class="kpi">
        <span class="kpi-l">Avg time</span>
        <span class="kpi-v">{formatDurationMs(kpis.avg)}</span>
      </div>
    </div>

    <!-- ——— Run timeline (always renders something useful) ——— -->
    <section class="block">
      <h4>Recent runs</h4>
      {#if timelineRuns.length === 0}
        <div class="empty-msg">No runs in this window</div>
      {:else}
        <div class="timeline" role="list">
          {#each timelineRuns as r (r.id)}
            <div
              role="listitem"
              class="tick s-{r.status}"
              class:healing={r.healing}
              style:height="{tickBarHeight(r.durationMs)}px"
              title={`${r.status}${r.healing ? ' · healed' : ''}\n${formatDurationMs(r.durationMs)} · ${formatRelative(new Date(r.startedAt))}`}
            ></div>
          {/each}
        </div>
        <div class="legend">
          <span class="swatch s-completed"></span><span>success</span>
          <span class="swatch s-failed"></span><span>failed</span>
          <span class="swatch s-running"></span><span>running</span>
          <span class="swatch healing"></span><span>healed</span>
        </div>
      {/if}
    </section>

    <!-- ——— Run volume sparkline (only when we have enough buckets) ——— -->
    {#if showVolumeChart}
      <section class="block">
        <h4>Run volume</h4>
        <div class="chart-host">
          <Chart
            data={volumeSparkline}
            x="t"
            xScale={scaleTime()}
            y="v"
            yScale={scaleLinear()}
            yNice
            padding={{ top: 8, bottom: 20, left: 40, right: 8 }}
          >
            <Svg>
              <defs>
                <linearGradient id="trends-vol-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.34" />
                  <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <Grid y yTicks={4} />
              <Axis placement="left" rule ticks={4} format={(v) => String(v)} />
              <Axis placement="bottom" rule ticks={4} format={fmtDate} />
              <Area fill="url(#trends-vol-grad)" curve={curveMonotoneX} />
              <Spline stroke="var(--accent)" strokeWidth={1.5} curve={curveMonotoneX} />
              <!-- Success / failed reference lines -->
              <Spline
                data={successSparkline}
                x="t"
                y="v"
                stroke="var(--status-success)"
                strokeWidth={1}
                opacity={0.7}
                curve={curveMonotoneX}
              />
              <Spline
                data={failedSparkline}
                x="t"
                y="v"
                stroke="var(--status-error)"
                strokeWidth={1}
                opacity={0.7}
                curve={curveMonotoneX}
              />
              {#if priorOverlay.length > 0}
                <Spline
                  data={priorOverlay}
                  x="t"
                  y="v"
                  stroke="var(--text-muted, #888)"
                  strokeWidth={1}
                  strokeDasharray="2 3"
                  opacity={0.6}
                  curve={curveMonotoneX}
                />
              {/if}
              <Points r={2} fill="var(--accent)" />
              <Highlight points lines />
            </Svg>
            <Tooltip.Context mode="bisect-x">
              <Tooltip.Root let:data variant="none">
                <div class="tt">
                  <div class="tt-t">{new Date(data.t).toLocaleString()}</div>
                  <div class="tt-v">{data.v} run{data.v === 1 ? '' : 's'}</div>
                </div>
              </Tooltip.Root>
            </Tooltip.Context>
          </Chart>
        </div>
      </section>
    {/if}

    <!-- ——— Duration sparkline OR fallback KPIs ——— -->
    <section class="block">
      <h4>Duration</h4>
      {#if showDurationChart}
        <div class="chart-host">
          <Chart
            data={durationSparkline}
            x="t"
            xScale={scaleTime()}
            y="v"
            yScale={scaleLinear()}
            yNice
            padding={{ top: 8, bottom: 20, left: 40, right: 8 }}
          >
            <Svg>
              <defs>
                <linearGradient id="trends-dur-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.34" />
                  <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <Grid y yTicks={4} />
              <Axis placement="left" rule ticks={4} format={(v) => formatDurationMs(v)} />
              <Axis placement="bottom" rule ticks={4} format={fmtDate} />
              <Area fill="url(#trends-dur-grad)" curve={curveMonotoneX} />
              <Spline stroke="var(--accent)" strokeWidth={1.5} curve={curveMonotoneX} />
              <Points r={2} fill="var(--accent)" />
              <Highlight points lines />
            </Svg>
            <Tooltip.Context mode="bisect-x">
              <Tooltip.Root let:data variant="none">
                <div class="tt">
                  <div class="tt-t">{new Date(data.t).toLocaleString()}</div>
                  <div class="tt-v">{formatDurationMs(data.v)}</div>
                </div>
              </Tooltip.Root>
            </Tooltip.Context>
          </Chart>
        </div>
      {:else if kpis.avg !== null}
        <div class="dur-kpis">
          <div class="dur-kpi">
            <span class="kpi-l">Min</span>
            <span class="kpi-v">{formatDurationMs(kpis.minMs)}</span>
          </div>
          <div class="dur-kpi">
            <span class="kpi-l">Avg</span>
            <span class="kpi-v">{formatDurationMs(kpis.avg)}</span>
          </div>
          <div class="dur-kpi">
            <span class="kpi-l">Max</span>
            <span class="kpi-v">{formatDurationMs(kpis.maxMs)}</span>
          </div>
        </div>
      {:else}
        <div class="empty-msg">No duration data</div>
      {/if}
    </section>

    <!-- ——— Cost by model track (only when data present) ——— -->
    {#if showCostChart}
      <section class="block">
        <h4>Cost · by model</h4>
        <div class="chart-host">
          <Chart
            data={costByModelGrouped.models.flatMap((model) =>
              Array.from(costByModelGrouped.map.get(model)?.entries() ?? []).map(([t, v]) => ({
                t: new Date(t),
                v,
                model,
              })),
            )}
            x="t"
            xScale={scaleTime()}
            y="v"
            yScale={scaleLinear()}
            yNice
            padding={{ top: 8, bottom: 20, left: 40, right: 8 }}
          >
            <Svg>
              <Grid y yTicks={4} />
              <Axis
                placement="left"
                rule
                ticks={4}
                format={(v) => '$' + Number(v).toFixed(v < 1 ? 3 : 2)}
              />
              <Axis placement="bottom" rule ticks={4} format={fmtDate} />
              {#each costByModelGrouped.models as model (model)}
                <Area
                  data={Array.from(costByModelGrouped.map.get(model)?.entries() ?? []).map(
                    ([t, v]) => ({ t: new Date(t), v }),
                  )}
                  x="t"
                  y="v"
                  fill={colorForModel(model)}
                  fillOpacity={0.25}
                  stroke={colorForModel(model)}
                  strokeWidth={1}
                  curve={curveMonotoneX}
                />
              {/each}
              <Highlight points lines />
            </Svg>
            <Tooltip.Context mode="bisect-x">
              <Tooltip.Root let:data variant="none">
                <div class="tt">
                  <div class="tt-t">{new Date(data.t).toLocaleString()}</div>
                  <div class="tt-v">{data.model} · ${data.v.toFixed(4)}</div>
                </div>
              </Tooltip.Root>
            </Tooltip.Context>
          </Chart>
        </div>
        <div class="model-legend">
          {#each costByModelGrouped.models as model (model)}
            <span class="model-legend-item">
              <span class="model-sw" style:background={colorForModel(model)}></span>{model}
            </span>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .stats-node {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 12px 14px 10px;
    gap: 12px;
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.4;
    overflow: auto;
  }
  .hd {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--divider);
  }
  .title {
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-secondary);
  }
  .gran {
    font-size: 9px;
    color: var(--text-ghost);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .refresh {
    margin-left: auto;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 13px;
    padding: 0 6px;
    border-radius: 2px;
  }
  .refresh:hover {
    color: var(--text-primary);
    border-color: var(--card-border);
  }

  /* ——— KPI strip ——— */
  .kpis {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
    flex: 0 0 auto;
  }
  .kpi {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
  }
  .kpi-l {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .kpi-v {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .kpi-v.ok { color: var(--accent); }
  .kpi-v.fail { color: #b53b3b; }

  /* ——— Block sections ——— */
  .block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 0 0 auto;
  }
  .block h4 {
    font-size: 9px;
    margin: 0;
    color: var(--text-ghost);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-weight: 500;
  }

  /* ——— Run timeline ——— */
  .timeline {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    padding: 6px 8px;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    min-height: 28px;
    overflow-x: auto;
  }
  .tick {
    width: 10px;
    /* height is set inline per-tick, proportional to durationMs */
    background: var(--text-ghost);
    border-radius: 1px;
    flex-shrink: 0;
  }
  .tick.s-completed { background: var(--accent); }
  .tick.s-failed { background: #b53b3b; }
  .tick.s-running { background: var(--accent-hover); opacity: 0.7; }
  .tick.healing {
    background: repeating-linear-gradient(
      45deg,
      var(--accent) 0 3px,
      rgba(196, 87, 10, 0.35) 3px 6px
    );
  }

  .legend {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 9px;
    color: var(--text-ghost);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .legend .swatch {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 1px;
    background: var(--text-ghost);
  }
  .legend .swatch.s-completed { background: var(--accent); }
  .legend .swatch.s-failed { background: #b53b3b; }
  .legend .swatch.s-running { background: var(--accent-hover); opacity: 0.7; }
  .legend .swatch.healing {
    background: repeating-linear-gradient(
      45deg,
      var(--accent) 0 2px,
      rgba(196, 87, 10, 0.35) 2px 4px
    );
  }
  .legend span + span { margin-right: 6px; }

  /* ——— Chart host ——— */
  .chart-host {
    position: relative;
    height: 116px;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    padding: 4px 8px;
  }

  /* ——— Axis / Grid styling ——— */
  /* Tick mark lines (short perpendicular lines on Axis) */
  .chart-host :global(line.tick) {
    stroke: var(--divider);
  }
  /* Tick label text — layerchart wraps in <svg class="overflow-visible"> → <text class="tickLabel"> */
  .chart-host :global(.tickLabel text),
  .chart-host :global(text.tickLabel) {
    fill: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: 8px;
    stroke: none;
  }
  /* Axis rule lines (the axis spine) — Rule wraps in <g class="rule"> → <line> */
  .chart-host :global(g.rule line) {
    stroke: var(--divider);
  }
  /* Grid lines — Grid → Rule → <g class="rule"> but also direct <line> inside Grid */
  .chart-host :global(g.Grid line) {
    stroke: var(--divider);
    stroke-opacity: 0.4;
  }

  /* ——— Duration fallback KPIs ——— */
  .dur-kpis {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .dur-kpi {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
  }

  .error-strip {
    color: #b53b3b;
    font-size: 10px;
    padding: 6px 8px;
    border: 1px solid rgba(181, 59, 59, 0.4);
    background: rgba(181, 59, 59, 0.06);
  }
  .skel,
  .empty-msg {
    color: var(--text-ghost);
    font-style: italic;
    font-size: 10px;
    padding: 8px;
    text-align: center;
  }

  /* ——— Cost-by-model legend ——— */
  .model-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    margin-top: 4px;
    font-size: 9px;
    color: var(--text-muted, #888);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .model-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .model-sw {
    width: 8px;
    height: 8px;
    border-radius: 1px;
    display: inline-block;
    flex-shrink: 0;
  }

  /* ——— Hover tooltip ——— */
  .tt {
    background: var(--bg-section, #1a1a1a);
    border: 1px solid var(--card-border, #333);
    padding: 4px 6px;
    font-family: var(--font-mono);
    font-size: 9px;
    line-height: 1.5;
    pointer-events: none;
    white-space: nowrap;
  }
  .tt-t {
    color: var(--text-ghost, #666);
    font-size: 8px;
  }
  .tt-v {
    color: var(--text-primary, #eee);
    font-weight: 500;
  }
</style>
