<script lang="ts">
  import { Chart, Svg, Bars, Spline, Axis } from 'layerchart';
  import { scaleBand, scaleTime, scaleLinear } from 'd3-scale';
  import { useStats } from './useStats.svelte';
  import { formatDurationMs } from './format';

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

  // Short label for each bucket on the x-axis (HH for hour-granularity, MM-DD otherwise).
  function bucketLabel(t: Date, granularity: string): string {
    if (granularity === 'hour') return String(t.getUTCHours()).padStart(2, '0');
    return `${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
  }

  const granularity = $derived(stats.data ? 'day' : 'day');
  const runsSeries = $derived(
    stats.data?.buckets.map((b) => ({
      t: new Date(b.t),
      label: bucketLabel(new Date(b.t), 'day'),
      total: b.runs.success + b.runs.failed + b.runs.healing,
      success: b.runs.success,
      failed: b.runs.failed,
      healing: b.runs.healing,
    })) ?? [],
  );

  const durationSeries = $derived(
    stats.data?.buckets
      .filter((b) => b.durationMs.p50 !== null || b.durationMs.p95 !== null)
      .map((b) => ({
        t: new Date(b.t),
        p50: b.durationMs.p50 ?? 0,
        p95: b.durationMs.p95 ?? 0,
      })) ?? [],
  );

  const hasRuns = $derived(runsSeries.some((r) => r.total > 0));
  const hasDuration = $derived(durationSeries.length > 0);
</script>

<div class="stats-node stats-trends">
  <header>
    <span class="title">Stats · trends</span>
    <button class="refresh" onclick={() => stats.refresh()} title="Refresh">⟳</button>
  </header>

  {#if stats.error}
    <div class="error-strip">{stats.error}</div>
  {:else if stats.loading && !stats.data}
    <div class="skel">Loading…</div>
  {:else if stats.data}
    <section class="chart-block">
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
            padding={{ top: 8, right: 8, bottom: 20, left: 28 }}
          >
            <Svg>
              <Axis placement="left" rule grid ticks={3} />
              <Axis placement="bottom" rule ticks={Math.min(6, runsSeries.length)} />
              <Bars y="total" fill="var(--accent, #7a6cd4)" strokeWidth={0} radius={2} />
              <Bars y="failed" fill="#c44" strokeWidth={0} radius={2} />
            </Svg>
          </Chart>
        {:else}
          <div class="empty">No runs in this window</div>
        {/if}
      </div>
    </section>

    <section class="chart-block">
      <h4>Run duration (p50 solid / p95 dashed)</h4>
      <div class="chart-host">
        {#if hasDuration}
          <Chart
            data={durationSeries}
            x="t"
            xScale={scaleTime()}
            y="p95"
            yScale={scaleLinear()}
            yNice
            padding={{ top: 8, right: 8, bottom: 20, left: 44 }}
          >
            <Svg>
              <Axis placement="left" rule grid ticks={3} format={(v: number) => formatDurationMs(v)} />
              <Axis placement="bottom" rule ticks={Math.min(4, durationSeries.length)} />
              <Spline y="p50" stroke="var(--accent, #7a6cd4)" strokeWidth={1.5} />
              <Spline y="p95" stroke="var(--accent, #7a6cd4)" strokeWidth={1} strokeDasharray="4 3" />
            </Svg>
          </Chart>
        {:else}
          <div class="empty">No duration data in this window</div>
        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  .stats-node {
    display: flex; flex-direction: column;
    width: 100%; height: 100%;
    padding: 10px; gap: 8px;
    background: var(--bg-card, rgba(255, 255, 255, 0.03));
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 8px;
    font: 11px / 1.4 ui-monospace, Menlo, monospace;
    color: var(--text-primary, #e6e6e6);
    overflow: hidden;
  }
  header { display: flex; justify-content: space-between; align-items: center; }
  .title { font-weight: 600; font-size: 12px; }
  .refresh { background: transparent; border: none; color: var(--text-muted, #888); cursor: pointer; font-size: 14px; padding: 0 4px; }
  .chart-block { display: flex; flex-direction: column; gap: 2px; flex: 1; min-height: 0; }
  .chart-block h4 { font-size: 10px; margin: 0; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.5px; }
  .chart-host { flex: 1; min-height: 80px; }
  .error-strip { color: #c44; font-size: 10px; padding: 4px; border: 1px solid #c44; border-radius: 4px; }
  .skel, .empty {
    color: var(--text-muted, #888);
    font-style: italic;
    font-size: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
  }
</style>
