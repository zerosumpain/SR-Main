<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data, id } = $props();

  const strategy: string = data.config?.strategy || 'deep-merge';
  const strategyLabel = strategy === 'pick' ? 'Pick Fields' : 'Deep Merge';
</script>

<BaseNode
  id={id}
  label={data.label}
  nodeType="merge"
  status={data.status}
  icon="⇌"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
>
  {#snippet extra()}
    <div class="px-3 pb-2">
      <div
        class="text-[10px] px-1.5 py-0.5 rounded"
        style="background: var(--surface-raised, #1e1e1e); color: var(--text-ghost); font-family: var(--font-mono);"
      >
        {strategyLabel}
      </div>
    </div>
  {/snippet}
</BaseNode>
