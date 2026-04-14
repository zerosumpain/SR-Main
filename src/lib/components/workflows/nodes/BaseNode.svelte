<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';

  import type { Snippet } from 'svelte';

  let {
    id,
    label,
    nodeType,
    description = '',
    status,
    error,
    inputs = [],
    outputs = [],
    icon = '',
    extra,
  }: {
    id?: string;
    label: string;
    nodeType: string;
    description?: string;
    status?: string;
    error?: string;
    inputs?: { name: string }[];
    outputs?: { name: string }[];
    icon?: string;
    extra?: Snippet;
  } = $props();

  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)',
    running: '#e67e22',
    completed: '#27ae60',
    failed: '#e74c3c',
    paused_breakpoint: '#f39c12',
    skipped: 'var(--text-ghost)',
  };

  let borderColor = $derived(status ? STATUS_COLORS[status] || 'var(--card-border)' : 'var(--card-border)');
  let borderWidth = $derived(status && status !== 'pending' ? '3px' : '1px');
  let isRunning = $derived(status === 'running');
  let isFailed = $derived(status === 'failed');
  let isSkipped = $derived(status === 'skipped');
</script>

<div
  class="rounded-lg transition-all duration-300"
  style="background: var(--card-bg); border: {borderWidth} solid {borderColor}; width: 220px; opacity: {isSkipped ? 0.4 : 1};"
  class:animate-pulse={isRunning}
>
  {#each inputs as input, i}
    <Handle type="target" position={Position.Left} id={input.name} style="top: {40 + i * 20}px;" />
  {/each}

  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      {#if icon}
        <span class="text-sm">{icon}</span>
      {/if}
      <span
        class="text-[10px] uppercase tracking-[0.15em]"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        {nodeType}
      </span>
      {#if id}
        <span class="ml-auto flex items-center gap-1">
          <span
            class="w-5 h-5 flex items-center justify-center rounded hover:bg-black/10 transition-colors nopan nodrag"
            style="color: var(--text-ghost); font-size: 10px; line-height: 1; cursor: pointer;"
            data-inspect-node={id}
            role="button"
            tabindex="-1"
          >⚙</span>
          <span
            class="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 transition-colors nopan nodrag"
            style="color: var(--text-ghost); font-size: 10px; line-height: 1; cursor: pointer;"
            data-delete-node={id}
            role="button"
            tabindex="-1"
          >✕</span>
        </span>
      {:else if status}
        <span
          class="w-2 h-2 rounded-full ml-auto"
          style="background: {borderColor};"
        ></span>
      {/if}
    </div>
    <div class="text-sm font-medium" style="color: var(--text-primary);">
      {label}
    </div>
    {#if description}
      <div class="text-[10px] mt-1 leading-tight line-clamp-3" style="color: var(--text-ghost);">
        {description}
      </div>
    {/if}
  </div>

  {#if isFailed && error}
    <div class="px-3 pb-2">
      <div
        class="text-[10px] leading-tight px-2 py-1.5 rounded"
        style="background: rgba(231, 76, 60, 0.1); color: #e74c3c; font-family: var(--font-mono); word-break: break-word;"
      >
        {error}
      </div>
    </div>
  {/if}

  {#if isSkipped}
    <div class="px-3 pb-2">
      <span class="text-[10px] uppercase tracking-wider" style="color: var(--text-ghost);">Skipped</span>
    </div>
  {/if}

  {#if extra}
    {@render extra()}
  {/if}

  {#each outputs as output, i}
    <Handle type="source" position={Position.Right} id={output.name} style="top: {40 + i * 20}px;" />
  {/each}
</div>
