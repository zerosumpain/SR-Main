<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data, id } = $props();

  const arrayPath: string = data.config?.arrayPath ?? 'items';
  const displayLabel: string = data.label ? `${data.label} (${arrayPath})` : arrayPath;
</script>

<BaseNode
  id={id}
  description={data.config?.description || ""}
  label={displayLabel}
  nodeType="loop"
  status={data.status}
  error={data.error}
  icon="↺"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
