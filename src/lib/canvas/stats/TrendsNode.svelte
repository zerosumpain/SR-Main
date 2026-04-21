<script lang="ts">
  import { Chart, Svg, Bars, Spline, Axis } from 'layerchart';
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

  const runsSeries = $derived(
    stats.data?.buckets.map((b) => ({
      t: new Date(b.t),
      success: b.runs.success,
      failed: b.runs.failed,
      healing: b.runs.healing,
      total: b.runs.success + b.runs.failed + b.runs.healing,
    })) ?? [],
  );

  const durationSeries = $derived(
    stats.data?.buckets.map((b) => ({
      t: new Date(b.t),
      p50: b.durationMs.p50 ?? null,
      p95: b.durationMs.p95 ?? null,
    })) ?? [],
  );
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
        <Chart data={runsSeries} x="t" y="total" padding={{ top: 8, right: 8, bottom: 24, left: 32 }}>
          <Svg>
            <Axis placement="left" rule grid ticks={3} />
            <Axis placement="bottom" rule />
            <Bars y="success" fill="#3a8a56" strokeWidth={0} />
            <Bars y="failed" fill="#c44" strokeWidth={0} />
            <Bars y="healing" fill="#ffcf40" strokeWidth={0} />
          </Svg>
        </Chart>
      </div>
    </section>

    <section class="chart-block">
      <h4>Run duration (p50 / p95)</h4>
      <div class="chart-host">
        <Chart data={durationSeries} x="t" y="p95" padding={{ top: 8, right: 8, bottom: 24, left: 40 }}>
          <Svg>
            <Axis placement="left" rule grid ticks={3} format={(v: number) => formatDurationMs(v)} />
            <Axis placement="bottom" rule />
            <Spline y="p50" stroke="var(--accent)" strokeWidth={1.5} />
            <Spline y="p95" stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" />
          </Svg>
        </Chart>
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
  .skel { color: var(--text-muted, #888); font-style: italic; font-size: 10px; }
</style>
