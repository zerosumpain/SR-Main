<script lang="ts">
  import { formatDurationMs, formatRelative } from './format';
  import { formatGbp } from './costFormat';

  interface RecentRun {
    id: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
  }

  interface NodeBar {
    nodeId: string;
    label: string;
    type: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
    error: string | null;
    costUsd: number | null;
  }

  interface TimelineData {
    run: {
      id: string;
      status: string;
      startedAt: string | null;
      completedAt: string | null;
    } | null;
    recent: RecentRun[];
    nodes: NodeBar[];
  }

  interface Props {
    slug: string;
    refreshKey?: number;
    onnodeclick?: (nodeId: string) => void;
  }
  let { slug, refreshKey = 0, onnodeclick }: Props = $props();

  let runId = $state<string | null>(null);
  let data = $state<TimelineData | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      const q = runId ? `?runId=${encodeURIComponent(runId)}` : '';
      const res = await fetch(`/api/canvas/${encodeURIComponent(slug)}/stats/run-timeline${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = (await res.json()) as TimelineData;
      if (!runId && data.run) runId = data.run.id;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    slug; runId; refreshKey;
    load();
  });

  const runDurationMs = $derived.by(() => {
    const r = data?.run;
    if (!r || !r.startedAt) return 0;
    const end = r.completedAt ? new Date(r.completedAt).getTime() : Date.now();
    return Math.max(end - new Date(r.startedAt).getTime(), 1);
  });

  function barLeft(b: NodeBar): number {
    if (!b.startedAt || !data?.run?.startedAt) return 0;
    const offset = new Date(b.startedAt).getTime() - new Date(data.run.startedAt).getTime();
    return (offset / runDurationMs) * 100;
  }
  function barWidth(b: NodeBar): number {
    if (!b.durationMs) return 0.4;
    return Math.max((b.durationMs / runDurationMs) * 100, 0.4);
  }
  function barColour(status: string): string {
    if (status === 'completed') return 'var(--status-success)';
    if (status === 'failed') return 'var(--status-error)';
    if (status === 'running') return '#ffcf40'; /* healing — no token, amber literal */
    return 'var(--text-muted)';
  }
</script>

<div class="rt">
  <header class="hd">
    <span class="title">Run · timeline</span>
    <select
      class="picker"
      value={runId ?? ''}
      onchange={(e) => (runId = (e.currentTarget as HTMLSelectElement).value || null)}
    >
      {#each data?.recent ?? [] as r (r.id)}
        <option value={r.id}>
          {r.status} · {formatDurationMs(r.durationMs)} · {r.startedAt ? formatRelative(new Date(r.startedAt)) : ''}
        </option>
      {/each}
    </select>
  </header>

  {#if error}
    <div class="error-strip">{error}</div>
  {:else if loading && !data}
    <div class="skel">Loading…</div>
  {:else if !data?.run}
    <div class="empty">No runs yet</div>
  {:else if (data.nodes ?? []).length === 0}
    <div class="empty">Run has no node executions</div>
  {:else}
    <div class="gantt">
      {#each data.nodes as n (n.nodeId)}
        <div class="row">
          <div class="rowlabel" title="{n.label} ({n.type})">{n.label}</div>
          <div class="track">
            <button
              class="bar"
              style:left="{barLeft(n)}%"
              style:width="{barWidth(n)}%"
              style:background={barColour(n.status)}
              title="{n.label} · {n.type} · {formatDurationMs(n.durationMs)}{n.costUsd ? ' · ' + formatGbp(n.costUsd) : ''}{n.error ? '\n' + n.error.slice(0, 200) : ''}"
              onclick={() => onnodeclick?.(n.nodeId)}
              aria-label={`${n.label} bar`}
            ></button>
          </div>
          <div class="rowdur">{formatDurationMs(n.durationMs)}</div>
        </div>
      {/each}
    </div>
    <footer class="ft">
      <span>{formatDurationMs(runDurationMs)} total</span>
      <span class="sep">·</span>
      <span>{data.nodes.length} nodes</span>
    </footer>
  {/if}
</div>

<style>
  .rt {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 10px;
    gap: 8px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    font: 11px / 1.4 var(--font-mono);
    color: var(--text-primary);
    overflow: hidden;
  }
  .hd { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .title { font-weight: 600; font-size: 12px; }
  .picker { flex: 1; background: transparent; color: inherit; border: 1px solid var(--card-border); font: inherit; padding: 1px 4px; }
  .gantt { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .row { display: grid; grid-template-columns: 100px 1fr 50px; gap: 6px; align-items: center; }
  .rowlabel { font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
  .track { position: relative; height: 14px; background: var(--bg-section); border-radius: 2px; }
  .bar { position: absolute; top: 0; height: 100%; border: none; cursor: pointer; border-radius: 2px; padding: 0; }
  .bar:hover { filter: brightness(1.15); }
  .rowdur { color: var(--text-muted); font-size: 9px; text-align: right; }
  .ft { display: flex; gap: 6px; color: var(--text-muted); font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; }
  .sep { opacity: 0.5; }
  .empty, .skel { color: var(--text-muted); font-style: italic; padding: 8px; }
  .error-strip { color: var(--status-error); font-size: 10px; padding: 4px; border: 1px solid var(--status-error); border-radius: 4px; }
</style>
