<script lang="ts">
  import BaseNode from './BaseNode.svelte';
  let { data, id } = $props();
  const operation: string = data.config?.operation ?? 'stats';
  const opLabels: Record<string, string> = { stats: 'Stats', readiness: 'Readiness', sleep: 'Sleep', training_load: 'Training', timeline: 'Timeline' };
  const displayLabel: string = data.label || `Health ${opLabels[operation] || operation}`;
</script>
<BaseNode {id} description="" label={displayLabel} nodeType="health-query" status={data.status} error={data.error} icon="❤️" inputs={[{ name: 'input' }]} outputs={[{ name: 'output' }]} />
