<script lang="ts">
  import { useStats } from './useStats.svelte';
  import { formatDurationMs, formatPercent } from './format';

  interface PerNodeRow {
    nodeId: string;
    label: string;
    type: string;
    runs: number;
    success: number;
    failed: number;
    avgMs: number | null;
    p95Ms: number | null;
    lastError: { at: string; message: string } | null;
  }

  interface PerNodeData { nodes: PerNodeRow[]; }

  interface Props {
    slug: string;
    period: string;
    refreshKey?: number;
    onrowclick?: (nodeId: string) => void;
  }
  let { slug, period, refreshKey = 0, onrowclick }: Props = $props();

  const stats = useStats<PerNodeData>(() => slug, 'per-node', () => period, () => refreshKey);

  type SortKey = 'label' | 'runs' | 'successRate' | 'avgMs' | 'p95Ms';
  let sortKey = $state<SortKey>('runs');
  let sortDesc = $state(true);

  const rows = $derived.by(() => {
    const src = stats.data?.nodes ?? [];
    const sorted = [...src].sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0;
      if (sortKey === 'label') { av = a.label; bv = b.label; }
      else if (sortKey === 'runs') { av = a.runs; bv = b.runs; }
      else if (sortKey === 'successRate') {
        av = a.runs ? a.success / a.runs : -1;
        bv = b.runs ? b.success / b.runs : -1;
      }
      else if (sortKey === 'avgMs') { av = a.avgMs ?? -1; bv = b.avgMs ?? -1; }
      else if (sortKey === 'p95Ms') { av = a.p95Ms ?? -1; bv = b.p95Ms ?? -1; }
      if (av < bv) return sortDesc ? 1 : -1;
      if (av > bv) return sortDesc ? -1 : 1;
      return 0;
    });
    return sorted;
  });

  function toggleSort(k: SortKey) {
    if (sortKey === k) sortDesc = !sortDesc;
    else { sortKey = k; sortDesc = true; }
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
            <th onclick={() => toggleSort('label')} class:active={sortKey === 'label'}>Node</th>
            <th onclick={() => toggleSort('runs')} class:active={sortKey === 'runs'} class="num">Runs</th>
            <th onclick={() => toggleSort('successRate')} class:active={sortKey === 'successRate'} class="num">Success</th>
            <th onclick={() => toggleSort('avgMs')} class:active={sortKey === 'avgMs'} class="num">Avg</th>
            <th onclick={() => toggleSort('p95Ms')} class:active={sortKey === 'p95Ms'} class="num">p95</th>
            <th>Last error</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.nodeId)}
            <tr onclick={() => onrowclick?.(r.nodeId)} class:clickable={!!onrowclick}>
              <td>
                <div class="label">{r.label}</div>
                <div class="type">{r.type}</div>
              </td>
              <td class="num">{r.runs}</td>
              <td class="num">{r.runs ? formatPercent(r.success / r.runs) : '—'}</td>
              <td class="num">{formatDurationMs(r.avgMs)}</td>
              <td class="num">{formatDurationMs(r.p95Ms)}</td>
              <td class="err" title={r.lastError?.message ?? ''}>
                {r.lastError ? r.lastError.message.slice(0, 60) : '—'}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
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
  .table-host { flex: 1; overflow: auto; min-height: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06)); }
  th { cursor: pointer; user-select: none; color: var(--text-muted, #888); font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; font-size: 9px; }
  th.active { color: var(--text-primary, #e6e6e6); }
  th.num, td.num { text-align: right; }
  tr.clickable { cursor: pointer; }
  tr.clickable:hover { background: var(--bg-hover, rgba(255, 255, 255, 0.05)); }
  .label { font-weight: 500; }
  .type { color: var(--text-muted, #888); font-size: 9px; }
  .err { color: #c44; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .error-strip { color: #c44; font-size: 10px; padding: 4px; border: 1px solid #c44; border-radius: 4px; }
  .skel { color: var(--text-muted, #888); font-style: italic; font-size: 10px; }
</style>
