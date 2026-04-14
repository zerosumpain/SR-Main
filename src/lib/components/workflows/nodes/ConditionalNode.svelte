<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';

  let { data, id } = $props();

  const expression: string = data.config?.expression ?? '';
  const preview = expression.length > 24 ? expression.slice(0, 24) + '…' : expression;

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
  class="rounded-lg min-w-[180px] transition-colors"
  style="background: var(--card-bg); border: {data.status && data.status !== 'pending' ? '3px' : '1px'} solid {borderColor}; opacity: {isSkipped ? 0.4 : 1};"
  class:animate-pulse={isRunning}
>
  <!-- Input handle (left) -->
  <Handle type="target" position={Position.Left} id="input" style="top: 40px;" />

  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm">⑂</span>
      <span
        class="text-[10px] uppercase tracking-[0.15em]"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        conditional
      </span>
      {#if data.status}
        <span class="w-2 h-2 rounded-full ml-auto" style="background: {borderColor};"></span>
      {/if}
    </div>
    <div class="text-sm font-medium mb-2" style="color: var(--text-primary);">
      {data.label}
    </div>
    {#if preview}
      <div
        class="text-[10px] px-1.5 py-0.5 rounded"
        style="background: var(--surface-raised, #1e1e1e); color: var(--text-ghost); font-family: var(--font-mono);"
      >
        {preview}
      </div>
    {/if}

    <!-- Output handle labels -->
    <div class="flex flex-col items-end gap-2 mt-2">
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] font-medium" style="color: #2d7d46;">True</span>
        <span class="w-2 h-2 rounded-full" style="background: #2d7d46;"></span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] font-medium" style="color: #b43232;">False</span>
        <span class="w-2 h-2 rounded-full" style="background: #b43232;"></span>
      </div>
    </div>
  </div>

  <!-- True output handle (right, upper) -->
  <Handle
    type="source"
    position={Position.Right}
    id="true"
    style="top: 56px; background: #2d7d46; border-color: #2d7d46;"
  />
  <!-- False output handle (right, lower) -->
  <Handle
    type="source"
    position={Position.Right}
    id="false"
    style="top: 80px; background: #b43232; border-color: #b43232;"
  />

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
