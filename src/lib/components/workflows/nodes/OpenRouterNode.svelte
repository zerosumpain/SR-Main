<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data } = $props();
  const operation: string = data.config?.operation || 'chat_completion';
  const model: string = data.config?.model || '';

  const OPERATION_LABELS: Record<string, string> = {
    chat_completion: 'Chat',
    list_models: 'List Models',
    get_usage: 'Usage Stats',
  };
</script>

<BaseNode
  label={data.label}
  nodeType="openrouter"
  status={data.status}
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
  icon="🔀"
>
  {#snippet extra()}
    <div class="px-3 pb-2 flex flex-col gap-1">
      <span
        class="text-[10px] px-1.5 py-0.5 rounded self-start"
        style="background: #7c3aed22; color: #7c3aed; font-family: var(--font-mono);"
      >
        {OPERATION_LABELS[operation] ?? operation}
      </span>
      {#if model && operation === 'chat_completion'}
        <span
          class="text-[10px] truncate max-w-[140px]"
          style="color: var(--text-ghost); font-family: var(--font-mono);"
        >
          {model}
        </span>
      {/if}
    </div>
  {/snippet}
</BaseNode>
