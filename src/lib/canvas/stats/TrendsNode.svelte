<script lang="ts">
  import { Chart, Svg, Area, Spline } from 'layerchart';
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

  // Run-volume sparkline: total runs per bucket, oldest → newest. Same
  // gating as duration — needs at least a few points to read.
  const volumeSparkline = $derived(
    (stats.data?.buckets ?? []).map((b) => ({
      t: new Date(b.t),
      v: b.runs.success + b.runs.failed + b.runs.healing,
    })),
  );

  const recentRuns = $derived(stats.data?.recentRuns ?? []);
  // Render the timeline oldest → newest so the most recent run is on the
  // right (matches the way users read time-series charts).
  const timelineRuns = $derived([...recentRuns].reverse());

  const showVolumeChart = $derived(
    volumeSparkline.filter((p) => p.v > 0).length >= 4,
  );
  const showDurationChart = $derived(durationSparkline.length >= 4);
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
            padding={{ top: 4, bottom: 4, left: 0, right: 0 }}
          >
            <Svg>
              <Area fill="var(--accent)" fillOpacity={0.15} curve={curveMonotoneX} />
              <Spline stroke="var(--accent)" strokeWidth={1.5} curve={curveMonotoneX} />
            </Svg>
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
            padding={{ top: 4, bottom: 4, left: 0, right: 0 }}
          >
            <Svg>
              <Area fill="var(--accent)" fillOpacity={0.1} curve={curveMonotoneX} />
              <Spline stroke="var(--accent)" strokeWidth={1.5} curve={curveMonotoneX} />
            </Svg>
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
    align-items: stretch;
    gap: 3px;
    padding: 6px 8px;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    min-height: 28px;
    overflow-x: auto;
  }
  .tick {
    width: 10px;
    height: 16px;
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
      var(--accent-tint-35) 3px 6px
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
      var(--accent-tint-35) 2px 4px
    );
  }
  .legend span + span { margin-right: 6px; }

  /* ——— Sparklines ——— */
  .chart-host {
    position: relative;
    height: 56px;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    padding: 4px 8px;
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
</style>
