<svelte:head><title>Action Log — Strange Ramblings</title></svelte:head>
<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let expandedId = $state<string | null>(null);
  let filter = $state('all');

  const filtered = $derived(
    filter === 'all'
      ? data.actions
      : data.actions.filter(a => a.actionType === filter)
  );

  const actionTypes = $derived([...new Set(data.actions.map(a => a.actionType))]);

  function typeColor(type: string): string {
    const colors: Record<string, string> = {
      tool_call: '#4a7ab5',
      llm_call: '#8a5ab5',
      message_in: '#3d8b3d',
      message_out: '#b08d3e',
      decision: '#b05a3e',
    };
    return colors[type] ?? '#666';
  }

  function formatDate(d: Date | string | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleString();
  }

  function formatJson(obj: unknown): string {
    if (!obj) return '—';
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }
</script>

<div class="max-w-5xl mx-auto px-6 py-12">
  <div class="flex items-center justify-between mb-10">
    <a href="/admin/agent" class="text-[10px] uppercase tracking-[0.3em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
      &larr; Dashboard
    </a>
    <h1 class="text-lg font-light tracking-wide" style="color: var(--text-primary);">Action Log</h1>
    <span class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
      {filtered.length} actions
    </span>
  </div>

  <!-- Filters -->
  <div class="flex gap-2 mb-6 flex-wrap">
    <button
      class="text-[10px] uppercase tracking-wider px-2 py-1 rounded"
      style="background: {filter === 'all' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)'}; color: var(--text-secondary); font-family: var(--font-mono);"
      onclick={() => filter = 'all'}
    >all</button>
    {#each actionTypes as type}
      <button
        class="text-[10px] uppercase tracking-wider px-2 py-1 rounded"
        style="background: {filter === type ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)'}; color: {typeColor(type)}; font-family: var(--font-mono);"
        onclick={() => filter = type}
      >{type.replace('_', ' ')}</button>
    {/each}
  </div>

  <!-- Actions Table -->
  <div class="space-y-1">
    {#each filtered as action}
      <button
        class="w-full text-left p-3 rounded transition-colors"
        style="background: rgba(255,255,255,0.02); border: 1px solid {expandedId === action.id ? 'rgba(255,255,255,0.1)' : 'transparent'};"
        onclick={() => expandedId = expandedId === action.id ? null : action.id}
      >
        <div class="flex items-center gap-3">
          <span class="text-[10px] uppercase tracking-wider w-20 shrink-0" style="color: {typeColor(action.actionType)}; font-family: var(--font-mono);">
            {action.actionType.replace('_', ' ')}
          </span>
          <span class="text-xs flex-1 truncate" style="color: var(--text-secondary);">
            {action.toolName ?? action.reasoning?.slice(0, 80) ?? '—'}
          </span>
          {#if action.costUsd}
            <span class="text-[10px] shrink-0" style="color: var(--text-ghost); font-family: var(--font-mono);">
              ${action.costUsd.toFixed(4)}
            </span>
          {/if}
          {#if action.durationMs}
            <span class="text-[10px] shrink-0" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {action.durationMs}ms
            </span>
          {/if}
          <span class="text-[10px] shrink-0 w-28 text-right" style="color: var(--text-ghost); font-family: var(--font-mono);">
            {formatDate(action.createdAt)}
          </span>
        </div>

        {#if expandedId === action.id}
          <div class="mt-3 pt-3 space-y-3" style="border-top: 1px solid rgba(255,255,255,0.06);">
            {#if action.reasoning}
              <div>
                <div class="text-[10px] uppercase tracking-wider mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">Reasoning</div>
                <p class="text-xs" style="color: var(--text-secondary);">{action.reasoning}</p>
              </div>
            {/if}

            <div class="grid grid-cols-2 gap-3">
              {#if action.input}
                <div>
                  <div class="text-[10px] uppercase tracking-wider mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">Input</div>
                  <pre class="text-[11px] p-2 rounded overflow-x-auto max-h-48" style="background: rgba(0,0,0,0.3); color: var(--text-secondary); font-family: var(--font-mono);">{formatJson(action.input)}</pre>
                </div>
              {/if}
              {#if action.output}
                <div>
                  <div class="text-[10px] uppercase tracking-wider mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">Output</div>
                  <pre class="text-[11px] p-2 rounded overflow-x-auto max-h-48" style="background: rgba(0,0,0,0.3); color: var(--text-secondary); font-family: var(--font-mono);">{formatJson(action.output)}</pre>
                </div>
              {/if}
            </div>

            {#if action.error}
              <div>
                <div class="text-[10px] uppercase tracking-wider mb-1" style="color: #8b3a3a; font-family: var(--font-mono);">Error</div>
                <p class="text-xs" style="color: #8b3a3a;">{action.error}</p>
              </div>
            {/if}

            <div class="flex gap-4 text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {#if action.provider}<span>{action.provider}/{action.model}</span>{/if}
              {#if action.tokensInput}<span>{action.tokensInput}→{action.tokensOutput} tokens</span>{/if}
              {#if action.sessionId}<span>session: {action.sessionId.slice(0, 8)}...</span>{/if}
              <span>id: {action.id.slice(0, 8)}...</span>
            </div>
          </div>
        {/if}
      </button>
    {/each}
  </div>

  {#if data.actions.length === 0}
    <p class="text-center py-12 text-sm" style="color: var(--text-ghost);">
      No actions recorded yet. Interact with the agent through OpenClaw to see them here.
    </p>
  {/if}
</div>
