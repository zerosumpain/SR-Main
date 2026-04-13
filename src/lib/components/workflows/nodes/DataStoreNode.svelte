<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data } = $props();

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
  label={displayLabel}
  nodeType="data-store"
  status={data.status}
  icon="🗄"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
