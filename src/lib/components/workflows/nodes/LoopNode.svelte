<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data, id } = $props();

  const arrayPath: string = data.config?.arrayPath ?? 'items';
  const displayLabel: string = data.label ? `${data.label} (${arrayPath})` : arrayPath;
</script>

<BaseNode
  id={id}
  label={displayLabel}
  nodeType="loop"
  status={data.status}
  icon="↺"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
