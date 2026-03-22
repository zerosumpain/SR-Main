<svelte:head><title>Agent Tasks — Strange Ramblings</title></svelte:head>
<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const groups = $derived({
    active: data.tasks.filter(t => t.status === 'active' || t.status === 'planning'),
    pending: data.tasks.filter(t => t.status === 'pending'),
    completed: data.tasks.filter(t => t.status === 'completed'),
    failed: data.tasks.filter(t => t.status === 'failed'),
    paused: data.tasks.filter(t => t.status === 'paused'),
  });

  let expandedId = $state<string | null>(null);

  function statusColor(status: string): string {
    const colors: Record<string, string> = {
      pending: '#666', planning: '#b08d3e', active: '#3d8b3d',
      paused: '#666', completed: '#2d6b2d', failed: '#8b3a3a',
    };
    return colors[status] ?? '#666';
  }

  function formatDate(d: Date | string | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleString();
  }
</script>

<div class="max-w-4xl mx-auto px-6 py-12">
  <div class="flex items-center justify-between mb-10">
    <a href="/admin/agent" class="text-[10px] uppercase tracking-[0.3em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
      &larr; Dashboard
    </a>
    <h1 class="text-lg font-light tracking-wide" style="color: var(--text-primary);">Tasks</h1>
    <span></span>
  </div>

  {#each Object.entries(groups) as [status, tasks]}
    {#if tasks.length > 0}
      <div class="mb-8">
        <h2 class="text-[11px] uppercase tracking-[0.2em] mb-3 flex items-center gap-2" style="color: var(--text-ghost); font-family: var(--font-mono);">
          <span class="w-2 h-2 rounded-full" style="background: {statusColor(status)};"></span>
          {status} ({tasks.length})
        </h2>
        <div class="space-y-2">
          {#each tasks as task}
            <button
              class="w-full text-left p-4 rounded-lg transition-colors"
              style="background: var(--card-bg); border: 1px solid var(--card-border);"
              onclick={() => expandedId = expandedId === task.id ? null : task.id}
            >
              <div class="flex items-center justify-between">
                <span class="text-sm" style="color: var(--text-primary);">{task.title}</span>
                <div class="flex items-center gap-3">
                  {#if task.originChannel}
                    <span class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
                      {task.originChannel}
                    </span>
                  {/if}
                  <span class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
                    {formatDate(task.createdAt)}
                  </span>
                </div>
              </div>

              {#if Array.isArray(task.steps) && task.steps.length > 0}
                <div class="flex gap-1 mt-3">
                  {#each task.steps as _, i}
                    <div
                      class="h-1 rounded-full flex-1"
                      style="background: {i < (task.currentStep ?? 0) ? '#3d8b3d' : i === (task.currentStep ?? 0) && task.status === 'active' ? '#b08d3e' : 'var(--card-border)'};"
                    ></div>
                  {/each}
                </div>
              {/if}

              {#if expandedId === task.id}
                <div class="mt-4 pt-4" style="border-top: 1px solid var(--card-border);">
                  {#if task.description}
                    <p class="text-xs mb-3" style="color: var(--text-secondary);">{task.description}</p>
                  {/if}
                  {#if Array.isArray(task.steps) && task.steps.length > 0}
                    <div class="space-y-1">
                      {#each task.steps as step, i}
                        {@const s = step as { label: string; status: string }}
                        <div class="flex items-center gap-2 text-xs" style="color: var(--text-ghost);">
                          <span style="color: {i < (task.currentStep ?? 0) ? '#3d8b3d' : 'var(--text-ghost)'};">
                            {i < (task.currentStep ?? 0) ? 'done' : i === (task.currentStep ?? 0) ? '>' : ' '}
                          </span>
                          <span>{s.label ?? String(step)}</span>
                        </div>
                      {/each}
                    </div>
                  {/if}
                  {#if task.result}
                    <div class="mt-3 p-2 rounded text-xs" style="background: var(--card-bg); color: var(--text-secondary);">
                      <span class="text-[10px] uppercase" style="color: var(--text-ghost);">Result:</span>
                      <p class="mt-1">{task.result}</p>
                    </div>
                  {/if}
                  <div class="mt-3 text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
                    ID: {task.id}
                    {#if task.completedAt} | Completed: {formatDate(task.completedAt)}{/if}
                  </div>
                </div>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  {/each}

  {#if data.tasks.length === 0}
    <p class="text-center py-12 text-sm" style="color: var(--text-ghost);">
      No tasks yet. Use /research or /tasks via OpenClaw to create one.
    </p>
  {/if}
</div>
