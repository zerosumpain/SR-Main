<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data, id } = $props();

  const collectField: string = data.config?.collectField ?? '';
  const displayLabel: string = data.label
    ? collectField
      ? `${data.label} (${collectField})`
      : data.label
    : 'Accumulator';
</script>

<BaseNode
  id={id}
  description={data.config?.description || ""}
  label={displayLabel}
  nodeType="accumulator"
  status={data.status}
  error={data.error}
  icon="⊕"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
