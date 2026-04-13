<!-- src/lib/components/workflows/nodes/HttpRequestNode.svelte -->
<script lang="ts">
  import BaseNode from '../BaseNode.svelte';

  let { data, id } = $props();
  const method = data.config?.method || 'GET';

  const METHOD_COLORS: Record<string, string> = {
    GET: '#2d7d46',
    POST: '#569cd6',
    PUT: '#b8860b',
    PATCH: '#8b5cf6',
    DELETE: '#b43232',
  };
  const methodColor = METHOD_COLORS[method] || 'var(--text-ghost)';
</script>

<BaseNode
  label={data.label}
  nodeType="http-request"
  status={data.status}
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
  icon="🌐"
>
  {#snippet extra()}
    <div class="px-3 pb-2 flex items-center gap-2">
      <span
        class="text-[10px] font-bold px-1.5 py-0.5 rounded"
        style="background: {methodColor}22; color: {methodColor}; font-family: var(--font-mono);"
      >
        {method}
      </span>
      {#if data.config?.url}
        <span class="text-[10px] truncate max-w-[120px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
          {data.config.url}
        </span>
      {/if}
    </div>
  {/snippet}
</BaseNode>
