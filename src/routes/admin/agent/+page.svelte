<svelte:head><title>Agent Dashboard — Strange Ramblings</title></svelte:head>
<script lang="ts">
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Live activity feed via SSE
  let liveEvents = $state(data.recentActivity.map(e => ({
    id: e.id,
    eventType: e.eventType,
    summary: e.summary,
    metadata: e.metadata as Record<string, unknown> | null,
    createdAt: e.createdAt?.toISOString?.() ?? new Date().toISOString(),
  })));
  let connected = $state(false);
  let feedEl: HTMLElement;

  onMount(() => {
    const evtSource = new EventSource('/api/agent/activity/stream');

    evtSource.onopen = () => { connected = true; };
    evtSource.onerror = () => { connected = false; };

    evtSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'activity') {
          liveEvents = [event, ...liveEvents].slice(0, 100);
        }
      } catch {}
    };

    return () => evtSource.close();
  });

  const activeTasks = $derived(data.tasks.filter(t => t.status === 'active' || t.status === 'planning'));
  const completedTasks = $derived(data.tasks.filter(t => t.status === 'completed'));
  const failedTasks = $derived(data.tasks.filter(t => t.status === 'failed'));

  function statusBadge(status: string): string {
    const colors: Record<string, string> = {
      pending: '#666',
      planning: '#b08d3e',
      active: '#3d8b3d',
      paused: '#666',
      completed: '#2d6b2d',
      failed: '#8b3a3a',
    };
    return colors[status] ?? '#666';
  }

  function eventIcon(type: string): string {
    const icons: Record<string, string> = {
      task_created: '+',
      step_started: '>',
      tool_started: '...',
      tool_completed: 'ok',
      message_in: '<-',
      message_out: '->',
      decision: '?',
      error: '!',
      research_progress: '~',
    };
    return icons[type] ?? '*';
  }

  function timeAgo(dateStr: string): string {
    const ms = Date.now() - new Date(dateStr).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
</script>

<div class="max-w-4xl mx-auto px-6 py-12">
  <!-- Header -->
  <div class="flex items-center justify-between mb-10">
    <a href="/admin" class="text-[10px] uppercase tracking-[0.3em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
      &larr; Admin
    </a>
    <h1 class="text-lg font-light tracking-wide" style="color: var(--text-primary);">
      Agent Dashboard
    </h1>
    <span class="text-[10px] uppercase tracking-wider" style="color: {connected ? '#3d8b3d' : '#8b3a3a'}; font-family: var(--font-mono);">
      {connected ? 'live' : 'offline'}
    </span>
  </div>

  <!-- Stats Row -->
  <div class="grid grid-cols-4 gap-4 mb-10">
    <div class="p-4 rounded-lg" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
      <div class="text-[10px] uppercase tracking-wider mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">Active Tasks</div>
      <div class="text-2xl font-light" style="color: var(--text-primary);">{activeTasks.length}</div>
    </div>
    <div class="p-4 rounded-lg" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
      <div class="text-[10px] uppercase tracking-wider mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">Completed</div>
      <div class="text-2xl font-light" style="color: var(--text-primary);">{completedTasks.length}</div>
    </div>
    <div class="p-4 rounded-lg" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
      <div class="text-[10px] uppercase tracking-wider mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">Today's Cost</div>
      <div class="text-2xl font-light" style="color: var(--text-primary);">${(data.todayCosts?.totalCost ?? 0).toFixed(4)}</div>
    </div>
    <div class="p-4 rounded-lg" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
      <div class="text-[10px] uppercase tracking-wider mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">Actions Today</div>
      <div class="text-2xl font-light" style="color: var(--text-primary);">{data.todayCosts?.actionCount ?? 0}</div>
    </div>
  </div>

  <!-- Navigation -->
  <div class="flex gap-4 mb-8">
    <a href="/admin/agent/tasks" class="text-xs tracking-wider px-3 py-1.5 rounded" style="color: var(--text-secondary); background: rgba(255,255,255,0.05); font-family: var(--font-mono);">
      Tasks
    </a>
    <a href="/admin/agent/actions" class="text-xs tracking-wider px-3 py-1.5 rounded" style="color: var(--text-secondary); background: rgba(255,255,255,0.05); font-family: var(--font-mono);">
      Action Log
    </a>
    <a href="/admin/agent/costs" class="text-xs tracking-wider px-3 py-1.5 rounded" style="color: var(--text-secondary); background: rgba(255,255,255,0.05); font-family: var(--font-mono);">
      Costs
    </a>
  </div>

  <!-- Active Tasks -->
  {#if activeTasks.length > 0}
    <div class="mb-10">
      <h2 class="text-[11px] uppercase tracking-[0.2em] mb-4" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Active Tasks
      </h2>
      <div class="space-y-3">
        {#each activeTasks as task}
          <div class="p-4 rounded-lg" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm" style="color: var(--text-primary);">{task.title}</span>
              <span class="text-[10px] px-2 py-0.5 rounded" style="background: {statusBadge(task.status)}22; color: {statusBadge(task.status)}; font-family: var(--font-mono);">
                {task.status}
              </span>
            </div>
            {#if task.description}
              <p class="text-xs mb-2" style="color: var(--text-ghost);">{task.description.slice(0, 200)}</p>
            {/if}
            {#if Array.isArray(task.steps) && task.steps.length > 0}
              <div class="flex gap-1 mt-2">
                {#each task.steps as step, i}
                  <div
                    class="h-1.5 rounded-full flex-1"
                    style="background: {i < (task.currentStep ?? 0) ? '#3d8b3d' : i === (task.currentStep ?? 0) ? '#b08d3e' : 'rgba(255,255,255,0.1)'};"
                  ></div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Live Activity Feed -->
  <div>
    <h2 class="text-[11px] uppercase tracking-[0.2em] mb-4" style="color: var(--text-ghost); font-family: var(--font-mono);">
      Activity Feed
    </h2>
    <div bind:this={feedEl} class="space-y-1 max-h-[500px] overflow-y-auto" style="scrollbar-width: thin;">
      {#each liveEvents as event}
        <div class="flex items-start gap-3 py-2 px-3 rounded" style="background: rgba(255,255,255,0.02);">
          <span class="text-[10px] shrink-0 w-6 text-center rounded" style="color: var(--text-ghost); font-family: var(--font-mono); background: rgba(255,255,255,0.05);">
            {eventIcon(event.eventType)}
          </span>
          <span class="text-xs flex-1" style="color: var(--text-secondary);">
            {event.summary}
          </span>
          <span class="text-[10px] shrink-0" style="color: var(--text-ghost); font-family: var(--font-mono);">
            {timeAgo(event.createdAt)}
          </span>
        </div>
      {:else}
        <p class="text-xs py-8 text-center" style="color: var(--text-ghost);">
          No activity yet. Send a message through OpenClaw to see it here.
        </p>
      {/each}
    </div>
  </div>
</div>
