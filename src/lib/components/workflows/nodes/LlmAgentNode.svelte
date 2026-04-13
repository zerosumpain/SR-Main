<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  let { data } = $props();
  const model: string = data.config?.model || 'openai/gpt-4o';
  const maxIter: number = data.config?.maxIterations || 10;
  const systemPrompt: string = data.config?.systemPrompt || '';
  const truncatedPrompt = $derived(systemPrompt.length > 35 ? systemPrompt.slice(0, 35) + '...' : systemPrompt);
  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)', running: '#569cd6', completed: '#2d7d46',
    failed: '#b43232', paused_breakpoint: '#b8860b', skipped: 'var(--text-ghost)',
  };
  let borderColor = $derived(data.status ? STATUS_COLORS[data.status] || 'var(--card-border)' : 'var(--card-border)');
  let isRunning = $derived(data.status === 'running');
</script>

<div class="rounded-lg border-2 min-w-[180px] transition-colors" style="background: var(--card-bg); border-color: {borderColor};" class:animate-pulse={isRunning}>
  <Handle type="target" position={Position.Left} id="input" style="top: 30px;" />
  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm">&#9881;</span>
      <span class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--text-ghost); font-family: var(--font-mono);">agent</span>
      {#if data.status}<span class="w-2 h-2 rounded-full ml-auto" style="background: {borderColor};"></span>{/if}
    </div>
    <div class="text-sm font-medium mb-2" style="color: var(--text-primary);">{data.label}</div>
    <div class="flex items-center gap-2 mb-1">
      <span class="text-[10px] px-1.5 py-0.5 rounded font-mono" style="background: var(--card-border); color: var(--text-ghost);" title={model}>{model.split('/').pop()}</span>
      <span class="text-[10px]" style="color: var(--text-ghost);">max {maxIter}</span>
    </div>
    {#if truncatedPrompt}
      <span class="text-[10px] italic block truncate" style="color: var(--text-ghost);" title={systemPrompt}>{truncatedPrompt}</span>
    {/if}
  </div>
  <Handle type="source" position={Position.Right} id="output" style="top: 30px;" />
</div>
