<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data, id } = $props();

  const to: string = data.config?.to ?? '';
  const displayLabel: string = data.label ? `${data.label}${to ? ` → ${to}` : ''}` : (to || 'Email');
</script>

<BaseNode
  id={id}
  description={data.config?.description || ""}
  label={displayLabel}
  nodeType="email"
  status={data.status}
  icon="✉"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
