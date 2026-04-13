<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data, id } = $props();
</script>

<BaseNode
  id={id}
  label={data.label}
  nodeType="trigger"
  status={data.status}
  icon="▶"
  outputs={[{ name: 'output' }]}
/>
