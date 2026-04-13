<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data, id } = $props();
  const operation = data.config?.operation || 'get_cycles';

  const OPERATION_LABELS: Record<string, string> = {
    get_cycles: 'Cycles',
    get_recovery: 'Recovery',
    get_sleep: 'Sleep',
    get_workouts: 'Workouts',
  };
</script>

<BaseNode
  id={id}
  label={data.label}
  nodeType="whoop"
  status={data.status}
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
  icon="💚"
>
  {#snippet extra()}
    <div class="px-3 pb-2">
      <span class="text-[10px] px-1.5 py-0.5 rounded" style="background: #00ff9022; color: #00cc77; font-family: var(--font-mono);">
        {OPERATION_LABELS[operation] ?? operation}
      </span>
    </div>
  {/snippet}
</BaseNode>
