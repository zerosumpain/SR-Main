<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data, id } = $props();

  const MODE_LABELS: Record<string, string> = {
    json: 'Extract JSON',
    regex: 'Regex Match',
    split: 'Split Text',
  };

  let modeLabel = $derived(MODE_LABELS[data.config?.mode as string] ?? data.config?.mode ?? 'json');
</script>

<BaseNode
  id={id}
  description={modeLabel}
  label={data.label}
  nodeType="text-parser"
  status={data.status}
  icon="⟨/⟩"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
