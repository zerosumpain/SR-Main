<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data } = $props();

  const to: string = data.config?.to ?? '';
  const displayLabel: string = data.label ? `${data.label}${to ? ` → ${to}` : ''}` : (to || 'Email');
</script>

<BaseNode
  label={displayLabel}
  nodeType="email"
  status={data.status}
  icon="✉"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
