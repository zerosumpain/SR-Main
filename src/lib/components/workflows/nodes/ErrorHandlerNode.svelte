<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';

  let { data, id } = $props();

  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)',
    running: '#569cd6',
    completed: '#2d7d46',
    failed: '#b43232',
    paused_breakpoint: '#b8860b',
    skipped: 'var(--text-ghost)',
  };

  let borderColor = $derived(
    data.status ? STATUS_COLORS[data.status] ?? 'var(--card-border)' : 'var(--card-border)',
  );
  let isRunning = $derived(data.status === 'running');
</script>

<div
  class="rounded-lg border-2 min-w-[180px] transition-colors"
  style="background: var(--card-bg); border-color: {borderColor};"
  class:animate-pulse={isRunning}
>
  <!-- Input handle (left) -->
  <Handle type="target" position={Position.Left} id="input" style="top: 40px;" />

  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm">🛡️</span>
      <span
        class="text-[10px] uppercase tracking-[0.15em]"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        error-handler
      </span>
      {#if data.status}
        <span class="w-2 h-2 rounded-full ml-auto" style="background: {borderColor};"></span>
      {/if}
    </div>
    <div class="text-sm font-medium mb-2" style="color: var(--text-primary);">
      {data.label}
    </div>

    <!-- Output handle labels -->
    <div class="flex flex-col items-end gap-2 mt-2">
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] font-medium" style="color: #2d7d46;">Success</span>
        <span class="w-2 h-2 rounded-full" style="background: #2d7d46;"></span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] font-medium" style="color: #b43232;">Error</span>
        <span class="w-2 h-2 rounded-full" style="background: #b43232;"></span>
      </div>
    </div>
  </div>

  <!-- Success output handle (right, upper) -->
  <Handle
    type="source"
    position={Position.Right}
    id="success"
    style="top: 56px; background: #2d7d46; border-color: #2d7d46;"
  />
  <!-- Error output handle (right, lower) -->
  <Handle
    type="source"
    position={Position.Right}
    id="error"
    style="top: 80px; background: #b43232; border-color: #b43232;"
  />
</div>
