<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';

  let { data, id } = $props();

  const prompt: string = data.config?.prompt || '';
  const truncatedPrompt = $derived(
    prompt.length > 40 ? prompt.slice(0, 40) + '…' : prompt,
  );

  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)',
    running: '#e67e22',
    completed: '#27ae60',
    failed: '#e74c3c',
    paused_breakpoint: '#f39c12',
    skipped: 'var(--text-ghost)',
    healing: '#e67e22',
    blocked: '#f39c12',
  };

  let borderColor = $derived(
    data.status ? STATUS_COLORS[data.status] || 'var(--card-border)' : 'var(--card-border)',
  );
  let isRunning = $derived(data.status === 'running');
  let isSkipped = $derived(data.status === 'skipped');
  let isFailed = $derived(data.status === 'failed');
</script>

<div
  class="rounded-lg min-w-[160px] transition-colors"
  style="background: var(--card-bg); border: {data.status && data.status !== 'pending' ? '3px' : '1px'} solid {borderColor}; opacity: {isSkipped ? 0.4 : 1};"
  class:animate-pulse={isRunning}
>
  <Handle type="target" position={Position.Left} id="input" style="top: 30px;" />

  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm">&#x1F9E0;</span>
      <span
        class="text-[10px] uppercase tracking-[0.15em]"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        think
      </span>
      {#if data.status}
        <span class="w-2 h-2 rounded-full ml-auto" style="background: {borderColor};"></span>
      {/if}
    </div>
    <div class="text-sm font-medium mb-2" style="color: var(--text-primary);">
      {data.label}
    </div>
    {#if truncatedPrompt}
      <span
        class="text-[10px] italic block truncate"
        style="color: var(--text-ghost);"
        title={prompt}
      >
        {truncatedPrompt}
      </span>
    {/if}
  </div>

  <Handle type="source" position={Position.Right} id="output" style="top: 30px;" />

  {#if isFailed && data.error}
    <div class="px-3 pb-2">
      <div class="text-[10px] leading-tight px-2 py-1.5 rounded" style="background: rgba(231, 76, 60, 0.1); color: #e74c3c; font-family: var(--font-mono); word-break: break-word;">
        {data.error}
      </div>
    </div>
  {/if}
  {#if isSkipped}
    <div class="px-3 pb-2">
      <span class="text-[10px] uppercase tracking-wider" style="color: var(--text-ghost);">Skipped</span>
    </div>
  {/if}

</div>
