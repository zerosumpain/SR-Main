<script lang="ts">
  import { Chart, Svg, Bars } from 'layerchart';
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { formatUsd } from './costFormat';
  import { formatPercent } from './format';

  type GroupBy = 'model' | 'node-type' | 'node-label';

  interface CostBucket { t: string; model: string; costUsd: number; }
  interface BreakdownRow {
    key: string;
    costUsd: number;
    percentage: number;
    requests: number;
    avgCostPerRequest: number;
  }
  interface CostData {
    totalUsd: number;
    buckets: CostBucket[];
    breakdown: BreakdownRow[];
    groupBy: GroupBy;
  }

  interface Props {
    slug: string;
    period: string;
    refreshKey?: number;
    onnodeclick?: (nodeId: string) => void;
  }
  let { slug, period, refreshKey = 0, onnodeclick }: Props = $props();

  // The `onnodeclick` prop is reserved for a future drill-down list of
  // recent LLM calls. Reference it to silence the unused-prop warning.
  void onnodeclick;

  let groupBy = $state<GroupBy>('model');
  let data = $state<CostData | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // useStats only encodes ?period, not arbitrary query args, so this
  // component fetches inline (mirrors PerNodeDrilldown's pattern).
  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      const url = `/api/canvas/${encodeURIComponent(slug)}/stats/cost?period=${encodeURIComponent(period)}&groupBy=${groupBy}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: CostData };
      data = body.data;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    slug; period; groupBy; refreshKey;
    load();
  });

  function colorForModel(model: string): string {
    let hash = 0;
    for (let i = 0; i < model.length; i++) hash = (hash * 31 + model.charCodeAt(i)) | 0;
    const hue = ((hash % 360) + 360) % 360;
    return `hsl(${hue}, 65%, 55%)`;
  }

  // Stack buckets per timestamp for the chart.
  const stackedBuckets = $derived.by(() => {
    const byT = new Map<string, Record<string, number | Date>>();
    const models = new Set<string>();
    for (const b of data?.buckets ?? []) {
      models.add(b.model);
      const row = (byT.get(b.t) ?? { t: new Date(b.t) }) as Record<string, number | Date>;
      row[b.model] = b.costUsd;
      byT.set(b.t, row);
    }
    return { rows: Array.from(byT.values()), models: [...models].sort() };
  });
</script>

<div class="cs">
  <header class="hd">
    <span class="title">Cost</span>
    <button class="refresh" onclick={() => load()} title="Refresh">⟳</button>
  </header>

  {#if error}
    <div class="error-strip">{error}</div>
  {:else if loading && !data}
    <div class="skel">Loading…</div>
  {:else if data}
    <div class="headline">{formatUsd(data.totalUsd)}</div>

    <div class="chart">
      {#if stackedBuckets.rows.length > 0}
        <Chart
          data={stackedBuckets.rows}
          x="t"
          xScale={scaleTime()}
          yScale={scaleLinear()}
        >
          <Svg>
            {#each stackedBuckets.models as model (model)}
              <Bars y={model} fill={colorForModel(model)} stroke="none" />
            {/each}
          </Svg>
        </Chart>
      {:else}
        <div class="empty">No spend in this window</div>
      {/if}
    </div>

    <div class="tabs">
      {#each ['model', 'node-type', 'node-label'] as g (g)}
        <button
          class:active={groupBy === g}
          onclick={() => (groupBy = g as GroupBy)}
        >{g}</button>
      {/each}
    </div>

    <ul class="breakdown">
      {#each data.breakdown as r (r.key)}
        <li>
          <span class="bd-key" title={r.key}>{r.key}</span>
          <span class="bd-cost">{formatUsd(r.costUsd)}</span>
          <span class="bd-pct">{formatPercent(r.percentage)}</span>
          <span class="bd-n">{r.requests}× · {formatUsd(r.avgCostPerRequest)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .cs {
    display: flex; flex-direction: column; gap: 6px; padding: 10px;
    width: 100%; height: 100%;
    background: var(--bg-card, rgba(255,255,255,0.03));
    border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
    border-radius: 8px;
    font: 11px / 1.4 ui-monospace, Menlo, monospace;
    color: var(--text-primary, #e6e6e6);
    overflow: hidden;
  }
  .hd { display: flex; justify-content: space-between; align-items: center; }
  .title { font-weight: 600; font-size: 12px; }
  .refresh { background: transparent; border: none; color: var(--text-muted, #888); cursor: pointer; font-size: 14px; padding: 0 4px; }
  .headline { font-size: 22px; font-weight: 700; }
  .chart { height: 90px; }
  .tabs { display: flex; gap: 2px; }
  .tabs button {
    background: transparent; border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
    color: var(--text-muted, #888); padding: 1px 6px; font: inherit; cursor: pointer; border-radius: 2px;
    text-transform: uppercase; letter-spacing: 0.4px; font-size: 9px;
  }
  .tabs button.active { background: var(--accent, #3a8a56); color: white; border-color: var(--accent); }
  .breakdown { list-style: none; padding: 0; margin: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .breakdown li { display: grid; grid-template-columns: 1fr 70px 50px 100px; gap: 6px; align-items: baseline; font-size: 10px; }
  .bd-key { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bd-cost { text-align: right; font-weight: 600; }
  .bd-pct { text-align: right; color: var(--text-muted, #888); }
  .bd-n { color: var(--text-muted, #888); font-size: 9px; }
  .empty, .skel { color: var(--text-muted, #888); font-style: italic; padding: 8px; text-align: center; }
  .error-strip { color: #c44; font-size: 10px; padding: 4px; border: 1px solid #c44; border-radius: 4px; }
</style>
