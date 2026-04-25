<script lang="ts">
  import { useStats } from './useStats.svelte';
  import { formatDurationMs, formatPercent, formatRelative } from './format';

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
    | 'lastRunAt';
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
              <td class="num">
                {r.lastRunAt ? formatRelative(new Date(r.lastRunAt)) : '—'}
              </td>
            </tr>
            {#if isOpen}
              <tr class="detail">
                <td></td>
                <td colspan="8">
                  <div class="detail-grid">
                    <div class="detail-cell">
                      <span class="dl">Min</span>
                      <span class="dv">{formatDurationMs(r.minMs)}</span>
                    </div>
                    <div class="detail-cell">
                      <span class="dl">Max</span>
                      <span class="dv">{formatDurationMs(r.maxMs)}</span>
                    </div>
                    <div class="detail-cell">
                      <span class="dl">Success</span>
                      <span class="dv ok">{r.success}</span>
                    </div>
                    <div class="detail-cell">
                      <span class="dl">Failed</span>
                      <span class="dv fail">{r.failed}</span>
                    </div>
                  </div>
                  {#if r.lastError}
                    <div class="last-err">
                      <div class="last-err-hdr">
                        Last error · {formatRelative(new Date(r.lastError.at))}
                      </div>
                      <pre>{r.lastError.message}</pre>
                    </div>
                  {/if}
                  {#if onrowclick}
                    <button
                      class="jump-btn"
                      type="button"
                      onclick={(e) => {
                        e.stopPropagation();
                        onrowclick?.(r.nodeId);
                      }}
                    >
                      Jump to node
                    </button>
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
    padding: 10px;
    gap: 8px;
    background: var(--bg-card, rgba(255, 255, 255, 0.03));
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 8px;
    font: 11px / 1.4 ui-monospace, Menlo, monospace;
    color: var(--text-primary, #e6e6e6);
    overflow: hidden;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .title {
    font-weight: 600;
    font-size: 12px;
  }
  .refresh {
    background: transparent;
    border: none;
    color: var(--text-muted, #888);
    cursor: pointer;
    font-size: 14px;
    padding: 0 4px;
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
    padding: 4px 6px;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
  }
  th {
    cursor: pointer;
    user-select: none;
    color: var(--text-muted, #888);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-size: 9px;
    position: sticky;
    top: 0;
    background: var(--bg-card, rgba(0, 0, 0, 0.6));
    backdrop-filter: blur(4px);
    z-index: 1;
  }
  th.active {
    color: var(--text-primary, #e6e6e6);
  }
  th.num,
  td.num {
    text-align: right;
  }
  td.caret {
    width: 14px;
    color: var(--text-muted, #888);
    text-align: center;
  }
  td.num.fail {
    color: #c44;
    font-weight: 600;
  }
  tr.clickable {
    cursor: pointer;
  }
  tr.clickable:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.05));
  }
  tr.has-error td:first-child + td {
    border-left: 2px solid #c44;
  }
  .label {
    font-weight: 500;
  }
  .type {
    color: var(--text-muted, #888);
    font-size: 9px;
  }
  tr.detail td {
    background: rgba(255, 255, 255, 0.025);
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
    gap: 1px;
  }
  .dl {
    color: var(--text-muted, #888);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .dv {
    font-size: 11px;
    font-weight: 600;
  }
  .dv.ok {
    color: #3a8a56;
  }
  .dv.fail {
    color: #c44;
  }
  .last-err {
    margin-top: 4px;
    border: 1px solid rgba(196, 68, 68, 0.4);
    border-radius: 4px;
    background: rgba(196, 68, 68, 0.08);
    padding: 4px 6px;
  }
  .last-err-hdr {
    color: #c44;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 2px;
  }
  .last-err pre {
    margin: 0;
    color: #e6b6b6;
    font-size: 10px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .jump-btn {
    margin-top: 6px;
    background: transparent;
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.15));
    color: var(--text-primary, #e6e6e6);
    font: inherit;
    font-size: 10px;
    padding: 3px 8px;
    border-radius: 3px;
    cursor: pointer;
  }
  .jump-btn:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.05));
  }
  .error-strip {
    color: #c44;
    font-size: 10px;
    padding: 4px;
    border: 1px solid #c44;
    border-radius: 4px;
  }
  .skel {
    color: var(--text-muted, #888);
    font-style: italic;
    font-size: 10px;
  }
</style>
