<script lang="ts">
  import BaseNode from './BaseNode.svelte';
  let { data, id } = $props();
  const operation: string = data.config?.operation ?? 'list';
  const opLabels: Record<string, string> = { list: 'List', get: 'Get', create: 'Create', update: 'Update' };
  const displayLabel: string = data.label || `Blog ${opLabels[operation] || operation}`;
</script>
<BaseNode {id} description="" label={displayLabel} nodeType="blog" status={data.status} error={data.error} icon="📝" inputs={[{ name: 'input' }]} outputs={[{ name: 'output' }]} />
