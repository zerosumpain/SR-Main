<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data } = $props();

  const ms: number = data.config?.milliseconds ?? 1000;
  const displayLabel: string = data.label ? `${data.label} (${ms}ms)` : `${ms}ms`;
</script>

<BaseNode
  label={displayLabel}
  nodeType="delay"
  status={data.status}
  icon="⏱"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
