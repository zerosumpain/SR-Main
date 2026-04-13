<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import { inspectNode } from '../inspect-store';

  import type { Snippet } from 'svelte';

  let {
    id,
    label,
    nodeType,
    status,
    inputs = [],
    outputs = [],
    icon = '',
    extra,
  }: {
    id?: string;
    label: string;
    nodeType: string;
    status?: string;
    inputs?: { name: string }[];
    outputs?: { name: string }[];
    icon?: string;
    extra?: Snippet;
  } = $props();

  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)',
    running: '#569cd6',
    completed: '#2d7d46',
    failed: '#b43232',
    paused_breakpoint: '#b8860b',
    skipped: 'var(--text-ghost)',
  };

  let borderColor = $derived(status ? STATUS_COLORS[status] || 'var(--card-border)' : 'var(--card-border)');
  let isRunning = $derived(status === 'running');
</script>

<div
  class="rounded-lg border-2 min-w-[160px] transition-colors"
  style="background: var(--card-bg); border-color: {borderColor};"
  class:animate-pulse={isRunning}
>
  {#each inputs as input, i}
    <Handle type="target" position={Position.Left} id={input.name} style="top: {30 + i * 20}px;" />
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
        <button
          class="ml-auto w-5 h-5 flex items-center justify-center rounded hover:bg-black/10 transition-colors nopan nodrag"
          style="color: var(--text-ghost); font-size: 10px; line-height: 1;"
          onpointerdown={(e) => { e.stopPropagation(); }}
          onclick={(e) => { e.stopPropagation(); inspectNode(id!); }}
          title="Inspect node"
        >⚙</button>
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
  </div>

  {#if extra}
    {@render extra()}
  {/if}

  {#each outputs as output, i}
    <Handle type="source" position={Position.Right} id={output.name} style="top: {30 + i * 20}px;" />
  {/each}
</div>
