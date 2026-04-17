<script lang="ts">
  let { data } = $props();
  let workflowList = $state(data.workflows);

  async function deleteWorkflow(id: string, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this workflow?')) return;
    try {
      const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
      if (res.ok) {
        workflowList = workflowList.filter((w) => w.id !== id);
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

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
      <div class="flex items-center gap-3">
        <a href="/jkai" class="back-link">Chat</a>
      </div>
      <h1 class="display text-[32px] sm:text-[40px]" style="color: var(--text-primary);">
        WORKFLOWS
      </h1>
      <p class="text-sm mt-1" style="color: var(--text-secondary);">
        Visual automation pipelines
      </p>
    </div>
    <div class="flex items-center gap-3">
      <a
        href="/jkai/workflows/prompts"
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors border"
        style="border-color: var(--card-border); color: var(--text-secondary);"
      >
        System Prompts
      </a>
      <a
        href="/jkai/workflows/new"
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        style="background: var(--accent); color: white;"
      >
        New Workflow
      </a>
    </div>
  </div>

  {#if workflowList.length === 0}
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
      {#each workflowList as workflow}
        <div
          class="group relative p-5 rounded-xl border transition-colors hover:border-[var(--accent)]"
          style="background: var(--card-bg); border-color: var(--card-border);"
        >
          <a href="/jkai/workflows/{workflow.id}" class="absolute inset-0 z-0" aria-label="View workflow"></a>
          <div class="flex items-start justify-between mb-2">
            <h2
              class="text-base font-medium group-hover:text-[var(--accent)] transition-colors"
              style="color: var(--text-primary);"
            >
              {workflow.name}
            </h2>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
                {formatDate(workflow.createdAt)}
              </span>
              <button
                onclick={(e) => deleteWorkflow(workflow.id, e)}
                class="relative z-10 px-2.5 py-1 rounded-lg border opacity-0 group-hover:opacity-100 transition-all text-xs font-medium"
                style="color: #b43232; border-color: #b43232; background: rgba(180, 50, 50, 0.08);"
                title="Delete workflow"
              >
                Delete
              </button>
            </div>
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
        </div>
      {/each}
    </div>
  {/if}

  <!-- Chat Sessions -->
  {#if data.chatSessions.web.length > 0 || data.chatSessions.whatsapp.length > 0}
    <div class="mt-12">
      <h2 class="display text-[24px] sm:text-[28px] mb-4" style="color: var(--text-primary);">
        CHAT SESSIONS
      </h2>

      <div class="rounded-xl border overflow-hidden" style="background: var(--card-bg); border-color: var(--card-border);">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b" style="border-color: var(--card-border);">
              <th class="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider" style="color: var(--text-ghost); font-family: var(--font-mono);">Channel</th>
              <th class="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider" style="color: var(--text-ghost); font-family: var(--font-mono);">Session</th>
              <th class="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider" style="color: var(--text-ghost); font-family: var(--font-mono);">Last Message</th>
              <th class="text-right px-4 py-2.5 text-[10px] uppercase tracking-wider" style="color: var(--text-ghost); font-family: var(--font-mono);">Messages</th>
              <th class="text-right px-4 py-2.5 text-[10px] uppercase tracking-wider" style="color: var(--text-ghost); font-family: var(--font-mono);">Last Active</th>
            </tr>
          </thead>
          <tbody>
            {#each data.chatSessions.web as session}
              <tr class="border-b transition-colors hover:bg-black/5" style="border-color: var(--card-border);">
                <td class="px-4 py-2.5">
                  <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border" style="color: #569cd6; border-color: #569cd6; font-family: var(--font-mono);">web</span>
                </td>
                <td class="px-4 py-2.5">
                  <a href="/jkai/workflows/{session.workflow_id}" class="text-sm font-medium hover:underline" style="color: var(--text-primary);">
                    {session.workflow_name || 'Untitled'}
                  </a>
                </td>
                <td class="px-4 py-2.5">
                  <span class="text-xs line-clamp-1" style="color: var(--text-secondary); max-width: 300px; display: block;">
                    {session.last_message?.slice(0, 80) || '—'}{session.last_message?.length > 80 ? '...' : ''}
                  </span>
                </td>
                <td class="px-4 py-2.5 text-right">
                  <span class="text-xs" style="color: var(--text-ghost); font-family: var(--font-mono);">{session.message_count}</span>
                </td>
                <td class="px-4 py-2.5 text-right">
                  <span class="text-xs" style="color: var(--text-ghost);">{relativeTime(session.last_message_at)}</span>
                </td>
              </tr>
            {/each}
            {#each data.chatSessions.whatsapp as session}
              <tr class="border-b transition-colors hover:bg-black/5" style="border-color: var(--card-border);">
                <td class="px-4 py-2.5">
                  <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border" style="color: #22c55e; border-color: #22c55e; font-family: var(--font-mono);">whatsapp</span>
                </td>
                <td class="px-4 py-2.5">
                  <span class="text-sm font-medium" style="color: var(--text-primary);">
                    +{session.phone_number}
                  </span>
                </td>
                <td class="px-4 py-2.5">
                  <span class="text-xs line-clamp-1" style="color: var(--text-secondary); max-width: 300px; display: block;">
                    <span style="color: var(--text-ghost);">{session.last_role === 'assistant' ? 'AI: ' : ''}</span>{session.last_message?.slice(0, 80) || '—'}{session.last_message?.length > 80 ? '...' : ''}
                  </span>
                </td>
                <td class="px-4 py-2.5 text-right">
                  <span class="text-xs" style="color: var(--text-ghost); font-family: var(--font-mono);">{session.message_count}</span>
                </td>
                <td class="px-4 py-2.5 text-right">
                  <span class="text-xs" style="color: var(--text-ghost);">{relativeTime(session.last_message_at)}</span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>
