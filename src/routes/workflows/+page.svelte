<script lang="ts">
  let { data } = $props();

  function formatDate(d: string | Date) {
    return new Date(d).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function relativeTime(iso: string | null): string {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60000) return 'just now';
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
    if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
    return `${Math.floor(ms / 86400000)}d ago`;
  }

  const TRIGGER_COLORS: Record<string, string> = {
    manual: 'var(--text-ghost)',
    cron: '#569cd6',
    event: '#b8860b',
    webhook: '#2d7d46',
  };

  const STATUS_COLORS: Record<string, string> = {
    completed: '#2d7d46',
    failed: '#b43232',
    running: '#569cd6',
    pending: 'var(--text-ghost)',
  };
</script>

<svelte:head>
  <title>Workflows</title>
</svelte:head>

<div class="p-6 sm:p-10 max-w-5xl mx-auto">
  <div class="flex justify-between items-center mb-8">
    <div>
      <h1 class="display text-[32px] sm:text-[40px]" style="color: var(--text-primary);">
        WORKFLOWS
      </h1>
      <p class="text-sm mt-1" style="color: var(--text-secondary);">
        Visual automation pipelines
      </p>
    </div>
    <div class="flex items-center gap-3">
      <a
        href="/workflows/prompts"
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors border"
        style="border-color: var(--card-border); color: var(--text-secondary);"
      >
        System Prompts
      </a>
      <a
        href="/workflows/new"
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        style="background: var(--accent); color: white;"
      >
        New Workflow
      </a>
    </div>
  </div>

  {#if data.workflows.length === 0}
    <div
      class="text-center py-16 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <p class="text-lg mb-2" style="color: var(--text-secondary);">No workflows yet</p>
      <p class="text-sm" style="color: var(--text-ghost);">
        Create your first workflow to get started.
      </p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      {#each data.workflows as workflow}
        <a
          href="/workflows/{workflow.id}"
          class="group p-5 rounded-xl border transition-colors hover:border-[var(--accent)]"
          style="background: var(--card-bg); border-color: var(--card-border);"
        >
          <div class="flex items-start justify-between mb-2">
            <h2
              class="text-base font-medium group-hover:text-[var(--accent)] transition-colors"
              style="color: var(--text-primary);"
            >
              {workflow.name}
            </h2>
            <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {formatDate(workflow.createdAt)}
            </span>
          </div>

          {#if workflow.description}
            <p class="text-sm line-clamp-2 mb-3" style="color: var(--text-secondary);">
              {workflow.description}
            </p>
          {/if}

          <div class="flex items-center gap-3 mt-2 flex-wrap">
            <!-- Trigger badge -->
            <span
              class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border"
              style="color: {TRIGGER_COLORS[workflow.triggerType] ?? 'var(--text-ghost)'}; border-color: {TRIGGER_COLORS[workflow.triggerType] ?? 'var(--card-border)'}; font-family: var(--font-mono);"
            >
              {workflow.triggerType}
            </span>

            <!-- Node count -->
            <span class="text-[11px]" style="color: var(--text-ghost);">
              {workflow.nodeCount} {workflow.nodeCount === 1 ? 'node' : 'nodes'}
            </span>

            <!-- Last run -->
            {#if workflow.lastRun}
              <span class="flex items-center gap-1.5 text-[11px]" style="color: var(--text-ghost);">
                <span
                  class="w-1.5 h-1.5 rounded-full"
                  style="background: {STATUS_COLORS[workflow.lastRun.status] ?? 'var(--text-ghost)'};"
                ></span>
                {workflow.lastRun.status} · {relativeTime(workflow.lastRun.startedAt ? String(workflow.lastRun.startedAt) : null)}
              </span>
            {:else}
              <span class="text-[11px]" style="color: var(--text-ghost);">never run</span>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
