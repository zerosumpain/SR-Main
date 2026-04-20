<script lang="ts">
  import BaseNode from './BaseNode.svelte';
  let { data, id } = $props();
  const displayLabel: string = data.label || 'Web Scrape';
</script>
<BaseNode {id} description="" label={displayLabel} nodeType="web-scrape" status={data.status} error={data.error} icon="🕸️" inputs={[{ name: 'input' }]} outputs={[{ name: 'output' }]} />
