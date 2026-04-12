<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data } = $props();
</script>

<BaseNode
  label={data.label}
  nodeType="trigger"
  status={data.status}
  icon="▶"
  outputs={[{ name: 'output' }]}
/>
