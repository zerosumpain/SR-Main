<script lang="ts">
  import { useStats } from './useStats.svelte';
  import { formatDurationMs, formatPercent, formatRelative } from './format';
  import { formatUsd, formatTokens } from './costFormat';
  import PerNodeDrilldown from './PerNodeDrilldown.svelte';

  interface PerNodeRow {
    nodeId: string;
    label: string;
    type: string;
    runs: number;
    success: number;
    failed: number;
    avgMs: number | null;
    p95Ms: number | null;
    minMs: number | null;
    maxMs: number | null;
    totalMs: number | null;
    lastRunAt: string | null;
    lastError: { at: string; message: string } | null;
    costUsd: number;
    tokensInput: number;
    tokensOutput: number;
    cacheReadTokens: number;
  }

  interface PerNodeData {
    nodes: PerNodeRow[];
  }

  interface Props {
    slug: string;
    period: string;
    refreshKey?: number;
    onrowclick?: (nodeId: string) => void;
  }
  let { slug, period, refreshKey = 0, onrowclick }: Props = $props();

  const stats = useStats<PerNodeData>(() => slug, 'per-node', () => period, () => refreshKey);

  type SortKey =
    | 'label'
    | 'runs'
    | 'failed'
    | 'successRate'
    | 'avgMs'
    | 'p95Ms'
    | 'totalMs'
    | 'lastRunAt'
    | 'costUsd';
  let sortKey = $state<SortKey>('runs');
  let sortDesc = $state(true);
  let expanded = $state<Record<string, boolean>>({});

  const rows = $derived.by(() => {
    const src = stats.data?.nodes ?? [];
    const sorted = [...src].sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      if (sortKey === 'label') {
        av = a.label;
        bv = b.label;
      } else if (sortKey === 'runs') {
        av = a.runs;
        bv = b.runs;
      } else if (sortKey === 'failed') {
        av = a.failed;
        bv = b.failed;
      } else if (sortKey === 'successRate') {
        av = a.runs ? a.success / a.runs : -1;
        bv = b.runs ? b.success / b.runs : -1;
      } else if (sortKey === 'avgMs') {
        av = a.avgMs ?? -1;
        bv = b.avgMs ?? -1;
      } else if (sortKey === 'p95Ms') {
        av = a.p95Ms ?? -1;
        bv = b.p95Ms ?? -1;
      } else if (sortKey === 'totalMs') {
        av = a.totalMs ?? -1;
        bv = b.totalMs ?? -1;
      } else if (sortKey === 'lastRunAt') {
        av = a.lastRunAt ? new Date(a.lastRunAt).getTime() : -1;
        bv = b.lastRunAt ? new Date(b.lastRunAt).getTime() : -1;
      } else if (sortKey === 'costUsd') {
        av = a.costUsd;
        bv = b.costUsd;
      }
      if (av < bv) return sortDesc ? 1 : -1;
      if (av > bv) return sortDesc ? -1 : 1;
      return 0;
    });
    return sorted;
  });

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      sortDesc = !sortDesc;
    } else {
      sortKey = k;
      sortDesc = true;
    }
  }

  function toggleExpanded(nodeId: string) {
    expanded = { ...expanded, [nodeId]: !expanded[nodeId] };
  }
</script>

<div class="stats-node stats-pernode">
  <header>
    <span class="title">Stats · per-node</span>
    <button class="refresh" onclick={() => stats.refresh()} title="Refresh">⟳</button>
  </header>

  {#if stats.error}
    <div class="error-strip">{stats.error}</div>
  {:else if stats.loading && !stats.data}
    <div class="skel">Loading…</div>
  {:else if stats.data}
    <div class="table-host">
      <table>
        <thead>
          <tr>
            <th></th>
            <th onclick={() => toggleSort('label')} class:active={sortKey === 'label'}>Node</th>
            <th onclick={() => toggleSort('runs')} class:active={sortKey === 'runs'} class="num">
              Runs
            </th>
            <th
              onclick={() => toggleSort('successRate')}
              class:active={sortKey === 'successRate'}
              class="num"
            >
              Success
            </th>
            <th
              onclick={() => toggleSort('failed')}
              class:active={sortKey === 'failed'}
              class="num"
            >
              Fail
            </th>
            <th
              onclick={() => toggleSort('avgMs')}
              class:active={sortKey === 'avgMs'}
              class="num"
              title="Average run duration"
            >
              Avg time
            </th>
            <th
              onclick={() => toggleSort('p95Ms')}
              class:active={sortKey === 'p95Ms'}
              class="num"
              title="95th-percentile run duration"
            >
              p95
            </th>
            <th
              onclick={() => toggleSort('totalMs')}
              class:active={sortKey === 'totalMs'}
              class="num"
              title="Total time spent across all runs"
            >
              Total
            </th>
            <th
              onclick={() => toggleSort('costUsd')}
              class:active={sortKey === 'costUsd'}
              class="num"
              title="Sum of LLM cost across all runs in this window"
            >
              Cost
            </th>
            <th class="num" title="Total prompt → completion tokens">Tokens</th>
            <th class="num" title="Cache-read tokens as a fraction of prompt tokens">Cache</th>
            <th
              onclick={() => toggleSort('lastRunAt')}
              class:active={sortKey === 'lastRunAt'}
              class="num"
              title="Most recent completion"
            >
              Last
            </th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.nodeId)}
            {@const isOpen = !!expanded[r.nodeId]}
            <tr
              onclick={() => toggleExpanded(r.nodeId)}
              class="clickable"
              class:has-error={!!r.lastError}
            >
              <td class="caret">{isOpen ? '▾' : '▸'}</td>
              <td>
                <div class="label">{r.label}</div>
                <div class="type">{r.type}</div>
              </td>
              <td class="num">{r.runs}</td>
              <td class="num">
                {r.runs ? formatPercent(r.success / r.runs) : '—'}
              </td>
              <td class="num" class:fail={r.failed > 0}>{r.failed}</td>
              <td class="num">{formatDurationMs(r.avgMs)}</td>
              <td class="num">{formatDurationMs(r.p95Ms)}</td>
              <td class="num">{formatDurationMs(r.totalMs)}</td>
              <td class="num">{formatUsd(r.costUsd)}</td>
              <td class="num">{formatTokens(r.tokensInput)}→{formatTokens(r.tokensOutput)}</td>
              <td class="num">{r.tokensInput > 0 ? formatPercent(r.cacheReadTokens / r.tokensInput) : '—'}</td>
              <td class="num">
                {r.lastRunAt ? formatRelative(new Date(r.lastRunAt)) : '—'}
              </td>
            </tr>
            {#if isOpen}
              <tr class="detail">
                <td></td>
                <td colspan="11">
                  <PerNodeDrilldown
                    slug={slug}
                    nodeId={r.nodeId}
                    defaultRange={period as '1h' | '6h' | '24h' | '7d' | '30d' | 'all'}
                    refreshKey={refreshKey}
                  />
                  {#if r.lastError}
                    <div class="last-error" title={r.lastError.message}>
                      <span class="le-when">{formatRelative(new Date(r.lastError.at))}</span>
                      <span class="le-msg">{r.lastError.message.slice(0, 200)}</span>
                    </div>
                  {/if}
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .stats-node {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 12px 14px 10px;
    gap: 8px;
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.4;
    overflow: hidden;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
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
  .refresh {
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
  .table-host {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
  }
  th,
  td {
    text-align: left;
    padding: 5px 7px;
    border-bottom: 1px solid var(--divider);
  }
  th {
    cursor: pointer;
    user-select: none;
    color: var(--text-ghost);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 9px;
    position: sticky;
    top: 0;
    background: var(--bg);
    border-bottom: 1px solid var(--card-border);
    z-index: 1;
  }
  th.active {
    color: var(--accent);
  }
  th.num,
  td.num {
    text-align: right;
  }
  td.caret {
    width: 14px;
    color: var(--text-ghost);
    text-align: center;
  }
  td.num.fail {
    color: #b53b3b;
    font-weight: 500;
  }
  tr.clickable {
    cursor: pointer;
  }
  tr.clickable:hover {
    background: var(--bg-section);
  }
  tr.has-error td:first-child + td {
    border-left: 2px solid #b53b3b;
  }
  .label {
    font-weight: 500;
    color: var(--text-primary);
  }
  .type {
    color: var(--text-ghost);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  tr.detail td {
    background: var(--bg-section);
    padding: 8px 10px;
  }
  .detail-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: 8px;
    margin-bottom: 6px;
  }
  .detail-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 6px;
    background: var(--bg);
    border: 1px solid var(--card-border);
  }
  .dl {
    color: var(--text-ghost);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .dv {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .dv.ok {
    color: var(--accent);
  }
  .dv.fail {
    color: #b53b3b;
  }
  .last-err {
    margin-top: 4px;
    border: 1px solid rgba(181, 59, 59, 0.35);
    background: rgba(181, 59, 59, 0.06);
    padding: 6px 8px;
  }
  .last-err-hdr {
    color: #b53b3b;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin-bottom: 2px;
  }
  .last-err pre {
    margin: 0;
    color: var(--text-primary);
    font-size: 10px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .jump-btn {
    margin-top: 6px;
    background: transparent;
    border: 1px solid var(--card-border);
    color: var(--text-secondary);
    font: inherit;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 4px 10px;
    cursor: pointer;
  }
  .jump-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .last-error {
    margin-top: 6px;
    padding: 4px 6px;
    background: rgba(204, 68, 68, 0.06);
    border-left: 2px solid #c44;
    font-size: 9px;
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .last-error .le-when { color: var(--text-muted, #888); flex: 0 0 auto; }
  .last-error .le-msg { color: #c44; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .error-strip {
    color: #b53b3b;
    font-size: 10px;
    padding: 6px 8px;
    border: 1px solid rgba(181, 59, 59, 0.4);
    background: rgba(181, 59, 59, 0.06);
  }
  .skel {
    color: var(--text-ghost);
    font-style: italic;
    font-size: 10px;
    padding: 8px;
    text-align: center;
  }
</style>
