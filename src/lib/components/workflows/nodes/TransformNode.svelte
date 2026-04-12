<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data } = $props();
</script>

<BaseNode
  label={data.label}
  nodeType="transform"
  status={data.status}
  icon="⇄"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
