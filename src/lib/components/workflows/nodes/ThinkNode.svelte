<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';

  let { data, id } = $props();

  const prompt: string = data.config?.prompt || '';
  const truncatedPrompt = $derived(
    prompt.length > 40 ? prompt.slice(0, 40) + '…' : prompt,
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
</div>
