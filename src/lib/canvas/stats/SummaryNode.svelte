<script lang="ts">
  import { Chart, Svg, Area, Spline, Axis, Grid, Points } from 'layerchart';
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { useStats } from './useStats.svelte';
  import { formatDurationMs, formatPercent, formatRelative } from './format';
  import { formatGbp, formatTokens } from './costFormat';

  const fmtTime = (d: unknown) => {
    const dt = d instanceof Date ? d : new Date(d as string);
    return dt.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  };

  interface SummaryData {
    counters: {
      runs: number;
      success: number;
      failed: number;
      healing: number;
      successRate: number;
      avgDurationMs: number | null;
      totalCostUsd: number;
      tokensInput: number;
      tokensOutput: number;
      cacheHitRate: number;
    };
    sparkline: Array<{ bucket: string; count: number }>;
    recentRuns: Array<{ id: string; status: string; startedAt: string; durationMs: number | null }>;
    recentEdits: Array<{ at: string; entity: string; action: string; details: Record<string, unknown> }>;
  }

  interface Props {
    slug: string;
    period: string;
    refreshKey?: number;
  }
  let { slug, period, refreshKey = 0 }: Props = $props();

  const stats = useStats<SummaryData>(
    () => slug,
    'summary',
    () => period,
    () => refreshKey,
  );

  function editLine(e: SummaryData['recentEdits'][number]): string {
    const d = e.details as Record<string, string>;
    if (e.entity === 'node' && e.action === 'create') return `+ node ${d.label ?? ''} (${d.nodeType ?? ''})`;
    if (e.entity === 'node' && e.action === 'delete') return `− node ${d.label ?? ''} (${d.nodeType ?? ''})`;
    if (e.entity === 'node' && e.action === 'rename') return `renamed ${d.old} → ${d.new}`;
    if (e.entity === 'node' && e.action === 'config') return `config ${d.field}: ${fmt(d.old)} → ${fmt(d.new)}`;
    if (e.entity === 'edge' && e.action === 'create') return `+ edge ${d.fromLabel ?? d.from} → ${d.toLabel ?? d.to}`;
    if (e.entity === 'edge' && e.action === 'delete') return `− edge ${d.fromLabel ?? d.from} → ${d.toLabel ?? d.to}`;
    if (e.entity === 'trigger') return `trigger updated`;
    if (e.entity === 'workflow' && e.action === 'rename') return `${d.field}: ${fmt(d.old)} → ${fmt(d.new)}`;
    return `${e.entity} ${e.action}`;
  }
  function fmt(v: unknown): string {
    if (typeof v === 'string') return `"${v}"`;
    return JSON.stringify(v);
  }
</script>

<div class="stats-node stats-summary">
  <header>
    <span class="title">Stats · summary</span>
    <button class="refresh" onclick={() => stats.refresh()} title="Refresh">⟳</button>
  </header>

  {#if stats.error}
    <div class="error-strip">{stats.error}</div>
  {:else if stats.loading && !stats.data}
    <div class="skel">Loading…</div>
  {:else if stats.data}
    {@const c = stats.data.counters}
    <div class="counters">
      <div class="counter"><span class="v">{c.runs}</span><span class="l">runs</span></div>
      <div class="counter"><span class="v ok">{c.success}</span><span class="l">success</span></div>
      <div class="counter"><span class="v fail">{c.failed}</span><span class="l">failed</span></div>
      <div class="counter"><span class="v">{formatPercent(c.successRate)}</span><span class="l">rate</span></div>
      <div class="counter"><span class="v">{formatDurationMs(c.avgDurationMs)}</span><span class="l">avg dur</span></div>
      <div class="counter"><span class="v">{formatGbp(c.totalCostUsd)}</span><span class="l">spend</span></div>
      <div class="counter"><span class="v">{formatTokens(c.tokensInput)}→{formatTokens(c.tokensOutput)}</span><span class="l">tokens</span></div>
      <div class="counter"><span class="v">{formatPercent(c.cacheHitRate)}</span><span class="l">cache</span></div>
    </div>

    <h4 class="spark-label">Run volume</h4>
    <div class="spark" aria-hidden>
      {#if stats.data.sparkline.length > 1}
        <Chart
          data={stats.data.sparkline.map((p) => ({ t: new Date(p.bucket), v: p.count }))}
          x="t"
          y="v"
          xScale={scaleTime()}
          yScale={scaleLinear()}
          padding={{ top: 8, bottom: 20, left: 40, right: 8 }}
        >
          <Svg>
            <defs>
              <linearGradient id="summary-spark-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.34" />
                <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
              </linearGradient>
            </defs>
            <Grid y yTicks={3} />
            <Axis placement="left" rule ticks={3} format={(v) => String(v)} />
            <Axis placement="bottom" rule ticks={3} format={fmtTime} />
            <Area fill="url(#summary-spark-grad)" />
            <Spline stroke="var(--accent)" strokeWidth={1.5} />
            <Points r={2} fill="var(--accent)" />
          </Svg>
        </Chart>
      {/if}
    </div>

    <section class="list">
      <h4>Recent runs</h4>
      {#if stats.data.recentRuns.length === 0}
        <div class="empty">No runs in this window</div>
      {:else}
        <ul>
          {#each stats.data.recentRuns as r (r.id)}
            <li>
              <span class={`dot s-${r.status}`}></span>
              <span class="dur">{formatDurationMs(r.durationMs)}</span>
              <span class="when">{formatRelative(new Date(r.startedAt))}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="list">
      <h4>Recent edits</h4>
      {#if stats.data.recentEdits.length === 0}
        <div class="empty">No edits recorded yet</div>
      {:else}
        <ul>
          {#each stats.data.recentEdits as e, i (e.at + '|' + e.entity + '|' + e.action + '|' + i)}
            <li>
              <span class="when">{formatRelative(new Date(e.at))}</span>
              <span class="edit">{editLine(e)}</span>
            </li>
          {/each}
        </ul>
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
    padding: 10px;
    gap: 8px;
    background: var(--bg-card, rgba(255, 255, 255, 0.03));
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 8px;
    font: 11px / 1.4 ui-monospace, Menlo, monospace;
    color: var(--text-primary, #e6e6e6);
    overflow: hidden;
  }
  header { display: flex; justify-content: space-between; align-items: center; }
  .title { font-weight: 600; font-size: 12px; }
  .refresh {
    background: transparent; border: none; color: var(--text-muted, #888);
    cursor: pointer; font-size: 14px; padding: 0 4px;
  }
  .refresh:hover { color: var(--text-primary, #e6e6e6); }
  .counters { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 6px; }
  .counter { display: flex; flex-direction: column; align-items: center; }
  .counter .v { font-size: 14px; font-weight: 600; }
  .counter .v.ok { color: #3a8a56; }
  .counter .v.fail { color: #c44; }
  .counter .l { color: var(--text-muted, #888); font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
  .spark-label { font-size: 10px; margin: 4px 0 2px; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.5px; }
  .spark { height: 96px; }
  .spark :global(.tickLabel) { fill: var(--text-ghost); font-family: var(--font-mono); font-size: 8px; }
  .spark :global(.tick) { stroke: var(--divider); }
  .spark :global(.rule line) { stroke: var(--divider); }
  .spark :global(.Grid line) { stroke: var(--divider); opacity: 0.5; }
  .list h4 { font-size: 10px; margin: 4px 0 2px; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.5px; }
  .list ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; max-height: 120px; overflow-y: auto; }
  .list li { display: flex; gap: 6px; align-items: center; font-size: 10px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted, #888); }
  .dot.s-completed { background: #3a8a56; }
  .dot.s-failed { background: #c44; }
  .dot.s-running { background: #ffcf40; }
  .dur { min-width: 40px; color: var(--text-muted, #888); }
  .when { color: var(--text-muted, #888); }
  .edit { color: var(--text-primary, #e6e6e6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty, .skel { color: var(--text-muted, #888); font-style: italic; font-size: 10px; }
  .error-strip { color: #c44; font-size: 10px; padding: 4px; border: 1px solid #c44; border-radius: 4px; }
</style>
