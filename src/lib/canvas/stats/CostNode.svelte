<script lang="ts">
  import { Chart, Svg, Bars, Axis, Grid } from 'layerchart';
  import { groupStackData } from 'layerchart/utils/stack';
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { formatGbp } from './costFormat';
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

  // Stack buckets per timestamp for the chart using layerchart's groupStackData.
  // groupStackData requires a `value` field; map costUsd → value before stacking.
  const stackedBuckets = $derived.by(() => {
    const buckets = data?.buckets ?? [];
    const models = [...new Set(buckets.map((b) => b.model))].sort();
    if (buckets.length === 0) return { rows: [], models };

    const mapped = buckets.map((b) => ({ t: b.t, model: b.model, value: b.costUsd }));
    const stackRows = (groupStackData(mapped, { xKey: 't', stackBy: 'model' }) as unknown) as Array<{
      t: string;
      model: string;
      value: number;
      values: [number, number];
    }>;

    // Attach parsed Date so scaleTime can consume it.
    const rows = stackRows.map((r) => ({ ...r, ts: new Date(r.t) }));
    return { rows, models };
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
    <div class="headline">{formatGbp(data.totalUsd)}</div>

    <div class="chart">
      {#if stackedBuckets.rows.length > 0}
        <Chart
          data={stackedBuckets.rows}
          x="ts"
          y="values"
          yDomain={[0, null]}
          xScale={scaleTime()}
          yScale={scaleLinear()}
          padding={{ top: 8, bottom: 20, left: 44, right: 8 }}
        >
          <Svg>
            <Grid y yTicks={4} />
            {#each stackedBuckets.models as model (model)}
              <Bars
                data={stackedBuckets.rows.filter((r) => r.model === model)}
                x="ts"
                y="values"
                fill={colorForModel(model)}
                stroke="none"
              />
            {/each}
            <Axis placement="left" rule ticks={4} format={(v) => formatGbp(Number(v))} />
            <Axis placement="bottom" rule ticks={4} format={(d) => { const dt = d instanceof Date ? d : new Date(d); return dt.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }); }} />
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
          <div class="bd-row">
            <span class="bd-key" title={r.key}>{r.key}</span>
            <span class="bd-cost">{formatGbp(r.costUsd)}</span>
            <span class="bd-pct">{formatPercent(r.percentage)}</span>
            <span class="bd-n">{r.requests}× · {formatGbp(r.avgCostPerRequest)}</span>
          </div>
          <div class="bd-bar" style="width: {r.percentage * 100}%"></div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .cs {
    display: flex; flex-direction: column; gap: 6px; padding: 10px;
    width: 100%; height: 100%;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    font: 11px / 1.4 var(--font-mono);
    color: var(--text-primary);
    overflow: hidden;
  }
  .hd { display: flex; justify-content: space-between; align-items: center; }
  .title { font-weight: 600; font-size: 12px; }
  .refresh { background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 0 4px; }
  .headline { font-size: 22px; font-weight: 700; }
  .chart { height: 130px; }
  /* layerchart puts the class on the element itself: <text class="tickLabel">,
     <line class="tick">. Descendant selectors (.tick text) do not match. */
  .chart :global(.tickLabel) { fill: var(--text-ghost); font-family: var(--font-mono); font-size: 8px; }
  .chart :global(.tick) { stroke: var(--divider); }
  .chart :global(.rule line) { stroke: var(--card-border); }
  .chart :global(.Grid line) { stroke: var(--divider); opacity: 0.5; }
  .tabs { display: flex; gap: 2px; }
  .tabs button {
    background: transparent; border: 1px solid var(--card-border);
    color: var(--text-muted); padding: 1px 6px; font: inherit; cursor: pointer; border-radius: 2px;
    text-transform: uppercase; letter-spacing: 0.4px; font-size: 9px;
  }
  .tabs button.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .breakdown { list-style: none; padding: 0; margin: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .breakdown li { display: flex; flex-direction: column; gap: 1px; font-size: 10px; }
  .bd-row { display: grid; grid-template-columns: 1fr 70px 50px 100px; gap: 6px; align-items: baseline; }
  .bd-bar { height: 3px; background: var(--accent); border-radius: 1px; min-width: 1px; }
  .bd-key { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bd-cost { text-align: right; font-weight: 600; }
  .bd-pct { text-align: right; color: var(--text-muted); }
  .bd-n { color: var(--text-muted); font-size: 9px; }
  .empty, .skel { color: var(--text-muted); font-style: italic; padding: 8px; text-align: center; }
  .error-strip { color: var(--status-error); font-size: 10px; padding: 4px; border: 1px solid var(--status-error); border-radius: 4px; }
</style>
