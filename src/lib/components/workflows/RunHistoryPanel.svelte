<script lang="ts">
  let {
    workflowId,
    onSelectRun,
    onClose,
  }: {
    workflowId: string;
    onSelectRun: (runId: string) => void;
    onClose: () => void;
  } = $props();

  interface Run {
    id: string;
    status: string;
    trigger: string;
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
  }

  let runs = $state<Run[]>([]);
  let loading = $state(true);

  $effect(() => {
    if (workflowId) loadRuns();
  });

  async function loadRuns() {
    loading = true;
    try {
      const res = await fetch(`/api/workflows/${workflowId}/runs`);
      if (res.ok) runs = await res.json();
    } catch {} finally {
      loading = false;
    }
  }

  const STATUS_COLORS: Record<string, string> = {
    completed: '#2d7d46',
    failed: '#b43232',
    running: '#569cd6',
    pending: 'var(--text-ghost)',
  };

  function formatTime(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    if (diffMs < 60000) return 'just now';
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
    if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function duration(start: string | null, end: string | null): string {
    if (!start || !end) return '';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
</script>

<div class="h-full flex flex-col border-l" style="background: var(--bg); border-color: var(--card-border); width: 360px;">
  <div class="px-4 py-3 border-b flex items-center justify-between" style="border-color: var(--card-border);">
    <h3 class="text-sm font-medium" style="color: var(--text-primary);">Run History</h3>
    <button onclick={onClose} class="text-sm px-2 py-1 rounded hover:bg-black/5" style="color: var(--text-ghost);">Back</button>
  </div>

  <div class="flex-1 overflow-y-auto p-3">
    {#if loading}
      <p class="text-sm animate-pulse" style="color: var(--text-ghost);">Loading...</p>
    {:else if runs.length === 0}
      <p class="text-sm text-center py-8" style="color: var(--text-ghost);">No runs yet</p>
    {:else}
      {#each runs as run}
        <button
          onclick={() => onSelectRun(run.id)}
          class="w-full text-left p-3 rounded-lg border mb-2 transition-colors hover:border-[var(--accent)]"
          style="background: var(--card-bg); border-color: var(--card-border);"
        >
          <div class="flex items-center justify-between mb-1">
            <span class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full" style="background: {STATUS_COLORS[run.status] || 'var(--text-ghost)'};"></span>
              <span class="text-xs uppercase tracking-wider" style="color: var(--text-ghost); font-family: var(--font-mono);">{run.status}</span>
            </span>
            <span class="text-[11px]" style="color: var(--text-ghost);">{formatTime(run.startedAt)}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">{run.trigger}</span>
            {#if run.completedAt}
              <span class="text-[11px]" style="color: var(--text-ghost);">{duration(run.startedAt, run.completedAt)}</span>
            {/if}
          </div>
          {#if run.error}
            <p class="text-xs mt-1 truncate" style="color: #b43232;">{run.error}</p>
          {/if}
        </button>
      {/each}
    {/if}
  </div>
</div>
