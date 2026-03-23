<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { PageData } from './$types';

  let { data } = $props();
  let activeTab = $state<'activity' | 'iterations' | 'preview' | 'controls'>('activity');
  let logs = $state(data.logs);
  let build = $state(data.build);
  let eventSource: EventSource | null = null;
  let logContainer: HTMLDivElement;

  onMount(() => {
    if (build.status === 'running') {
      connectSSE();
    }
  });

  onDestroy(() => {
    eventSource?.close();
  });

  function connectSSE() {
    eventSource = new EventSource(`/api/jkai/builds/${build.id}/stream`);

    eventSource.onmessage = (e) => {
      const log = JSON.parse(e.data);
      logs = [...logs, { ...log, id: parseInt(e.lastEventId) }];
      requestAnimationFrame(() => {
        logContainer?.scrollTo({ top: logContainer.scrollHeight, behavior: 'smooth' });
      });
    };

    eventSource.onerror = () => {
      eventSource?.close();
      setTimeout(connectSSE, 3000);
    };
  }

  // Poll build data to keep counters fresh
  let pollTimer: ReturnType<typeof setInterval>;
  onMount(() => {
    pollTimer = setInterval(async () => {
      if (build.status !== 'running') return;
      try {
        const res = await fetch(`/api/jkai/builds/${build.id}`);
        if (res.ok) {
          const fresh = await res.json();
          build = { ...fresh };
        }
      } catch {}
    }, 10000);
  });
  onDestroy(() => clearInterval(pollTimer));

  async function controlAction(action: 'pause' | 'resume' | 'stop') {
    const res = await fetch(`/api/jkai/builds/${build.id}/${action}`, { method: 'POST' });
    if (res.ok) {
      const statusMap = { pause: 'paused', resume: 'running', stop: 'completed' } as const;
      build = { ...build, status: statusMap[action] };

      if (action === 'resume') connectSSE();
      if (action === 'pause' || action === 'stop') eventSource?.close();
    }
  }

  function logTypeColor(type: string): string {
    const colors: Record<string, string> = {
      system: 'var(--text-ghost)',
      text: 'var(--text-primary)',
      code: '#6a9955',
      output: '#569cd6',
      error: '#f44747',
      thinking: 'var(--text-ghost)',
    };
    return colors[type] || 'var(--text-primary)';
  }

  function budgetPercent(used: number, config: any, key: string): number | null {
    const max = config?.[key];
    if (!max) return null;
    return Math.min(100, (used / max) * 100);
  }
</script>

<svelte:head>
  <title>{build.title || 'Build'} — JKAI</title>
</svelte:head>

<div class="p-6 sm:p-10 max-w-5xl mx-auto">
  <div class="mb-6">
    <a href="/jkai" class="text-sm mb-3 inline-block" style="color: var(--text-ghost);">&larr; Builds</a>
    <div class="flex items-start justify-between">
      <div>
        <h1 class="display text-[24px] sm:text-[32px]" style="color: var(--text-primary);">
          {build.title || build.prompt.slice(0, 60)}
        </h1>
        <p class="text-sm mt-1 max-w-xl" style="color: var(--text-secondary);">{build.prompt}</p>
      </div>
      <span
        class="text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded shrink-0"
        style="font-family: var(--font-mono); background: rgba(100,100,100,0.1); color: var(--text-ghost);"
      >
        {build.status}
        {#if build.status === 'running'}
          <span class="inline-block w-1.5 h-1.5 rounded-full ml-1 animate-pulse" style="background: #2d7d46;"></span>
        {/if}
      </span>
    </div>
  </div>

  <div class="flex gap-1 mb-4 border-b" style="border-color: var(--card-border);">
    {#each ['activity', 'iterations', 'preview', 'controls'] as tab}
      <button
        onclick={() => activeTab = tab as any}
        class="px-4 py-2 text-sm capitalize transition-colors"
        style="color: {activeTab === tab ? 'var(--accent)' : 'var(--text-ghost)'}; border-bottom: 2px solid {activeTab === tab ? 'var(--accent)' : 'transparent'};"
      >
        {tab}
      </button>
    {/each}
  </div>

  {#if activeTab === 'activity'}
    <div
      bind:this={logContainer}
      class="rounded-lg border p-4 overflow-y-auto"
      style="background: var(--card-bg); border-color: var(--card-border); max-height: 70vh; font-family: var(--font-mono); font-size: 12px; line-height: 1.6;"
    >
      {#if logs.length === 0}
        <p style="color: var(--text-ghost);">No activity yet...</p>
      {:else}
        {#each logs as log}
          <div class="mb-1" style="color: {logTypeColor(log.type)};">
            {#if log.type === 'code'}
              <pre class="whitespace-pre-wrap bg-black/5 p-2 rounded my-1">{log.content}</pre>
            {:else if log.type === 'output'}
              <pre class="whitespace-pre-wrap bg-blue-500/5 p-2 rounded my-1">{log.content}</pre>
            {:else if log.type === 'error'}
              <pre class="whitespace-pre-wrap bg-red-500/5 p-2 rounded my-1">{log.content}</pre>
            {:else}
              <p class="whitespace-pre-wrap">{log.content}</p>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

  {:else if activeTab === 'iterations'}
    <div class="space-y-3">
      {#if data.iterations.length === 0}
        <p class="text-sm" style="color: var(--text-ghost);">No iterations completed yet.</p>
      {/if}
      {#each data.iterations as iter}
        <details class="rounded-lg border p-4" style="background: var(--card-bg); border-color: var(--card-border);">
          <summary class="cursor-pointer flex items-center justify-between">
            <span class="text-sm font-medium" style="color: var(--text-primary);">
              Iteration #{iter.number}
              <span class="text-[10px] uppercase ml-2 px-1.5 py-0.5 rounded"
                style="font-family: var(--font-mono); background: rgba(100,100,100,0.1); color: var(--text-ghost);">
                {iter.status}
              </span>
            </span>
            <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {iter.durationMs ? `${(iter.durationMs / 1000).toFixed(0)}s` : '...'} · {iter.tokensUsed} tokens
            </span>
          </summary>

          <div class="mt-3 space-y-3 text-sm" style="color: var(--text-secondary);">
            {#if iter.goals}
              <div>
                <h4 class="text-xs uppercase tracking-wider mb-1" style="color: var(--text-ghost);">Goals</h4>
                <p class="whitespace-pre-wrap">{iter.goals}</p>
              </div>
            {/if}
            {#if iter.evaluation}
              <div>
                <h4 class="text-xs uppercase tracking-wider mb-1" style="color: var(--text-ghost);">Evaluation</h4>
                <p class="whitespace-pre-wrap">{iter.evaluation}</p>
              </div>
            {/if}
            {#if iter.nextSteps}
              <div>
                <h4 class="text-xs uppercase tracking-wider mb-1" style="color: var(--text-ghost);">Next Steps</h4>
                <p class="whitespace-pre-wrap">{iter.nextSteps}</p>
              </div>
            {/if}
            {#if Array.isArray(iter.actions) && iter.actions.length > 0}
              <div>
                <h4 class="text-xs uppercase tracking-wider mb-1" style="color: var(--text-ghost);">Actions ({iter.actions.length})</h4>
                {#each iter.actions as action}
                  <pre class="whitespace-pre-wrap bg-black/5 p-2 rounded my-1 text-xs" style="font-family: var(--font-mono);">{action.code}</pre>
                {/each}
              </div>
            {/if}
          </div>
        </details>
      {/each}
    </div>

  {:else if activeTab === 'preview'}
    {#if build.serveConfig}
      <iframe
        src="/api/jkai/proxy/{build.id}/"
        class="w-full rounded-lg border"
        style="height: 70vh; border-color: var(--card-border);"
        title="Project preview"
      ></iframe>
    {:else}
      <div class="text-center py-16 rounded-lg border" style="background: var(--card-bg); border-color: var(--card-border);">
        <p class="text-sm" style="color: var(--text-ghost);">
          Project is not serving yet. The build will create a serve.json when it's ready.
        </p>
      </div>
    {/if}

  {:else if activeTab === 'controls'}
    <div class="space-y-6 max-w-md">
      <div class="p-4 rounded-lg border" style="background: var(--card-bg); border-color: var(--card-border);">
        <h3 class="text-sm font-medium mb-3" style="color: var(--text-secondary);">Actions</h3>
        <div class="flex gap-2">
          {#if build.status === 'running'}
            <button onclick={() => controlAction('pause')} class="px-3 py-1.5 rounded text-sm border" style="border-color: var(--card-border);">Pause</button>
            <button onclick={() => controlAction('stop')} class="px-3 py-1.5 rounded text-sm border" style="border-color: #b43232; color: #b43232;">Stop</button>
          {:else if build.status === 'paused'}
            <button onclick={() => controlAction('resume')} class="px-3 py-1.5 rounded text-sm" style="background: var(--accent); color: white;">Resume</button>
            <button onclick={() => controlAction('stop')} class="px-3 py-1.5 rounded text-sm border" style="border-color: #b43232; color: #b43232;">Stop</button>
          {:else}
            <p class="text-sm" style="color: var(--text-ghost);">Build is {build.status}.</p>
          {/if}
        </div>
      </div>

      <div class="p-4 rounded-lg border" style="background: var(--card-bg); border-color: var(--card-border);">
        <h3 class="text-sm font-medium mb-3" style="color: var(--text-secondary);">Budget Usage</h3>
        <div class="space-y-2 text-sm" style="font-family: var(--font-mono);">
          <div class="flex justify-between" style="color: var(--text-ghost);">
            <span>Iterations</span>
            <span>{build.iterationsCompleted}{build.budgetConfig?.maxIterations ? ` / ${build.budgetConfig.maxIterations}` : ''}</span>
          </div>
          <div class="flex justify-between" style="color: var(--text-ghost);">
            <span>Active time</span>
            <span>{build.activeMinutesUsed.toFixed(1)}m{build.budgetConfig?.maxTotalMinutes ? ` / ${build.budgetConfig.maxTotalMinutes}m` : ''}</span>
          </div>
          <div class="flex justify-between" style="color: var(--text-ghost);">
            <span>Tokens</span>
            <span>{build.tokensUsed.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
