<script lang="ts">
  import BaseNode from './BaseNode.svelte';
  let { data, id } = $props();
  const displayLabel: string = data.label || 'Intel Write';
</script>
<BaseNode {id} description="" label={displayLabel} nodeType="intel-write" status={data.status} error={data.error} icon="🧠" inputs={[{ name: 'input' }]} outputs={[{ name: 'output' }]} />
