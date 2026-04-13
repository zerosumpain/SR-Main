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
    data.status ? STATUS_COLORS[data.status] || 'var(--card-border)' : 'var(--card-border)',
  );
  let isRunning = $derived(data.status === 'running');

  let routes = $derived(() => {
    const routesStr = data.config?.routes ?? '[]';
    try {
      const parsed = JSON.parse(routesStr);
      return Array.isArray(parsed) ? parsed as { handle: string; description: string }[] : [];
    } catch {
      return [];
    }
  });

  // Evenly space handles vertically; input handle is at 40px
  const HANDLE_START_Y = 56;
  const HANDLE_STEP = 24;
</script>

<div
  class="rounded-lg border-2 min-w-[200px] transition-colors"
  style="background: var(--card-bg); border-color: {borderColor};"
  class:animate-pulse={isRunning}
>
  <!-- Input handle (left) -->
  <Handle type="target" position={Position.Left} id="input" style="top: 40px;" />

  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm">⑃</span>
      <span
        class="text-[10px] uppercase tracking-[0.15em]"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        llm-router
      </span>
      {#if data.status}
        <span class="w-2 h-2 rounded-full ml-auto" style="background: {borderColor};"></span>
      {/if}
    </div>

    <div class="text-sm font-medium mb-2" style="color: var(--text-primary);">
      {data.label}
    </div>

    <!-- Route list -->
    <div class="flex flex-col items-end gap-1.5 mt-1">
      {#if routes().length === 0}
        <span class="text-[10px] italic" style="color: var(--text-ghost);">No routes defined</span>
      {:else}
        {#each routes() as route, i}
          <div class="flex items-center gap-1.5">
            <span
              class="text-[10px] font-medium truncate max-w-[120px]"
              style="color: var(--text-secondary);"
              title={route.description}
            >
              {route.handle}
            </span>
            <span class="w-2 h-2 rounded-full flex-shrink-0" style="background: #569cd6;"></span>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Source handles for each route -->
  {#each routes() as route, i}
    <Handle
      type="source"
      position={Position.Right}
      id={route.handle}
      style="top: {HANDLE_START_Y + i * HANDLE_STEP}px; background: #569cd6; border-color: #569cd6;"
    />
  {/each}
</div>
