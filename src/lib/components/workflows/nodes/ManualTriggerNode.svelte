<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data, id } = $props();
</script>

<BaseNode
  id={id}
  description={data.config?.description || ""}
  label={data.label}
  nodeType="trigger"
  status={data.status}
  error={data.error}
  icon="▶"
  outputs={[{ name: 'output' }]}
/>
