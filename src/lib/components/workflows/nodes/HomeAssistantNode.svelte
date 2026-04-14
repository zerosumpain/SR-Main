<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data, id } = $props();

  const operation: string = data.config?.operation ?? 'query_state';
  const entityId: string = data.config?.entityId ?? '';
  const opLabels: Record<string, string> = {
    query_state: 'Query',
    call_service: 'Service',
    fire_event: 'Event',
    get_history: 'History',
    render_template: 'Template',
  };
  const displayLabel: string = data.label
    ? `${data.label}${entityId ? ` · ${entityId.split('.').pop()}` : ''}`
    : `HA ${opLabels[operation] || operation}`;
</script>

<BaseNode
  id={id}
  description={data.config?.description || ""}
  label={displayLabel}
  nodeType="home-assistant"
  status={data.status}
  error={data.error}
  icon="🏠"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
