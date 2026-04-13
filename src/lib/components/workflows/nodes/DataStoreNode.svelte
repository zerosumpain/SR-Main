<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data, id } = $props();

  const operation: string = data.config?.operation ?? 'get';
  const key: string = data.config?.key ?? '';
  const badge = operation === 'set' ? 'SET' : 'GET';
  const displayLabel: string = data.label
    ? data.label
    : key
      ? `[${badge}] ${key}`
      : badge;
</script>

<BaseNode
  id={id}
  description={data.config?.description || ""}
  label={displayLabel}
  nodeType="data-store"
  status={data.status}
  icon="🗄"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
