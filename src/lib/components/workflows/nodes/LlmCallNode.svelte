<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';

  let { data, id } = $props();

  const model: string = data.config?.model || 'openai/gpt-4o-mini';
  const userPrompt: string = data.config?.userPrompt || '';
  const truncatedPrompt = $derived(
    userPrompt.length > 40 ? userPrompt.slice(0, 40) + '…' : userPrompt,
  );

  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)',
    running: '#569cd6',
    completed: '#2d7d46',
    failed: '#b43232',
    paused_breakpoint: '#b8860b',
    skipped: 'var(--text-ghost)',
  };

  let borderColor = $derived(
    data.status ? STATUS_COLORS[data.status] || 'var(--card-border)' : 'var(--card-border)',
  );
  let isRunning = $derived(data.status === 'running');
</script>

<div
  class="rounded-lg border-2 min-w-[160px] transition-colors"
  style="background: var(--card-bg); border-color: {borderColor};"
  class:animate-pulse={isRunning}
>
  <Handle type="target" position={Position.Left} id="input" style="top: 30px;" />

  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm">✦</span>
      <span
        class="text-[10px] uppercase tracking-[0.15em]"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        llm-call
      </span>
      {#if data.status}
        <span class="w-2 h-2 rounded-full ml-auto" style="background: {borderColor};"></span>
      {/if}
    </div>
    <div class="text-sm font-medium mb-2" style="color: var(--text-primary);">
      {data.label}
    </div>
    <span
      class="text-[10px] px-1.5 py-0.5 rounded font-mono block truncate"
      style="background: var(--card-border); color: var(--text-ghost);"
      title={model}
    >
      {model}
    </span>
    {#if truncatedPrompt}
      <span
        class="text-[10px] italic block truncate mt-1"
        style="color: var(--text-ghost);"
        title={userPrompt}
      >
        {truncatedPrompt}
      </span>
    {/if}
  </div>

  <Handle type="source" position={Position.Right} id="output" style="top: 30px;" />
</div>
