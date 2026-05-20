<script lang="ts">
  import { useStats } from './useStats.svelte';
  import { formatRelative } from './format';

  interface ErrorGroup {
    signature: string;
    count: number;
    lastSeen: string;
    affectedNodeIds: string[];
    affectedNodeLabels: string[];
    recent: Array<{
      runId: string;
      nodeId: string;
      nodeLabel: string;
      at: string;
      error: string;
    }>;
  }

  interface ErrorsData {
    totalErrors: number;
    groups: ErrorGroup[];
  }

  interface Props {
    slug: string;
    period: string;
    refreshKey?: number;
    onnodeclick?: (nodeId: string) => void;
  }
  let { slug, period, refreshKey = 0, onnodeclick }: Props = $props();

  const stats = useStats<ErrorsData>(() => slug, 'errors', () => period, () => refreshKey);

  let expanded = $state<Record<string, boolean>>({});
  function toggle(sig: string) { expanded = { ...expanded, [sig]: !expanded[sig] }; }

  const maxCount = $derived(
    stats.data ? Math.max(1, ...stats.data.groups.map((g) => g.count)) : 1
  );
</script>

<div class="ee">
  <header class="hd">
    <span class="title">Errors</span>
    <button class="refresh" onclick={() => stats.refresh()} title="Refresh">⟳</button>
  </header>

  {#if stats.error}
    <div class="error-strip">{stats.error}</div>
  {:else if stats.loading && !stats.data}
    <div class="skel">Loading…</div>
  {:else if stats.data}
    <div class="total">
      <span class="total-count" class:has-errors={stats.data.totalErrors > 0}>{stats.data.totalErrors}</span>
      <span class="total-label">errors in window</span>
    </div>
    {#if stats.data.groups.length === 0}
      <div class="empty">No failures</div>
    {:else}
      <ul class="groups">
        {#each stats.data.groups as g (g.signature)}
          {@const isOpen = !!expanded[g.signature]}
          <li>
            <button class="grow" onclick={() => toggle(g.signature)}>
              <span class="count">{g.count}×</span>
              <span class="sig" title={g.signature}>{g.signature}</span>
              <span class="when">{formatRelative(new Date(g.lastSeen))}</span>
            </button>
            <div class="err-bar" style="width: {(g.count / maxCount) * 100}%"></div>
            <div class="affected">on {g.affectedNodeLabels.join(', ')}</div>
            {#if isOpen}
              <ul class="recent">
                {#each g.recent as r, i (r.runId + '|' + r.nodeId + '|' + i)}
                  <li>
                    <span class="rid">{r.runId.slice(0, 8)}</span>
                    <span class="nl">{r.nodeLabel}</span>
                    <span class="at">{formatRelative(new Date(r.at))}</span>
                    <button class="jump" onclick={() => onnodeclick?.(r.nodeId)}>open</button>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .ee {
    display: flex; flex-direction: column; gap: 6px; padding: 10px;
    width: 100%; height: 100%;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 8px;
    font: 11px / 1.4 var(--font-mono);
    color: var(--text-primary);
    overflow: hidden;
  }
  .hd { display: flex; justify-content: space-between; align-items: center; }
  .title { font-weight: 600; font-size: 12px; }
  .refresh { background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 0 4px; }
  .total { display: flex; align-items: baseline; gap: 6px; }
  .total-count { font-size: 18px; font-weight: 500; color: var(--text-muted); line-height: 1; }
  .total-count.has-errors { color: var(--status-error); }
  .total-label { color: var(--text-ghost); font-size: 10px; }
  .groups { list-style: none; padding: 0; margin: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
  .grow {
    background: transparent; border: none; border-left: 3px solid var(--status-error); color: inherit; font: inherit;
    display: grid; grid-template-columns: 40px 1fr 60px; gap: 6px; align-items: center;
    width: 100%; padding: 4px; padding-left: 6px; cursor: pointer; text-align: left; border-radius: 3px;
  }
  .grow:hover { background: var(--surface-overlay); }
  .err-bar { height: 4px; background: var(--status-error); opacity: 0.55; border-radius: 1px; min-width: 1px; margin-bottom: 2px; }
  .count { font-weight: 700; }
  .sig { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .when, .at { color: var(--text-muted); font-size: 9px; text-align: right; }
  .affected { color: var(--text-muted); font-size: 9px; padding: 0 4px 4px; }
  .recent { list-style: none; padding: 0 4px; margin: 0; display: flex; flex-direction: column; gap: 2px; }
  .recent li { display: grid; grid-template-columns: 60px 1fr 50px 40px; gap: 4px; font-size: 9px; }
  .rid { font-family: var(--font-mono); color: var(--text-muted); }
  .nl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .jump { background: transparent; border: 1px solid var(--card-border); color: var(--accent); cursor: pointer; padding: 0 4px; font: inherit; border-radius: 2px; }
  .empty, .skel { color: var(--text-muted); font-style: italic; padding: 8px; text-align: center; }
  .error-strip { color: var(--status-error); font-size: 10px; padding: 4px; border: 1px solid var(--status-error); border-radius: 4px; }
</style>
