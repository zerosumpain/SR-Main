<!-- src/lib/components/workflows/nodes/SubWorkflowNode.svelte -->
<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data, id } = $props();

  const workflowId: string = data.config?.workflowId ?? '';
  const truncatedId: string = workflowId.length > 20 ? `…${workflowId.slice(-18)}` : workflowId;
</script>

<BaseNode
  id={id}
  description={data.config?.description || ""}
  label={data.label}
  nodeType="sub-workflow"
  status={data.status}
  error={data.error}
  icon="⤵"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
>
  {#snippet extra()}
    {#if workflowId}
      <div class="px-3 pb-2">
        <span
          class="text-[10px] truncate block max-w-[160px]"
          style="color: var(--text-ghost); font-family: var(--font-mono);"
          title={workflowId}
        >
          {truncatedId}
        </span>
      </div>
    {/if}
  {/snippet}
</BaseNode>
