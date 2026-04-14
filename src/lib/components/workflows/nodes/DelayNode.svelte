<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data, id } = $props();

  const ms: number = data.config?.milliseconds ?? 1000;
  const displayLabel: string = data.label ? `${data.label} (${ms}ms)` : `${ms}ms`;
</script>

<BaseNode
  id={id}
  description={data.config?.description || ""}
  label={displayLabel}
  nodeType="delay"
  status={data.status}
  error={data.error}
  icon="⏱"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
