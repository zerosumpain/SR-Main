<script lang="ts">
  import BaseNode from './BaseNode.svelte';
  let { data, id } = $props();
  const operation: string = data.config?.operation ?? 'list';
  const opLabels: Record<string, string> = { start: 'Start', status: 'Status', list: 'List', control: 'Control' };
  const displayLabel: string = data.label || `JKAI ${opLabels[operation] || operation}`;
</script>
<BaseNode {id} description="" label={displayLabel} nodeType="jkai" status={data.status} error={data.error} icon="🤖" inputs={[{ name: 'input' }]} outputs={[{ name: 'output' }]} />
