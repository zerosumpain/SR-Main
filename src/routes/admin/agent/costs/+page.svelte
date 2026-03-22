<svelte:head><title>Agent Costs — Strange Ramblings</title></svelte:head>
<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<div class="max-w-4xl mx-auto px-6 py-12">
  <div class="flex items-center justify-between mb-10">
    <a href="/admin/agent" class="text-[10px] uppercase tracking-[0.3em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
      &larr; Dashboard
    </a>
    <h1 class="text-lg font-light tracking-wide" style="color: var(--text-primary);">Cost Tracking</h1>
    <span></span>
  </div>

  <!-- Period Summary -->
  <div class="grid grid-cols-3 gap-4 mb-10">
    <div class="p-5 rounded-lg" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
      <div class="text-[10px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">Today</div>
      <div class="text-2xl font-light mb-1" style="color: var(--text-primary);">${(data.today?.cost ?? 0).toFixed(4)}</div>
      <div class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">{data.today?.count ?? 0} actions</div>
    </div>
    <div class="p-5 rounded-lg" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
      <div class="text-[10px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">This Week</div>
      <div class="text-2xl font-light mb-1" style="color: var(--text-primary);">${(data.week?.cost ?? 0).toFixed(4)}</div>
      <div class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">{data.week?.count ?? 0} actions</div>
    </div>
    <div class="p-5 rounded-lg" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
      <div class="text-[10px] uppercase tracking-wider mb-2" style="color: var(--text-ghost); font-family: var(--font-mono);">30 Days</div>
      <div class="text-2xl font-light mb-1" style="color: var(--text-primary);">${(data.month?.cost ?? 0).toFixed(4)}</div>
      <div class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">{data.month?.count ?? 0} actions</div>
    </div>
  </div>

  <!-- Token Summary -->
  {#if (data.today?.tokensIn ?? 0) > 0}
    <div class="mb-10 p-4 rounded-lg" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
      <div class="text-[10px] uppercase tracking-wider mb-3" style="color: var(--text-ghost); font-family: var(--font-mono);">Today's Tokens</div>
      <div class="flex gap-8">
        <div>
          <div class="text-lg font-light" style="color: var(--text-primary);">{(data.today?.tokensIn ?? 0).toLocaleString()}</div>
          <div class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">input</div>
        </div>
        <div>
          <div class="text-lg font-light" style="color: var(--text-primary);">{(data.today?.tokensOut ?? 0).toLocaleString()}</div>
          <div class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">output</div>
        </div>
      </div>
    </div>
  {/if}

  <!-- By Model -->
  {#if data.byModel.length > 0}
    <div class="mb-10">
      <h2 class="text-[11px] uppercase tracking-[0.2em] mb-4" style="color: var(--text-ghost); font-family: var(--font-mono);">
        By Model (30 days)
      </h2>
      <div class="space-y-2">
        {#each data.byModel as m}
          <div class="flex items-center gap-3 p-3 rounded" style="background: rgba(255,255,255,0.02);">
            <span class="text-xs flex-1" style="color: var(--text-secondary);">
              {m.provider ?? '?'}/{m.model ?? '?'}
            </span>
            <span class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {m.count} calls
            </span>
            <span class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {(m.tokensIn + m.tokensOut).toLocaleString()} tokens
            </span>
            <span class="text-xs font-mono" style="color: var(--text-primary);">
              ${m.cost.toFixed(4)}
            </span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- By Tool -->
  {#if data.byTool.length > 0}
    <div class="mb-10">
      <h2 class="text-[11px] uppercase tracking-[0.2em] mb-4" style="color: var(--text-ghost); font-family: var(--font-mono);">
        By Tool (30 days)
      </h2>
      <div class="space-y-2">
        {#each data.byTool as t}
          <div class="flex items-center gap-3 p-3 rounded" style="background: rgba(255,255,255,0.02);">
            <span class="text-xs flex-1" style="color: var(--text-secondary);">
              {t.toolName ?? 'unknown'}
            </span>
            <span class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {t.count} calls
            </span>
            <span class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              avg {Math.round(t.avgMs)}ms
            </span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if data.byModel.length === 0 && data.byTool.length === 0}
    <p class="text-center py-12 text-sm" style="color: var(--text-ghost);">
      No cost data yet. Interact with the agent to start tracking.
    </p>
  {/if}
</div>
