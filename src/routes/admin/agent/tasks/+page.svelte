<svelte:head><title>Agent Tasks — Admin</title></svelte:head>
<script lang="ts">
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
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

  function fmtDate(d: Date | string | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleString();
  }
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="Agent"
    title="Tasks"
    sub="Pending, planning, active, completed, paused, failed — every task the agent has been asked to run."
  />

  {#if data.tasks.length === 0}
    <div class="nm-empty">No tasks yet. Use /research or /tasks via OpenClaw to create one.</div>
  {:else}
    {#each Object.entries(groups) as [status, tasks]}
      {#if tasks.length > 0}
        <section class="nm-sec">
          <div class="nm-sec-hd">
            <span class="sr-label-tight">{status}</span>
            <span class="nm-pill" data-state={status}>{tasks.length}</span>
          </div>
          <div class="task-list">
            {#each tasks as task}
              <div class="task-card">
                <button class="task-head" onclick={() => expandedId = expandedId === task.id ? null : task.id}>
                  <span class="caret">{expandedId === task.id ? '▾' : '▸'}</span>
                  <span class="task-title">{task.title}</span>
                  {#if task.originChannel}
                    <span class="nm-pill">{task.originChannel}</span>
                  {/if}
                  <span class="task-date">{fmtDate(task.createdAt)}</span>
                </button>

                {#if Array.isArray(task.steps) && task.steps.length > 0}
                  <div class="step-bar">
                    {#each task.steps as _, i}
                      <div class="step-seg" data-state={i < (task.currentStep ?? 0) ? 'done' : i === (task.currentStep ?? 0) && task.status === 'active' ? 'current' : 'pending'}></div>
                    {/each}
                  </div>
                {/if}

                {#if expandedId === task.id}
                  <div class="task-body">
                    {#if task.description}<p class="task-desc">{task.description}</p>{/if}
                    {#if Array.isArray(task.steps) && task.steps.length > 0}
                      <ol class="step-list">
                        {#each task.steps as step, i}
                          {@const s = step as { label: string; status: string }}
                          <li data-state={i < (task.currentStep ?? 0) ? 'done' : i === (task.currentStep ?? 0) ? 'current' : 'pending'}>
                            {s.label ?? String(step)}
                          </li>
                        {/each}
                      </ol>
                    {/if}
                    {#if task.result}
                      <div class="result">
                        <span class="sr-label-tight">Result</span>
                        <p>{task.result}</p>
                      </div>
                    {/if}
                    <div class="meta-line">
                      <span>id: {task.id.slice(0, 12)}…</span>
                      {#if task.completedAt}<span>completed {fmtDate(task.completedAt)}</span>{/if}
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {/if}
    {/each}
  {/if}
</PageWrap>

<style>
  .task-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .task-card {
    background: var(--bg);
    border: 1px solid var(--card-border);
    padding: 0.65rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .task-head {
    display: flex; align-items: center; gap: 0.6rem;
    width: 100%;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-align: left;
    color: inherit;
  }
  .caret { font-size: 9px; color: var(--text-ghost); width: 0.8rem; }
  .task-title { font-size: 0.92rem; color: var(--text-primary); font-weight: 500; flex: 1; }
  .task-date {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
  }
  .step-bar { display: flex; gap: 2px; }
  .step-seg { flex: 1; height: 2px; background: var(--card-border); }
  .step-seg[data-state="done"] { background: #2d7a3a; }
  .step-seg[data-state="current"] { background: var(--accent); }

  .task-body { padding-top: 0.4rem; border-top: 1px solid var(--divider); display: flex; flex-direction: column; gap: 0.55rem; }
  .task-desc { margin: 0; font-size: 0.85rem; color: var(--text-secondary); }
  .step-list {
    margin: 0;
    padding-left: 1.2rem;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .step-list li[data-state="done"] { color: #2d7a3a; }
  .step-list li[data-state="current"] { color: var(--accent); }
  .step-list li[data-state="pending"] { color: var(--text-ghost); }

  .result {
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    padding: 0.55rem 0.7rem;
  }
  .result p { margin: 0.2rem 0 0; font-size: 0.85rem; color: var(--text-secondary); }
  .meta-line {
    display: flex;
    gap: 1rem;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
  }
</style>
