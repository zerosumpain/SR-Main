<script lang="ts">
  import { Chart, Svg, Bars, Spline, Axis } from 'layerchart';
  import { scaleBand, scaleLinear } from 'd3-scale';
  import { useStats } from './useStats.svelte';
  import { formatDurationMs, formatPercent } from './format';

  interface TrendsData {
    buckets: Array<{
      t: string;
      runs: { success: number; failed: number; healing: number };
      durationMs: { p50: number | null; p95: number | null; avg: number | null };
    }>;
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

  /** Pick a label format that matches the actual API granularity. */
  function bucketLabel(t: Date, granularity: 'hour' | 'day' | 'week' | undefined): string {
    if (granularity === 'hour') {
      return `${String(t.getUTCHours()).padStart(2, '0')}:00`;
    }
    return `${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
  }

  const granularity = $derived(stats.window?.granularity);

  const runsSeries = $derived(
    stats.data?.buckets.map((b) => {
      const s = b.runs.success;
      const f = b.runs.failed;
      const h = b.runs.healing;
      return {
        t: new Date(b.t),
        label: bucketLabel(new Date(b.t), granularity),
        total: s + f + h,
        success: s,
        successY0: 0,
        successY1: s,
        failed: f,
        failedY0: s,
        failedY1: s + f,
        healing: h,
        healingY0: s + f,
        healingY1: s + f + h,
      };
    }) ?? [],
  );

  const durationSeries = $derived(
    stats.data?.buckets.map((b) => ({
      t: new Date(b.t),
      label: bucketLabel(new Date(b.t), granularity),
      p50: b.durationMs.p50 ?? null,
      p95: b.durationMs.p95 ?? null,
      avg: b.durationMs.avg ?? null,
    })) ?? [],
  );

  const hasRuns = $derived(runsSeries.some((r) => r.total > 0));
  const hasDuration = $derived(
    durationSeries.some((d) => d.p50 !== null || d.p95 !== null || d.avg !== null),
  );

  // Aggregate KPIs across the window so the user sees a quick summary even
  // before they parse the chart bars.
  const kpis = $derived.by(() => {
    let runs = 0,
      success = 0,
      failed = 0,
      healing = 0,
      avgWeightedSum = 0,
      avgWeightedCount = 0;
    for (const b of stats.data?.buckets ?? []) {
      const total = b.runs.success + b.runs.failed + b.runs.healing;
      runs += total;
      success += b.runs.success;
      failed += b.runs.failed;
      healing += b.runs.healing;
      if (b.durationMs.avg !== null) {
        // We don't have per-bucket run counts attributable to the avg
        // (avg is over completed runs only), so weight by total runs as
        // a reasonable proxy.
        avgWeightedSum += b.durationMs.avg * total;
        avgWeightedCount += total;
      }
    }
    const avg = avgWeightedCount > 0 ? avgWeightedSum / avgWeightedCount : null;
    return { runs, success, failed, healing, avg };
  });
</script>

<div class="stats-node stats-trends">
  <header>
    <span class="title">Stats · trends</span>
    {#if granularity}
      <span class="gran">{granularity}-buckets</span>
    {/if}
    <button class="refresh" onclick={() => stats.refresh()} title="Refresh">⟳</button>
  </header>

  {#if stats.error}
    <div class="error-strip">{stats.error}</div>
  {:else if stats.loading && !stats.data}
    <div class="skel">Loading…</div>
  {:else if stats.data}
    <div class="kpis">
      <div class="kpi"><span class="v">{kpis.runs}</span><span class="l">runs</span></div>
      <div class="kpi"><span class="v ok">{kpis.success}</span><span class="l">success</span></div>
      <div class="kpi"><span class="v fail">{kpis.failed}</span><span class="l">failed</span></div>
      <div class="kpi">
        <span class="v">{kpis.runs ? formatPercent(kpis.success / kpis.runs) : '—'}</span>
        <span class="l">rate</span>
      </div>
      <div class="kpi"><span class="v">{formatDurationMs(kpis.avg)}</span><span class="l">avg</span></div>
    </div>

    <section class="chart-block" class:empty={!hasRuns}>
      <h4>Runs over time</h4>
      <div class="chart-host">
        {#if hasRuns}
          <Chart
            data={runsSeries}
            x="label"
            xScale={scaleBand().padding(0.2)}
            y="total"
            yScale={scaleLinear()}
            yNice
            padding={{ top: 8, right: 8, bottom: 22, left: 32 }}
          >
            <Svg>
              <Axis placement="left" rule grid ticks={3} />
              <Axis placement="bottom" rule ticks={Math.min(8, runsSeries.length)} />
              <Bars y="successY0" y1="successY1" fill="#3a8a56" strokeWidth={0} />
              <Bars y="failedY0" y1="failedY1" fill="#c44" strokeWidth={0} />
              <Bars y="healingY0" y1="healingY1" fill="#ffcf40" strokeWidth={0} />
            </Svg>
          </Chart>
        {:else}
          <div class="empty-msg">No runs in this window</div>
        {/if}
      </div>
      <div class="legend">
        <span class="swatch" style="background: #3a8a56"></span><span>success</span>
        <span class="swatch" style="background: #c44"></span><span>failed</span>
        <span class="swatch" style="background: #ffcf40"></span><span>healing</span>
      </div>
    </section>

    {#if hasDuration}
      <section class="chart-block">
        <h4>Run duration</h4>
        <div class="chart-host">
          <Chart
            data={durationSeries}
            x="label"
            xScale={scaleBand().padding(0.2)}
            y={(d: { p50: number | null; p95: number | null; avg: number | null }) =>
              Math.max(d.p95 ?? 0, d.avg ?? 0, d.p50 ?? 0)}
            yScale={scaleLinear()}
            yNice
            padding={{ top: 8, right: 8, bottom: 22, left: 48 }}
          >
            <Svg>
              <Axis
                placement="left"
                rule
                grid
                ticks={3}
                format={(v: number) => formatDurationMs(v)}
              />
              <Axis placement="bottom" rule ticks={Math.min(8, durationSeries.length)} />
              <Spline y="avg" stroke="var(--accent, #7a6cd4)" strokeWidth={1.5} />
              <Spline y="p50" stroke="#3a8a56" strokeWidth={1.25} />
              <Spline y="p95" stroke="#c44" strokeWidth={1.25} strokeDasharray="4 3" />
            </Svg>
          </Chart>
        </div>
        <div class="legend">
          <span class="swatch" style="background: var(--accent, #7a6cd4)"></span><span>avg</span>
          <span class="swatch" style="background: #3a8a56"></span><span>p50</span>
          <span class="swatch dashed" style="background: #c44"></span><span>p95</span>
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
    padding: 10px;
    gap: 6px;
    background: var(--bg-card, rgba(255, 255, 255, 0.03));
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 8px;
    font: 11px / 1.4 ui-monospace, Menlo, monospace;
    color: var(--text-primary, #e6e6e6);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .title { font-weight: 600; font-size: 12px; }
  .gran {
    color: var(--text-muted, #888);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .refresh {
    margin-left: auto;
    background: transparent; border: none; color: var(--text-muted, #888);
    cursor: pointer; font-size: 14px; padding: 0 4px;
  }
  .refresh:hover { color: var(--text-primary, #e6e6e6); }
  .kpis {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
    flex: 0 0 auto;
  }
  .kpi {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 4px;
    padding: 4px 0;
  }
  .kpi .v { font-size: 13px; font-weight: 600; }
  .kpi .v.ok { color: #3a8a56; }
  .kpi .v.fail { color: #c44; }
  .kpi .l {
    color: var(--text-muted, #888);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .chart-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1 1 0;
    min-height: 140px;
  }
  .chart-block.empty {
    flex: 0 0 auto;
    min-height: 60px;
  }
  .chart-block h4 {
    font-size: 10px;
    margin: 0;
    color: var(--text-muted, #888);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  /*
   * The chart-host needs an absolute height anchor so layerchart's <Chart>
   * receives a non-zero clientHeight on first render — without it the chart
   * collapses to ~50% of the available space because the surrounding flex
   * column hadn't laid out before the chart measured itself.
   */
  .chart-host {
    position: relative;
    flex: 1 1 0;
    min-height: 110px;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 9px;
    color: var(--text-muted, #888);
    padding: 0 4px 2px;
    flex-wrap: wrap;
  }
  .legend .swatch {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }
  .legend .swatch.dashed {
    background: repeating-linear-gradient(
      90deg,
      currentColor 0 3px,
      transparent 3px 6px
    ) !important;
  }
  .legend span + span { margin-right: 6px; }
  .error-strip {
    color: #c44;
    font-size: 10px;
    padding: 4px;
    border: 1px solid #c44;
    border-radius: 4px;
  }
  .skel,
  .empty-msg {
    color: var(--text-muted, #888);
    font-style: italic;
    font-size: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
  }
</style>
