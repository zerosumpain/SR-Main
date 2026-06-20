<svelte:head><title>Agent Dashboard — Admin</title></svelte:head>
<script lang="ts">
  import { onMount } from 'svelte';
  import { getContext } from 'svelte';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { dur } from '$lib/motion';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const adminToken = getContext<string>('adminToken');
  const t = adminToken ? `?token=${adminToken}` : '';

  let liveEvents = $state(data.recentActivity.map(e => ({
    id: e.id,
    eventType: e.eventType,
    summary: e.summary,
    metadata: e.metadata as Record<string, unknown> | null,
    createdAt: e.createdAt?.toISOString?.() ?? new Date().toISOString(),
  })));
  let connected = $state(false);
  // Gate enter-animations so only events that stream in *after* the initial
  // render fly in — otherwise the seeded backlog all animates at once on load.
  let mounted = $state(false);

  onMount(() => {
    mounted = true;
    const evtSource = new EventSource('/api/agent/activity/stream');
    evtSource.onopen = () => { connected = true; };
    evtSource.onerror = () => { connected = false; };
    evtSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'activity' && !liveEvents.some((x) => x.id === event.id)) {
          liveEvents = [event, ...liveEvents].slice(0, 100);
        }
      } catch {}
    };
    return () => evtSource.close();
  });

  const activeTasks = $derived(data.tasks.filter(t => t.status === 'active' || t.status === 'planning'));
  const completedTasks = $derived(data.tasks.filter(t => t.status === 'completed'));

  function eventIcon(type: string): string {
    const icons: Record<string, string> = {
      task_created: '+',
      step_started: '>',
      tool_started: '·',
      tool_completed: '✓',
      message_in: '←',
      message_out: '→',
      decision: '?',
      error: '!',
      research_progress: '~',
    };
    return icons[type] ?? '•';
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

<PageWrap width="wide">
  <PageHeader
    kicker="Agent"
    title="JKAI Dashboard"
    sub="Live activity stream, active tasks, daily spend. Drill into Tasks / Actions / Costs / Config from the sidebar."
  >
    {#snippet actions()}
      <span class="nm-pill" data-state={connected ? 'connected' : 'error'}>
        {connected ? 'live' : 'offline'}
      </span>
    {/snippet}
  </PageHeader>

  <div class="stat-grid">
    <div class="stat-card">
      <div class="stat-card-label">Active Tasks</div>
      <div class="stat-card-value">{activeTasks.length}</div>
      <div class="stat-card-meta"><a class="nm-link-btn" href={`/admin/agent/tasks${t}`}>View all →</a></div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Completed</div>
      <div class="stat-card-value">{completedTasks.length}</div>
      <div class="stat-card-meta">to date</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Today's Cost</div>
      <div class="stat-card-value">${(data.todayCosts?.totalCost ?? 0).toFixed(4)}</div>
      <div class="stat-card-meta"><a class="nm-link-btn" href={`/admin/agent/costs${t}`}>Costs →</a></div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Actions Today</div>
      <div class="stat-card-value">{data.todayCosts?.actionCount ?? 0}</div>
      <div class="stat-card-meta"><a class="nm-link-btn" href={`/admin/agent/actions${t}`}>Action log →</a></div>
    </div>
  </div>

  <div class="agent-grid">
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Active Tasks</span>
        <span class="nm-sec-meta">{activeTasks.length}</span>
      </div>

      {#if activeTasks.length === 0}
        <div class="nm-empty">No active tasks. Send a message via OpenClaw to spin one up.</div>
      {:else}
        <div class="task-list">
          {#each activeTasks as task}
            <div class="task-card">
              <div class="task-head">
                <span class="task-title">{task.title}</span>
                <span class="nm-pill" data-state={task.status}>{task.status}</span>
              </div>
              {#if task.description}
                <p class="task-desc">{task.description.slice(0, 220)}</p>
              {/if}
              {#if Array.isArray(task.steps) && task.steps.length > 0}
                <div class="step-bar">
                  {#each task.steps as _, i}
                    <div
                      class="step-seg"
                      data-state={i < (task.currentStep ?? 0) ? 'done' : i === (task.currentStep ?? 0) ? 'current' : 'pending'}
                    ></div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Activity Feed</span>
        <span class="nm-sec-meta">last 100</span>
      </div>

      <div class="feed">
        {#each liveEvents as event (event.id)}
          <div
            class="feed-row"
            in:fly={{ y: -6, duration: mounted ? dur(160) : 0 }}
            animate:flip={{ duration: dur(180) }}
          >
            <span class="feed-icon">{eventIcon(event.eventType)}</span>
            <span class="feed-summary">{event.summary}</span>
            <span class="feed-time">{timeAgo(event.createdAt)}</span>
          </div>
        {:else}
          <div class="nm-empty">No activity yet. Send a message through OpenClaw to see it here.</div>
        {/each}
      </div>
    </section>
  </div>
</PageWrap>

<style>
  .agent-grid {
    display: grid;
    gap: 0.85rem;
    grid-template-columns: minmax(260px, 1fr) minmax(320px, 1.4fr);
  }
  .agent-grid :global(.nm-sec) { margin-bottom: 0; }
  @media (max-width: 880px) {
    .agent-grid { grid-template-columns: 1fr; }
  }

  .task-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .task-card {
    background: var(--bg);
    border: 1px solid var(--card-border);
    padding: 0.7rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .task-head { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; }
  .task-title {
    font-size: 0.92rem;
    color: var(--text-primary);
    font-weight: 500;
  }
  .task-desc {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text-secondary);
  }
  .step-bar { display: flex; gap: 3px; }
  .step-seg { flex: 1; height: 3px; background: var(--card-border); }
  .step-seg[data-state="done"] { background: var(--success); }
  .step-seg[data-state="current"] { background: var(--accent); }

  .feed {
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-height: 540px;
    overflow-y: auto;
  }
  .feed-row {
    display: grid;
    grid-template-columns: 22px 1fr auto;
    gap: 0.5rem;
    align-items: center;
    padding: 0.4rem 0.5rem;
    background: var(--bg);
    font-size: 0.82rem;
  }
  .feed-row + .feed-row { border-top: 1px solid var(--divider); }
  .feed-icon {
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent);
  }
  .feed-summary { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .feed-time {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
  }
</style>
