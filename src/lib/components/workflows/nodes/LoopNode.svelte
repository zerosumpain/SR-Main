<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data } = $props();

  const arrayPath: string = data.config?.arrayPath ?? 'items';
  const displayLabel: string = data.label ? `${data.label} (${arrayPath})` : arrayPath;
</script>

<BaseNode
  label={displayLabel}
  nodeType="loop"
  status={data.status}
  icon="↺"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
