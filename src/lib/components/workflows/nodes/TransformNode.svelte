<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data, id } = $props();
</script>

<BaseNode
  id={id}
  description={data.config?.description || ""}
  label={data.label}
  nodeType="transform"
  status={data.status}
  icon="⇄"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
